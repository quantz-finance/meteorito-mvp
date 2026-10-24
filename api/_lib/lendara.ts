// Pago con tarjeta vía Lendara (rampa CRC -> USDC sobre Stellar testnet; sandbox con tarjetas de prueba). Server-only.
// Flujo (docs/lendara-card.md): el comprador paga con tarjeta en el widget de Lendara; Lendara envía SU USDC de prueba a la
// tesorería con el memo del pedido; el servidor verifica en Lendara (/v1) y en Horizon, y recién ahí fondea el escrow de
// Trustless Work por el mismo camino que el SINPE simulado (mockRampFund: monto exacto del pedido en DB, idempotente).
// Cliente HTTP propio (mismos endpoints que @lendara/ramp 0.1.1): ese paquete es solo ESM y las funciones de Vercel corren
// como CommonJS (npm run check:cjs).
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { HttpError } from './auth';
import { db, logEvent } from './db';
import { env } from './env';
import { mockRampFund } from './escrow';

/** Emisor del USDC de prueba del sandbox de Lendara (NO es el USDC de los escrows: env.usdcIssuer()). */
export const LENDARA_USDC_ISSUER = 'GBVIQ7QVTTJ4NLFTYYFPEKWYJWAMKDAOFYSR52ZGWJFSGTSVOO5H47B5';
export const LENDARA_SANDBOX_URL = 'https://lendaraweb-production.up.railway.app';
const issuer = () => process.env.LENDARA_USDC_ISSUER || LENDARA_USDC_ISSUER;
const apiUrl = () => (process.env.LENDARA_API_URL || LENDARA_SANDBOX_URL).replace(/\/+$/, '');
export const cardEnabled = () => !!process.env.LENDARA_API_KEY;
/** Memo de texto (≤ 28 bytes) que correlaciona el pago de Lendara con el pedido. */
export const cardMemo = (slug: string) => `met:${slug}`;
const treasuryPublic = () => Keypair.fromSecret(env.treasurySecret()).publicKey();

const PROCESSING = new Set(['incomplete', 'pending_user_transfer_start', 'pending_user_transfer_complete', 'pending_external', 'pending_anchor', 'on_hold', 'pending_stellar', 'pending_trust', 'pending_user']);
// "incomplete": el comprador abrió el widget pero aún no pagó. No cuenta como "procesando" para reabrir el widget.
const IN_FLIGHT = new Set([...PROCESSING].filter((s) => s !== 'incomplete' && s !== 'pending_user_transfer_start'));

const SINPE = 'o paga por SINPE Móvil';
const err = (status: number, code: string, msg: string) => Object.assign(new HttpError(status, msg), { code });
export const CARD_ERR = {
  unavailable: () => err(503, 'card_unavailable', `El pago con tarjeta no está disponible por ahora. Paga por SINPE Móvil.`),
  down: () => err(502, 'card_provider_down', `El pago con tarjeta no responde en este momento. Intenta de nuevo en unos segundos ${SINPE}.`),
  amount: () => err(400, 'card_amount', 'El pago con tarjeta no está disponible para este monto. Paga por SINPE Móvil.'),
  kyc: () => err(402, 'card_kyc_rejected', `No pudimos verificar tu identidad con esa tarjeta. Prueba con otra tarjeta ${SINPE}.`),
  expired: () => err(402, 'card_expired', `El pago con tarjeta no se completó a tiempo. Vuelve a intentarlo ${SINPE}.`),
  failed: () => err(402, 'card_failed', `El pago con tarjeta no se pudo completar. Vuelve a intentarlo ${SINPE}.`),
  mismatch: () => err(409, 'card_mismatch', 'No pudimos confirmar ese pago con tarjeta para este pedido. Escríbenos y lo revisamos; no vuelvas a pagar.'),
  noSession: () => err(409, 'card_no_session', 'Todavía no hay un pago con tarjeta para este pedido. Toca "Pagar con tarjeta".'),
};

/* ---------- dependencias inyectables (tests sin red) ---------- */
type FundFn = (orderId: string, meta: Record<string, unknown>) => Promise<{ fundedTx: string; pin: string | null }>;
interface Deps { fetch: typeof fetch; ensureTrustline: (account: string) => Promise<void>; fund: FundFn }
const realDeps = (): Deps => ({ fetch: (...a) => globalThis.fetch(...a), ensureTrustline: ensureTreasuryTrustline, fund: (id, meta) => mockRampFund(id, meta) });
let deps: Deps = realDeps();
export function __setLendaraDepsForTests(d: Partial<Deps> | null) { deps = d ? { ...realDeps(), ...d } : realDeps(); }

async function getJson(url: string, init: RequestInit = {}, timeoutMs = 25_000): Promise<{ status: number; body: any }> {
  let r: Response;
  try { r = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (e: any) { console.warn('[lendara] red', url.replace(/\?.*/, ''), e?.message); throw CARD_ERR.down(); }
  return { status: r.status, body: await r.json().catch(() => null) };
}
/** /v1 de Lendara con la API key del proyecto (Railway free tier: el primer request puede tardar ~20 s). */
async function lendara(method: 'GET' | 'POST', path: string, body?: unknown) {
  const key = process.env.LENDARA_API_KEY; if (!key) throw CARD_ERR.unavailable();
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await getJson(apiUrl() + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (r.status >= 500 || r.status === 401 || r.status === 429) { console.warn('[lendara]', method, path.replace(/[0-9a-f-]{36}/, ':id'), r.status, r.body?.error); throw CARD_ERR.down(); }
  return r;
}

/** La tesorería necesita trustline al USDC de Lendara para recibir el pago (si no, Lendara lo deja en pending_trust). */
let trustOk = false;
export async function ensureTreasuryTrustline(account: string) {
  if (trustOk) return;
  const a = await getJson(`${env.horizon()}/accounts/${account}`);
  const has = (a.body?.balances ?? []).some((b: any) => b.asset_code === 'USDC' && b.asset_issuer === issuer());
  if (!has) {
    const server = new Horizon.Server(env.horizon());
    const src = await server.loadAccount(account);
    const tx = new TransactionBuilder(src, { fee: String(Number(BASE_FEE) * 10), networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.changeTrust({ asset: new Asset('USDC', issuer()) })).setTimeout(60).build();
    tx.sign(Keypair.fromSecret(env.treasurySecret()));
    const r = await server.submitTransaction(tx);
    console.log('[lendara] trustline USDC (Lendara) creada en la tesorería', (r as any).hash);
  }
  trustOk = true;
}

/* ---------- sesiones guardadas en la bitácora del pedido (sin migración) ---------- */
async function sessionIds(orderId: string): Promise<string[]> {
  const { data, error } = await db().from('order_events').select('id, detail').eq('order_id', orderId).eq('kind', 'card_session');
  if (error) throw error;
  return (data ?? []).sort((a: any, b: any) => Number(b.id) - Number(a.id)).map((e: any) => String(e.detail?.lendaraId ?? '')).filter(Boolean).slice(0, 5);
}
async function lendaraTx(id: string) {
  const r = await lendara('GET', `/v1/transactions/${encodeURIComponent(id)}`);
  if (r.status !== 200 || !r.body?.status) return null;
  return r.body;
}

const near = (a: unknown, b: unknown, eps: number) => Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) < eps;
/** Verifica una transacción "completed" de Lendara contra el pedido en DB y contra Horizon. Devuelve el hash Stellar. */
export async function verifyCardPayment(order: any, tx: any): Promise<{ ok: true; hash: string; amountOut: string } | { ok: false; reason: string }> {
  const treasury = treasuryPublic(); const memo = cardMemo(order.slug);
  if (tx.status !== 'completed') return { ok: false, reason: `status ${tx.status}` };
  if (tx.amount_in_asset !== 'iso4217:CRC' || !near(tx.amount_in, order.price_crc, 0.005)) return { ok: false, reason: `monto ${tx.amount_in} ${tx.amount_in_asset} != ${order.price_crc} CRC` };
  if (tx.to !== treasury) return { ok: false, reason: 'destino' };
  if (tx.deposit_memo !== memo) return { ok: false, reason: 'memo' };
  if (tx.amount_out_asset !== `stellar:USDC:${issuer()}`) return { ok: false, reason: 'activo' };
  const hash = String(tx.stellar_transaction_id ?? '');
  if (!/^[0-9a-f]{64}$/.test(hash)) return { ok: false, reason: 'sin hash' };
  const h = await getJson(`${env.horizon()}/transactions/${hash}`);
  if (h.status !== 200 || h.body?.successful !== true) return { ok: false, reason: 'tx no encontrada o fallida en Horizon' };
  if (h.body.memo_type !== 'text' || h.body.memo !== memo) return { ok: false, reason: 'memo on-chain' };
  const ops = await getJson(`${env.horizon()}/transactions/${hash}/operations?limit=200`);
  const pay = (ops.body?._embedded?.records ?? []).find((o: any) => o.type === 'payment' && o.to === treasury && o.asset_code === 'USDC' && o.asset_issuer === issuer());
  if (!pay) return { ok: false, reason: 'sin pago USDC a la tesorería' };
  if (!near(pay.amount, tx.amount_out, 1e-7 / 2) || !(Number(pay.amount) > 0)) return { ok: false, reason: `monto on-chain ${pay.amount} != ${tx.amount_out}` };
  return { ok: true, hash, amountOut: String(pay.amount) };
}

const failureFor = (tx: any) => {
  if (tx.status === 'expired') return CARD_ERR.expired();
  if (['too_small', 'too_large', 'no_market'].includes(tx.status)) return CARD_ERR.amount();
  if (/kyc/i.test(String(tx.message ?? ''))) return CARD_ERR.kyc();
  return CARD_ERR.failed();
};

/** Revisa los pagos con tarjeta de ESTE pedido (los ids salen de su bitácora, nunca del cliente). */
async function settle(order: any): Promise<{ state: 'funded'; fundedTx: string; pin: string | null } | { state: 'pending' } | { state: 'none' } | { state: 'failed'; tx: any }> {
  const ids = await sessionIds(order.id);
  if (!ids.length) return { state: 'none' };
  const txs = (await Promise.all(ids.map(lendaraTx))).filter(Boolean) as any[];
  const done = txs.find((x) => x.status === 'completed');
  if (done) {
    const v = await verifyCardPayment(order, done);
    if (!v.ok) { await logEvent(order.id, 'card_mismatch', { lendaraId: done.id, reason: v.reason }); console.warn('[lendara] pago no verificado', order.slug, v.reason); throw CARD_ERR.mismatch(); }
    const r = await deps.fund(order.id, { ramp: 'card', provider: 'lendara', lendaraId: done.id, lendaraTx: v.hash, lendaraAmountOut: v.amountOut });
    return { state: 'funded', ...r };
  }
  if (txs.some((x) => IN_FLIGHT.has(x.status))) return { state: 'pending' };
  const latest = txs.find((x) => x.id === ids[0]);
  if (latest && !PROCESSING.has(latest.status)) return { state: 'failed', tx: latest };
  return { state: 'none' };
}

/** step=card_session: crea la sesión del widget (o fondea si un pago anterior ya se completó). */
export async function cardSession(order: any) {
  if (!cardEnabled()) throw CARD_ERR.unavailable();
  if (order.funded_tx || order.status !== 'escrow_creado' || !order.contract_id)
    throw err(409, 'bad_state', order.funded_tx || order.status !== 'creado' ? 'Este pedido ya está pagado o ya no se puede pagar.' : 'Primero inicia el pago.');
  const prev = await settle(order);
  if (prev.state === 'funded') return { fundedTx: prev.fundedTx, pin: prev.pin };
  if (prev.state === 'pending') return { pending: true };
  const treasury = treasuryPublic();
  await deps.ensureTrustline(treasury);
  const r = await lendara('POST', '/v1/sessions', { account: treasury, fiat_currency: 'CRC', amount: String(Number(order.price_crc)), memo_type: 'text', memo: cardMemo(order.slug) });
  if (r.status === 400) { console.warn('[lendara] sesión rechazada', order.slug, r.body?.error); throw /amount|minimum|maximum|limit/i.test(String(r.body?.error)) ? CARD_ERR.amount() : CARD_ERR.failed(); }
  if (r.status !== 201 && r.status !== 200) throw CARD_ERR.down();
  const s = r.body;
  if (typeof s?.url !== 'string' || !/^https:\/\//.test(s.url) || !s.id) throw CARD_ERR.down();
  const { error } = await db().from('order_events').insert({ order_id: order.id, kind: 'card_session', detail: { lendaraId: s.id, memo: cardMemo(order.slug), amountCrc: Number(order.price_crc) } });
  if (error) throw error; // sin registro no podríamos verificar el pago después: mejor no abrir el widget
  const url = new URL(s.url); if (!url.searchParams.has('lang')) url.searchParams.set('lang', 'es'); // widget en español
  return { sessionId: String(s.id), url: url.toString(), expiresAt: s.expires_at ?? null };
}

/** step=card_confirm: verifica el pago con tarjeta (Lendara + Horizon) y fondea el escrow. Idempotente. */
export async function cardConfirm(order: any) {
  if (order.funded_tx) return { fundedTx: order.funded_tx as string, pin: null };
  if (!cardEnabled()) throw CARD_ERR.unavailable();
  if (order.status !== 'escrow_creado') throw err(409, 'bad_state', 'Primero inicia el pago.');
  const r = await settle(order);
  if (r.state === 'funded') return { fundedTx: r.fundedTx, pin: r.pin };
  if (r.state === 'pending') return { pending: true };
  if (r.state === 'failed') throw failureFor(r.tx);
  throw CARD_ERR.noSession();
}
