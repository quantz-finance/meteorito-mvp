// Pago con cripto: USDC o XLM en Stellar (TESTNET). Server-only. Ver docs/pago-cripto.md.
// Flujo: el comprador (con cuenta o invitado) paga desde su wallet a la TESORERÍA con el memo del pedido (MET-<SLUG>, la misma
// referencia del SINPE). El servidor detecta el pago en Horizon y fondea el escrow de Trustless Work por el MISMO camino que la
// tarjeta y el SINPE simulado (mockRampFund: monto exacto del pedido en DB, siempre USDC). Así el escrow es siempre USDC.
//  - USDC: el pago (o el path payment que el propio wallet del comprador hace desde XLM) llega en USDC a la tesorería.
//  - XLM: cotización con colchón de deslizamiento (CRYPTO_XLM_SLIPPAGE, 3 %) válida CRYPTO_QUOTE_MINUTES (15 min). Al llegar el
//    XLM, la tesorería lo convierte a USDC en el DEX (path payment strict-receive a sí misma, máximo = lo recibido) y devuelve
//    al mismo wallet el XLM que sobró. Si el comprador da su dirección G…, también puede firmar él mismo un path payment
//    (SEP-7 web+stellar:tx) que entrega USDC exacto: no hay conversión del lado de Meteorito.
//  - Pago de menos: queda "faltan X" (los pagos con el mismo memo se suman). De más: el excedente vuelve al wallet que pagó.
//    Pago después de que el pedido ya se pagó (doble pago u otro método): se devuelve completo.
// Sin migración: cotizaciones, conversiones y devoluciones quedan en order_events; el lock es la fila de ramp_mock_payments.
import { Account, Asset, Horizon, Keypair, Memo, Networks, Operation, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import { HttpError } from './auth';
import { db, logEvent } from './db';
import { env } from './env';
import { mockRampFund } from './escrow';

export type CryptoAsset = 'USDC' | 'XLM';
export const CRYPTO_ASSETS: readonly CryptoAsset[] = ['USDC', 'XLM'];
/** Memo de texto del pedido (= referencia SINPE que ya ve el comprador). ≤ 28 bytes. */
export const cryptoMemo = (slug: string) => `MET-${String(slug).toUpperCase()}`;
/* ---------- Solo TESTNET (beta, sin dinero real) ----------
 * Fijo en el código, no en variables de entorno: passphrase de testnet, Horizon de testnet y USDC del emisor de testnet.
 * Si el entorno apunta a otra red o a otro emisor de USDC (p. ej. Circle en mainnet), el pago con cripto se APAGA, y un
 * pago con otro activo (USDC de mainnet u otro emisor) nunca cuenta. Los pagos de mainnet no existen en Horizon testnet. */
export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
export const TESTNET_HORIZON = 'https://horizon-testnet.stellar.org';
export const TESTNET_USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
export function testnetOnly(): boolean {
  try {
    return Networks.TESTNET === TESTNET_PASSPHRASE && env.network() === 'testnet' && env.horizon() === TESTNET_HORIZON && env.usdcIssuer() === TESTNET_USDC_ISSUER;
  } catch { return false; }
}
export const cryptoEnabled = () => process.env.CRYPTO_PAY !== '0' && !!process.env.TREASURY_SECRET && testnetOnly();
export const quoteMinutes = () => { const n = Number(process.env.CRYPTO_QUOTE_MINUTES ?? '15'); return Number.isFinite(n) && n >= 1 && n <= 120 ? n : 15; };
export const xlmSlippage = () => { const n = Number(process.env.CRYPTO_XLM_SLIPPAGE ?? '0.03'); return Number.isFinite(n) && n >= 0 && n <= 0.25 ? n : 0.03; };
/** Polvo: por debajo de esto no se devuelve (el fee y la reserva no lo justifican). */
export const DUST = { USDC: 0.01, XLM: 0.1 } as const;
const EPS = 1e-7;
/** 7 decimales (stroops) hacia arriba / abajo, como string para Stellar. */
export const up7 = (x: number) => (Math.ceil(x * 1e7 - 1e-6) / 1e7).toFixed(7);
export const down7 = (x: number) => (Math.floor(x * 1e7 + 1e-6) / 1e7).toFixed(7);
const r7 = (x: number) => Math.round(x * 1e7) / 1e7;
const err = (status: number, code: string, msg: string) => Object.assign(new HttpError(status, msg), { code });
export const CRYPTO_ERR = {
  unavailable: () => err(503, 'crypto_unavailable', 'El pago con cripto no está disponible por ahora. Paga con tarjeta.'),
  asset: () => err(400, 'crypto_asset', 'Por ahora solo aceptamos USDC o XLM en Stellar.'),
  noRoute: () => err(503, 'crypto_no_route', 'Ahora no podemos cotizar XLM. Prueba con USDC o paga con tarjeta.'),
  address: () => err(400, 'crypto_address', 'Revisa la dirección: empieza con G y tiene 56 caracteres.'),
  noAccount: () => err(400, 'crypto_no_account', 'Esa dirección todavía no existe en Stellar. Revisa que sea la de tu wallet.'),
  state: () => err(409, 'crypto_state', 'Este pedido ya no espera un pago.'),
};

/* ---------- dependencias inyectables (tests sin red) ---------- */
type FundFn = (orderId: string, meta: Record<string, unknown>) => Promise<{ fundedTx: string; pin: string | null }>;
export interface SendResult { hash: string; xlmSpent?: number }
interface Deps {
  fetch: typeof fetch;
  treasury: () => string;
  fund: FundFn;
  /** Tesorería: XLM -> USDC en el DEX (strict-receive a sí misma). Devuelve el XLM realmente gastado. */
  convert: (p: { usdc: string; sendMax: string; path: any[]; memo: string }) => Promise<SendResult>;
  /** Tesorería -> wallet que pagó. */
  refund: (p: { to: string; asset: CryptoAsset; amount: string; memo: string }) => Promise<SendResult>;
  sequence: (account: string) => Promise<string | null>;
  now: () => number;
}
const treasuryPublic = () => Keypair.fromSecret(env.treasurySecret()).publicKey();
export const usdcAsset = () => new Asset('USDC', TESTNET_USDC_ISSUER);
const assetOf = (a: any) => (a.asset_type === 'native' ? Asset.native() : new Asset(a.asset_code, a.asset_issuer));

async function treasuryTx(build: (b: TransactionBuilder, me: string) => TransactionBuilder, memo: string): Promise<string> {
  env.network();
  const server = new Horizon.Server(TESTNET_HORIZON);
  const kp = Keypair.fromSecret(env.treasurySecret());
  const acct = await server.loadAccount(kp.publicKey());
  const tx = build(new TransactionBuilder(acct, { fee: '10000', networkPassphrase: Networks.TESTNET }), kp.publicKey()).addMemo(Memo.text(memo)).setTimeout(60).build();
  tx.sign(kp);
  try { return ((await server.submitTransaction(tx)) as any).hash as string; }
  catch (e: any) { throw Object.assign(new Error(`Horizon: ${JSON.stringify(e?.response?.data?.extras?.result_codes ?? e?.message)}`), { result: e?.response?.data?.extras?.result_codes }); }
}
const realDeps = (): Deps => ({
  fetch: (...a) => globalThis.fetch(...a),
  treasury: treasuryPublic,
  fund: (id, meta) => mockRampFund(id, meta, { locked: true }),
  convert: async ({ usdc, sendMax, path, memo }) => {
    const hash = await treasuryTx((b, me) => b.addOperation(Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax, destination: me, destAsset: usdcAsset(), destAmount: usdc, path })), memo);
    const ops: any = await (await globalThis.fetch(`${TESTNET_HORIZON}/transactions/${hash}/operations`)).json().catch(() => null);
    const op = ops?._embedded?.records?.find((o: any) => o.type === 'path_payment_strict_receive');
    return { hash, xlmSpent: op ? Number(op.source_amount) : Number(sendMax) };
  },
  refund: async ({ to, asset, amount, memo }) => ({ hash: await treasuryTx((b) => b.addOperation(Operation.payment({ destination: to, asset: asset === 'XLM' ? Asset.native() : usdcAsset(), amount })), memo) }),
  sequence: async (account) => {
    const r = await globalThis.fetch(`${TESTNET_HORIZON}/accounts/${account}`);
    if (r.status === 404) return null;
    const j: any = await r.json(); return String(j.sequence);
  },
  now: () => Date.now(),
});
let deps: Deps = realDeps();
export function __setCryptoDepsForTests(d: Partial<Deps> | null) { deps = d ? { ...realDeps(), ...d } : realDeps(); }

async function getJson(url: string): Promise<{ status: number; body: any }> {
  let r: Response;
  try { r = await deps.fetch(url, { signal: AbortSignal.timeout(20_000) } as any); }
  catch (e: any) { console.warn('[crypto] red', url.replace(/\?.*/, ''), e?.message); throw err(502, 'crypto_horizon_down', 'Stellar no responde en este momento. Intenta de nuevo en unos segundos.'); }
  return { status: r.status, body: await r.json().catch(() => null) };
}

/** XLM necesario para recibir `usdc` USDC en la tesorería (mejor ruta del DEX de testnet). null = sin ruta. */
export async function xlmForUsdc(usdc: number): Promise<{ xlm: number; path: any[] } | null> {
  const q = new URLSearchParams({ source_assets: 'native', destination_asset_type: 'credit_alphanum4', destination_asset_code: 'USDC', destination_asset_issuer: TESTNET_USDC_ISSUER, destination_amount: up7(usdc) });
  const r = await getJson(`${TESTNET_HORIZON}/paths/strict-receive?${q}`);
  const recs: any[] = (r.body?._embedded?.records ?? []).filter((x: any) => Number(x.source_amount) > 0 && x.source_asset_type === 'native');
  if (r.status !== 200 || !recs.length) return null;
  const best = recs.reduce((a, b) => (Number(b.source_amount) < Number(a.source_amount) ? b : a));
  return { xlm: Number(best.source_amount), path: (best.path ?? []).map(assetOf) };
}

/** SEP-7 (web+stellar:pay): monto, destino, memo y red (testnet). Lo abren LOBSTR y otros wallets; también va en el QR. */
export function sep7Pay(p: { destination: string; amount: string; asset: CryptoAsset; memo: string; msg: string }) {
  const q: [string, string][] = [['destination', p.destination], ['amount', p.amount]];
  if (p.asset === 'USDC') q.push(['asset_code', 'USDC'], ['asset_issuer', TESTNET_USDC_ISSUER]);
  q.push(['memo', p.memo], ['memo_type', 'MEMO_TEXT'], ['msg', p.msg.slice(0, 300)], ['network_passphrase', Networks.TESTNET]);
  return 'web+stellar:pay?' + q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}
export const sep7Tx = (xdr: string, msg: string) => `web+stellar:tx?xdr=${encodeURIComponent(xdr)}&msg=${encodeURIComponent(msg.slice(0, 300))}&network_passphrase=${encodeURIComponent(Networks.TESTNET)}`;

export interface Quote { asset: CryptoAsset; amount: string; amountUsdc: number; expiresAt: string; at: string; xlmQuoted?: number; slippage?: number }

/** Cotización + datos para pagar. buyer (opcional, XLM): XDR de path payment strict-receive que firma el wallet del comprador. */
export async function cryptoQuote(order: any, asset: unknown, buyer?: unknown) {
  if (!cryptoEnabled()) throw CRYPTO_ERR.unavailable();
  if (asset !== 'USDC' && asset !== 'XLM') throw CRYPTO_ERR.asset();
  if (order.funded_tx || order.status !== 'escrow_creado' || !order.contract_id) throw CRYPTO_ERR.state();
  const amountUsdc = Number(order.amount_usdc);
  const now = deps.now();
  const expiresAt = new Date(now + quoteMinutes() * 60_000).toISOString();
  const memo = cryptoMemo(order.slug);
  const destination = deps.treasury();
  const msg = `Meteorito: pedido ${order.slug.toUpperCase()}`;
  let q: Quote; let route: any[] = [];
  if (asset === 'USDC') q = { asset, amount: up7(amountUsdc), amountUsdc, expiresAt, at: new Date(now).toISOString() };
  else {
    const best = await xlmForUsdc(amountUsdc);
    if (!best) throw CRYPTO_ERR.noRoute();
    route = best.path;
    q = { asset, amount: up7(best.xlm * (1 + xlmSlippage())), amountUsdc, expiresAt, at: new Date(now).toISOString(), xlmQuoted: best.xlm, slippage: xlmSlippage() };
  }
  let pathTx: { xdr: string; uri: string } | null = null;
  if (asset === 'XLM' && buyer != null && buyer !== '') {
    if (typeof buyer !== 'string' || !StrKey.isValidEd25519PublicKey(buyer.trim())) throw CRYPTO_ERR.address();
    const b = buyer.trim();
    const seq = await deps.sequence(b);
    if (seq == null) throw CRYPTO_ERR.noAccount();
    const tx = new TransactionBuilder(new Account(b, seq), { fee: '10000', networkPassphrase: Networks.TESTNET,
      timebounds: { minTime: 0, maxTime: Math.floor(Date.parse(expiresAt) / 1000) } })
      .addOperation(Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax: q.amount, destination, destAsset: usdcAsset(), destAmount: up7(amountUsdc), path: route }))
      .addMemo(Memo.text(memo)).build();
    const xdr = tx.toXDR();
    pathTx = { xdr, uri: sep7Tx(xdr, msg) };
  }
  await logEvent(order.id, 'crypto_quote', { ...q, ...(pathTx ? { pathTx: true } : {}) });
  return {
    asset, amount: q.amount, amountUsdc, destination, memo, memoType: 'text', expiresAt, network: 'testnet',
    ...(asset === 'USDC' ? { issuer: TESTNET_USDC_ISSUER } : { slippage: q.slippage }),
    uri: sep7Pay({ destination, amount: q.amount, asset, memo, msg }),
    ...(pathTx ? { pathTx } : {}),
  };
}

export interface CryptoPayment { id: string; from: string; asset: CryptoAsset; amount: number; hash: string; at: string }
/** Pagos a la tesorería con el memo del pedido desde `since` (Horizon, más nuevo primero, hasta 5 páginas). */
export async function cryptoPayments(order: any, since: string): Promise<CryptoPayment[]> {
  const t = deps.treasury(); const memo = cryptoMemo(order.slug); const out: CryptoPayment[] = [];
  let url = `${TESTNET_HORIZON}/accounts/${t}/payments?order=desc&limit=200&join=transactions`;
  for (let page = 0; page < 5 && url; page++) {
    const r = await getJson(url);
    if (r.status === 404) return out;
    if (r.status !== 200) throw err(502, 'crypto_horizon_down', 'Stellar no responde en este momento. Intenta de nuevo en unos segundos.');
    const recs: any[] = r.body?._embedded?.records ?? [];
    let older = false;
    for (const o of recs) {
      if (String(o.created_at) < since) { older = true; continue; }
      if (o.transaction_successful === false || o.to !== t || o.from === t) continue;
      const tx = o.transaction ?? {};
      if (tx.memo_type !== 'text' || tx.memo !== memo) continue;
      if (!['payment', 'path_payment_strict_receive', 'path_payment_strict_send'].includes(o.type)) continue;
      const asset: CryptoAsset | null = o.asset_type === 'native' ? 'XLM' : o.asset_code === 'USDC' && o.asset_issuer === TESTNET_USDC_ISSUER ? 'USDC' : null;
      if (!asset || !(Number(o.amount) > 0)) continue;
      out.push({ id: String(o.id), from: String(o.from), asset, amount: Number(o.amount), hash: String(o.transaction_hash), at: String(o.created_at) });
    }
    if (older || recs.length < 200) break;
    url = r.body?._links?.next?.href ?? '';
    if (!url.startsWith(TESTNET_HORIZON + '/')) break; // nunca seguir un link fuera de Horizon testnet
  }
  return out;
}

async function events(orderId: string, kinds: string[]): Promise<any[]> {
  const { data, error } = await db().from('order_events').select('id, kind, detail, created_at').eq('order_id', orderId).in('kind', kinds);
  if (error) throw error;
  return ((data ?? []) as any[]).sort((a, b) => Number(a.id) - Number(b.id));
}
/** Lock de fondeo (misma fila que el SINPE simulado / tarjeta). Un fondeo fallido se puede reintentar. */
async function claimFunding(order: any): Promise<boolean> {
  const { error } = await db().from('ramp_mock_payments').insert({ order_id: order.id, amount_usdc: Number(order.amount_usdc), state: 'pending' });
  if (!error) return true;
  const { data } = await db().from('ramp_mock_payments').update({ state: 'pending' }).eq('order_id', order.id).eq('state', 'failed').select('order_id');
  return !!data?.length;
}
const releaseClaim = (order: any) => db().from('ramp_mock_payments').delete().eq('order_id', order.id).eq('state', 'pending');

export type CryptoState = 'waiting' | 'underpaid' | 'expired' | 'processing' | 'funded';
export interface CryptoStatus {
  state: CryptoState; asset: CryptoAsset | null; received: { USDC: number; XLM: number };
  missing?: { asset: CryptoAsset; amount: string }; expiresAt?: string | null; fundedTx?: string; pin?: string | null; refunded?: { asset: CryptoAsset; amount: string; hash: string }[];
}

/** ¿Llegó el pago? Si cubre el pedido: (convierte XLM) -> fondea el escrow -> devuelve el excedente. Idempotente. */
export async function cryptoStatus(order: any): Promise<CryptoStatus> {
  if (!testnetOnly()) throw CRYPTO_ERR.unavailable();
  const evs = await events(order.id, ['crypto_quote', 'crypto_refund', 'funded']);
  const quotes = evs.filter((e) => e.kind === 'crypto_quote');
  const last: Quote | null = quotes.length ? quotes[quotes.length - 1].detail : null;
  const since = new Date(Date.parse(order.created_at ?? quotes[0]?.created_at ?? new Date(deps.now() - 864e5).toISOString()) - 60_000).toISOString();
  const consumed = new Set<string>(evs.flatMap((e) => (e.kind === 'crypto_refund' || e.kind === 'funded' ? (e.detail?.payIds ?? []) : []) as string[]));
  const all = quotes.length || order.funded_tx ? await cryptoPayments(order, since) : [];
  const fresh = all.filter((p) => !consumed.has(p.id));
  const sum = (a: CryptoAsset) => r7(fresh.filter((p) => p.asset === a).reduce((s, p) => s + p.amount, 0));
  const received = { USDC: sum('USDC'), XLM: sum('XLM') };
  const asset = last?.asset ?? null;
  // Ya pagado (con cripto o con otro método): todo pago nuevo con este memo se devuelve completo.
  if (order.funded_tx || order.status !== 'escrow_creado') {
    const refunded = fresh.length && (await claimRelease(order)) ? await refundAll(order, fresh, 'late') : [];
    return order.funded_tx ? { state: 'funded', asset, received, fundedTx: order.funded_tx, pin: null, ...(refunded.length ? { refunded } : {}) } : { state: 'processing', asset, received };
  }
  const need = Number(order.amount_usdc);
  const expiresAt = last?.expiresAt ?? null;
  const expired = !!expiresAt && Date.parse(expiresAt) < deps.now();
  if (!fresh.length) return { state: expired ? 'expired' : quotes.length ? 'waiting' : 'expired', asset, received, expiresAt };

  const shortUsdc = r7(need - received.USDC);
  let conv: { xlm: number; path: any[] } | null = null;
  if (shortUsdc > EPS) {
    if (!(received.XLM > 0)) return { state: 'underpaid', asset: asset ?? 'USDC', received, missing: { asset: 'USDC', amount: up7(shortUsdc) }, expiresAt };
    conv = await xlmForUsdc(shortUsdc);
    if (!conv) throw CRYPTO_ERR.noRoute();
    if (conv.xlm > received.XLM + EPS) {
      const missing = up7(conv.xlm * (1 + xlmSlippage()) - received.XLM);
      return { state: 'underpaid', asset: 'XLM', received, missing: { asset: 'XLM', amount: missing }, expiresAt };
    }
  }
  if (!(await claimFunding(order))) return { state: 'processing', asset, received };
  const memo = cryptoMemo(order.slug);
  let xlmSpent = 0; let convertTx: string | null = null;
  if (conv) {
    try { const c = await deps.convert({ usdc: up7(shortUsdc), sendMax: down7(received.XLM), path: conv.path, memo }); xlmSpent = c.xlmSpent ?? received.XLM; convertTx = c.hash; }
    catch (e: any) {
      await releaseClaim(order);
      await logEvent(order.id, 'crypto_convert_failed', { error: String(e?.message ?? e).slice(0, 300), xlm: received.XLM, usdc: shortUsdc });
      return { state: 'underpaid', asset: 'XLM', received, missing: { asset: 'XLM', amount: up7(Math.max(conv.xlm * xlmSlippage(), DUST.XLM)) }, expiresAt };
    }
    await logEvent(order.id, 'crypto_converted', { hash: convertTx, xlmSpent, usdc: shortUsdc, xlmReceived: received.XLM });
  }
  const payer = fresh[fresh.length - 1].from;
  const r = await deps.fund(order.id, { ramp: 'crypto', asset: conv ? (received.USDC > 0 ? 'USDC+XLM' : 'XLM') : 'USDC', payer, payIds: fresh.map((p) => p.id), txs: [...new Set(fresh.map((p) => p.hash))], ...(convertTx ? { convertTx, xlmSpent } : {}) });
  // Excedente: lo que sobró del XLM convertido y el USDC de más vuelven al wallet que pagó (menos el polvo).
  const refunded: { asset: CryptoAsset; amount: string; hash: string }[] = [];
  const back = async (a: CryptoAsset, amount: number) => {
    if (!(amount >= DUST[a])) return;
    try { const x = await deps.refund({ to: payer, asset: a, amount: down7(amount), memo: `${memo} devolucion` }); refunded.push({ asset: a, amount: down7(amount), hash: x.hash }); }
    catch (e: any) { console.warn('[crypto] devolución falló', e?.message); await logEvent(order.id, 'crypto_refund_failed', { asset: a, amount: down7(amount), to: payer, error: String(e?.message ?? e).slice(0, 300) }); }
  };
  await back('USDC', r7(received.USDC - (conv ? received.USDC : need)));
  await back('XLM', r7(conv ? received.XLM - xlmSpent : received.XLM));
  if (refunded.length) await logEvent(order.id, 'crypto_refund', { reason: 'excess', to: payer, refunded });
  return { state: 'funded', asset: asset ?? (conv ? 'XLM' : 'USDC'), received, fundedTx: r.fundedTx, pin: r.pin, ...(refunded.length ? { refunded } : {}) };
}

/** Mutex corto para devoluciones de pagos tardíos (mismo patrón que el cron: release_lock_until). */
async function claimRelease(order: any): Promise<boolean> {
  const now = new Date(deps.now());
  const { data } = await db().from('orders').update({ release_lock_until: new Date(now.getTime() + 60_000).toISOString() })
    .eq('id', order.id).or(`release_lock_until.is.null,release_lock_until.lt.${now.toISOString()}`).select('id');
  return !!data?.length;
}
async function refundAll(order: any, pays: CryptoPayment[], reason: string) {
  const memo = cryptoMemo(order.slug); const out: { asset: CryptoAsset; amount: string; hash: string }[] = [];
  try {
    for (const p of pays) {
      if (!(p.amount >= DUST[p.asset])) continue;
      try { const x = await deps.refund({ to: p.from, asset: p.asset, amount: down7(p.amount), memo: `${memo} devolucion` }); out.push({ asset: p.asset, amount: down7(p.amount), hash: x.hash }); }
      catch (e: any) { await logEvent(order.id, 'crypto_refund_failed', { asset: p.asset, amount: down7(p.amount), to: p.from, error: String(e?.message ?? e).slice(0, 300) }); }
    }
    await logEvent(order.id, 'crypto_refund', { reason, payIds: pays.map((p) => p.id), refunded: out });
  } finally { await db().from('orders').update({ release_lock_until: null }).eq('id', order.id); }
  return out;
}

/** Cron: pedidos esperando cripto (cotización en las últimas 24 h). Así se fondea aunque el comprador cierre la pantalla. */
export async function cryptoCronPass(limit = 10): Promise<{ slug: string; state?: string; error?: string }[]> {
  if (!cryptoEnabled()) return [];
  const since = new Date(deps.now() - 864e5).toISOString();
  const { data, error } = await db().from('order_events').select('order_id').eq('kind', 'crypto_quote').gt('created_at', since).limit(200);
  if (error) return [];
  const ids = [...new Set(((data ?? []) as any[]).map((e) => e.order_id))];
  if (!ids.length) return [];
  const { data: orders } = await db().from('orders').select('*').in('id', ids).eq('status', 'escrow_creado').limit(limit);
  const out = [];
  for (const o of (orders ?? []) as any[]) {
    try { const s = await cryptoStatus(o); out.push({ slug: o.slug, state: s.state }); }
    catch (e: any) { out.push({ slug: o.slug, error: String(e?.message ?? e).slice(0, 200) }); }
  }
  return out;
}
