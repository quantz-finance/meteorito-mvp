import { Keypair, Networks, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { feeBumpAndSend, validateEscrowTx } from './feebump';
import { createHash, randomInt } from 'node:crypto';
import { env, releaseBlockedUntil } from './env';
import { deliveryModeOf, isFaceToFace, protectionOf } from './agreement';
import { cameraPhoto, captureTime, captureUrl, checkCaptureToken } from './capture';
import { db, advance, logEvent } from './db';
import { HttpError } from './auth';
import * as tw from './tw';
import { assertReceiverReady, SELLER_NOT_READY } from './wallet';
import { tightenTimebounds } from './timebounds';

/** Llamadas on-chain que usan el envío y la liberación. Los tests las reemplazan (sin red). */
type Chain = Pick<typeof tw, 'releaseGuard' | 'approveMilestone' | 'getBalance' | 'releaseFunds' | 'changeMilestoneStatus' | 'changeMilestoneStatusXdr' | 'resolveDispute'>;
let testChain: Partial<Chain> | null = null;
export const __setChainForTests = (c: Partial<Chain> | null) => { testChain = c; };
export const chain = (): Chain => (testChain ? { ...tw, ...testChain } : tw) as Chain;

export interface ShipEvidence { at: string; photo: string; captured_at: string; token_id: string; purpose: 'ship'; note?: string }
/** Evidencia de "Ya lo envié": la FOTO ES OBLIGATORIA y solo de la cámara de la app (token de captura 'ship' de ESTE pedido y
 *  de este vendedor; la foto en la carpeta del token). {at} = hora del servidor; {captured_at, token_id, purpose} de la captura;
 *  note (número de guía) opcional, recortada. Todo entra al hash de evidencia. Lanza 400 si falta o no es de la cámara. */
export function shipEvidence(raw: any, sellerSub: string, slug: string): ShipEvidence {
  if (raw != null && typeof raw !== 'object') throw new HttpError(400, 'evidencia inválida');
  if (raw?.photo == null || raw.photo === '') throw Object.assign(new HttpError(400, 'Toma la foto del paquete o del comprobante con la cámara para marcarlo como enviado.'), { code: 'ship_photo_required' });
  let c;
  try { c = checkCaptureToken(raw.capture_token, { purpose: 'ship', subs: [sellerSub], ref: slug, allowExpired: true }); }
  catch (e: any) { throw Object.assign(new HttpError(400, e.message), { code: e.code === 'capture_token_required' ? 'ship_photo_required' : e.code }); }
  const cam = cameraPhoto(raw.photo, sellerSub);
  if (!cam || cam.purpose !== 'ship' || cam.id !== c.id || raw.photo !== captureUrl(c)) throw Object.assign(new HttpError(400, 'Toma la foto del paquete o del comprobante con la cámara de Meteorito.'), { code: 'bad_ship_photo' });
  const ev: ShipEvidence = { at: new Date().toISOString(), photo: raw.photo, captured_at: captureTime(raw.captured_at, c), token_id: c.id, purpose: 'ship' };
  const note = typeof raw?.note === 'string' ? raw.note.trim().slice(0, 200) : '';
  if (note) ev.note = note;
  return ev;
}

const pub = (secret: string) => Keypair.fromSecret(secret).publicKey();

/** Monto bruto a depositar para que el vendedor reciba price_crc neto del 0.3% de TW. Siempre desde el pedido en DB. */
export function grossUsdc(priceCrc: number) {
  const net = priceCrc / env.crcUsdcRate();
  // Redondeo hacia arriba al stroop (1e-7), no al centavo: con centavos el vendedor recibía hasta ~₡5 de más (1 ¢ × ₡510)
  // y el comprador pagaba de más (ej. ₡15 000 -> el vendedor veía ₡15 005). El -1e-9 evita que el ruido de float suba un stroop.
  return Math.ceil((net / (1 - env.twFee())) * 1e7 - 1e-6) / 1e7;
}

export function serviceProviderFor(order: any) {
  return env.spMode() === 'backend' ? pub(env.serviceSecret()) : order.seller_address;
}

export async function deployFor(order: any, buyerAddress: string, buyerUserId: string) {
  if (order.contract_id) return order.contract_id as string;
  if (order.status !== 'creado') throw new HttpError(409, `status ${order.status}`);
  if (buyerAddress === order.seller_address || buyerUserId === order.seller_user_id) throw new HttpError(400, 'no puedes comprar tu propio link');
  // Receiver sin cuenta/trustline USDC -> TW responde 400 crudo. Lo detectamos antes con un error accionable.
  await assertReceiverReady(order.seller_address);
  const amount = grossUsdc(Number(order.price_crc));
  const { contractId, hash } = await tw.deploySingleRelease({
    signerSecret: env.deployerSecret(),
    engagementId: order.id,
    title: `Meteorito ${order.slug}`,
    description: (`${order.brand ?? ''} ${order.model ?? ''}`.trim() || `Pedido ${order.slug}`).slice(0, 200),
    amount,
    roles: {
      approver: pub(env.approverSecret()),
      serviceProvider: serviceProviderFor(order),
      releaseSigner: pub(env.releaseSignerSecret()),
      receiver: order.seller_address,
      disputeResolver: env.disputeResolverPublic(),
      platformAddress: env.platformPublic(),
    },
  }).catch((e: any) => {
    if (/trustline|could not be validated/i.test(String(e?.message))) throw Object.assign(new HttpError(409, SELLER_NOT_READY), { code: 'seller_wallet_not_ready' });
    throw e;
  });
  await advance(order.id, 'creado', {
    contract_id: contractId, deploy_tx: hash, buyer_address: buyerAddress, buyer_user_id: buyerUserId,
    amount_usdc: amount, fx_crc_per_usdc: env.crcUsdcRate(), sp_mode: env.spMode(), status: 'escrow_creado',
  });
  await logEvent(order.id, 'escrow_deployed', { contractId, hash, amount });
  return contractId;
}

/** ramp-provider.mock: SINPE simulado (y pago con tarjeta ya verificado: api/_lib/lendara.ts). Fondea desde treasury. Monto SIEMPRE del pedido en DB. Idempotente por order_id. */
export async function mockRampFund(orderId: string, meta: Record<string, unknown> = { ramp: 'mock' }) {
  const { data: order } = await db().from('orders').select('*').eq('id', orderId).single();
  if (order.funded_tx) return { fundedTx: order.funded_tx as string, pin: null };
  if (order.status !== 'escrow_creado') throw new HttpError(409, `status ${order.status}`);
  const amount = Number(order.amount_usdc);
  const { error: lockErr } = await db().from('ramp_mock_payments').insert({ order_id: order.id, amount_usdc: amount });
  if (lockErr) throw new HttpError(409, 'fondeo ya en curso o hecho');
  // El escrow on-chain debe ser exactamente por el monto del pedido (nunca 'balance > 0').
  const esc = await tw.onChainEscrow(order.contract_id);
  const before = await tw.getBalance(order.contract_id);
  let sent;
  try { sent = await tw.fundEscrow(order.contract_id, amount, env.treasurySecret()); }
  catch (e) { await db().from('ramp_mock_payments').update({ state: 'failed' }).eq('order_id', order.id); throw e; }
  const bal = await tw.getBalance(order.contract_id);
  const chk = fundingCheck({ orderAmount: amount, escrowAmountStroops: esc?.amount, before, after: bal });
  if (!chk.ok) { await logEvent(order.id, 'funding_mismatch', { reason: chk.reason, amount }); throw new HttpError(409, `fondeo no verificado: ${chk.reason}`); }
  const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db().from('ramp_mock_payments').update({ state: 'sent', tx_hash: sent.hash }).eq('order_id', order.id);
  await advance(order.id, 'escrow_creado', {
    funded_tx: sent.hash, funded_at: new Date().toISOString(), status: 'fondeado', delivery_pin_hash: pinHash(order.id, pin), ...fundedAgreement(order),
  });
  await logAgreement(order);
  await logEvent(order.id, 'funded', { hash: sent.hash, amount, ramp: 'mock', ...meta });
  return { fundedTx: sent.hash, pin };
}

/** Pago directo en USDC (sin SINPE): el comprador firma fund-escrow con su wallet; wallet platform paga el fee.
 *  Misma verificación on-chain que el ramp simulado (monto exacto del pedido en DB). Devuelve el PIN una sola vez. */
export async function fundDirectXdr(order: any) {
  if (order.status !== 'escrow_creado' || !order.contract_id) throw new HttpError(409, `status ${order.status}`);
  const x = await tw.fundEscrowXdr(order.contract_id, Number(order.amount_usdc), order.buyer_address);
  return { unsignedXdr: x.unsignedTransaction, amountUsdc: Number(order.amount_usdc) };
}
export async function fundDirect(orderId: string, signedXdr: string) {
  const { data: order } = await db().from('orders').select('*').eq('id', orderId).single();
  if (order.funded_tx) return { fundedTx: order.funded_tx as string, pin: null };
  if (order.status !== 'escrow_creado') throw new HttpError(409, `status ${order.status}`);
  const amount = Number(order.amount_usdc);
  const inner = validateEscrowTx(signedXdr, { contractId: order.contract_id, fns: ['fund_escrow'], source: order.buyer_address });
  const esc = await tw.onChainEscrow(order.contract_id);
  const before = await tw.getBalance(order.contract_id);
  const sent = await feeBumpAndSend(inner);
  const bal = await tw.getBalance(order.contract_id);
  const chk = fundingCheck({ orderAmount: amount, escrowAmountStroops: esc?.amount, before, after: bal });
  if (!chk.ok) { await logEvent(order.id, 'funding_mismatch', { reason: chk.reason, amount, direct: true }); throw new HttpError(409, `fondeo no verificado: ${chk.reason}`); }
  const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await advance(order.id, 'escrow_creado', {
    funded_tx: sent.hash, funded_at: new Date().toISOString(), status: 'fondeado', delivery_pin_hash: pinHash(order.id, pin), ...fundedAgreement(order),
  });
  await logAgreement(order);
  await logEvent(order.id, 'funded', { hash: sent.hash, amount, ramp: 'direct_usdc' });
  return { fundedTx: sent.hash, pin };
}

/** Cara a cara: el plazo de protección corre desde el pago. */
export function fundedAgreement(order: any, at = Date.now()) {
  return isFaceToFace(order) ? { auto_release_at: new Date(at + protectionOf(order) * 60_000).toISOString() } : {};
}
/** Al pagar el comprador acepta el acuerdo que vio antes de pagar: queda en order_events. */
export async function logAgreement(order: any) {
  await logEvent(order.id, 'agreement_accepted', { delivery_mode: deliveryModeOf(order), protection_minutes: protectionOf(order) });
}

export const pinHash = (orderId: string, pin: string) => createHash('sha256').update(`${env.pinPepper()}:${orderId}:${pin}`).digest('hex');
export const evidenceHash = (evidence: unknown) => 'sha256:' + createHash('sha256').update(JSON.stringify(evidence)).digest('hex');

export type ApproveReason = 'buyer_confirm' | 'pin' | 'timeout';

/** Backend approver aprueba + release signer libera, verificando on-chain antes. */
export async function approveAndRelease(order: any, reason: ApproveReason) {
  // Cara a cara no tiene paso de envío: se aprueba y libera desde 'fondeado' (PIN, "Recibí" o plazo desde el pago).
  // Probado en testnet: approve_milestone de TW funciona sin change_milestone_status previo.
  const f2fPaid = order.status === 'fondeado' && isFaceToFace(order);
  if (order.status !== 'enviado' && order.status !== 'entregado' && !f2fPaid) throw new HttpError(409, `status ${order.status}`);
  // PIN bloqueado (3 intentos fallidos del vendedor): el plazo NO libera solo; queda para revisión o confirmación del comprador.
  if (reason === 'timeout' && (order.pin_attempts ?? 0) >= 3) throw Object.assign(new HttpError(423, 'PIN bloqueado: el pago no se libera solo; lo revisamos.'), { code: 'pin_locked' });
  if (order.dispute_tx || order.disputed_at) throw new HttpError(409, 'pedido en disputa');
  // Plazo: nunca antes de 7 días (o la ventana vigente) desde "Ya lo envié", aunque auto_release_at sea viejo y corto.
  // Extensión pendiente: congela hasta la respuesta (máx. 24 h).
  if (reason === 'timeout' && order.status !== 'entregado' && Date.parse(releaseBlockedUntil(order)) > Date.now())
    throw Object.assign(new HttpError(425, 'Todavía no vence el plazo de liberación automática.'), { code: 'not_due', dueAt: releaseBlockedUntil(order) });
  // Verificación ON-CHAIN (contrato directo, no indexador de TW) antes de aprobar y antes de liberar.
  const assertOpen = async () => {
    const g = await chain().releaseGuard(order.contract_id);
    if (g.disputed || g.released || g.resolved) {
      await logEvent(order.id, 'release_refused', { reason, onchain: { disputed: g.disputed, released: g.released, resolved: g.resolved } });
      throw new HttpError(409, 'escrow en disputa o cerrado (on-chain)');
    }
    return g;
  };
  if (order.status === 'enviado' || f2fPaid) {
    await assertOpen();
    const ap = await chain().approveMilestone(order.contract_id, env.approverSecret());
    await advance(order.id, order.status, { approved_tx: ap.hash, approval_reason: reason, delivered_at: new Date().toISOString(), status: 'entregado' });
    await logEvent(order.id, 'approved', { hash: ap.hash, reason });
  }
  const g = await assertOpen();
  if (!g.approved) throw new HttpError(409, 'hito no aprobado on-chain');
  const bal = await chain().getBalance(order.contract_id);
  const rc = releaseCheck(bal, Number(order.amount_usdc));
  if (!rc.ok) { await logEvent(order.id, 'release_refused', { reason: rc.reason }); throw new HttpError(409, `sin fondos on-chain (${bal})`); }
  if (rc.excess > 0) console.warn(`[release] ${order.id}: excedente ${rc.excess} USDC queda en el contrato (TW libera solo escrow.amount)`);
  const rel = await chain().releaseFunds(order.contract_id, env.releaseSignerSecret());
  await advance(order.id, 'entregado', { released_tx: rel.hash, released_at: new Date().toISOString(), status: 'liberado' });
  await logEvent(order.id, 'released', { hash: rel.hash, reason, hours_to_release: order.funded_at ? Math.round((Date.now() - Date.parse(order.funded_at)) / 36e5 * 10) / 10 : undefined });
  return { releasedTx: rel.hash };
}

/* ---------- Disputas ---------- */
export const DISPUTE_REASONS = ['no_llego', 'no_funciona', 'no_es_lo_descrito', 'otro'] as const;
export type DisputeReason = (typeof DISPUTE_REASONS)[number];
const DISPUTABLE = ['fondeado', 'enviado', 'entregado'];

/**
 * Solo el comprador, solo antes de liberar. Idempotente: una disputa por pedido (PK en disputes);
 * si ya está abierta devuelve la existente. On-chain: dispute-escrow firmado por el approver
 * (rol del lado comprador) y enviado con fee-bump de la wallet platform.
 */
export async function openDispute(order: any, buyerSub: string, input: { reason: DisputeReason; description: string | null; evidence: string[] }) {
  if (order.buyer_user_id !== buyerSub) throw new HttpError(403, 'solo el comprador puede abrir una disputa');
  const { data: existing } = await db().from('disputes').select('*').eq('order_id', order.id).maybeSingle();
  if (order.status === 'en_disputa' || existing?.state === 'open') return { disputeTx: order.dispute_tx ?? existing?.dispute_tx, already: true };
  if (!DISPUTABLE.includes(order.status) || order.released_tx) throw new HttpError(409, `no se puede disputar en status ${order.status}`);
  if (!existing) {
    const { error } = await db().from('disputes').insert({ order_id: order.id, reason: input.reason, description: input.description, evidence: input.evidence, opened_by: buyerSub });
    if (error && error.code !== '23505') throw error;
  }
  // Lock de release: que el cron no libere mientras abrimos la disputa.
  await db().from('orders').update({ release_lock_until: new Date(Date.now() + 120_000).toISOString() }).eq('id', order.id);
  try {
    let g = await tw.releaseGuard(order.contract_id);
    if (g.released || g.resolved) throw new HttpError(409, 'el pago ya fue liberado');
    let hash: string | null = null;
    if (!g.disputed) hash = await disputeOnChain(order.contract_id);
    const now = new Date().toISOString();
    await advance(order.id, order.status, { dispute_tx: hash ?? 'onchain-preexisting', disputed_at: now, status: 'en_disputa' });
    await db().from('disputes').update({ state: 'open', dispute_tx: hash }).eq('order_id', order.id);
    await logEvent(order.id, 'dispute_opened', { hash, reason: input.reason, feeBump: true });
    return { disputeTx: hash, already: false };
  } catch (e) {
    await db().from('disputes').update({ state: 'failed' }).eq('order_id', order.id).neq('state', 'open');
    throw e;
  } finally {
    await db().from('orders').update({ release_lock_until: null }).eq('id', order.id);
  }
}
/** dispute-escrow firmado por el approver, validado (1 invocación a NUESTRO contrato) y enviado con fee-bump. Verifica on-chain. */
export async function disputeOnChain(contractId: string): Promise<string> {
  const x = await tw.disputeEscrowXdr(contractId, Keypair.fromSecret(env.approverSecret()).publicKey());
  const inner = signWith(tightenTimebounds(x.unsignedTransaction), env.approverSecret());
  validateEscrowTx(inner.toXDR(), { contractId, fns: ['dispute_escrow'], source: Keypair.fromSecret(env.approverSecret()).publicKey() });
  const { hash } = await feeBumpAndSend(inner);
  const g = await tw.releaseGuard(contractId);
  if (!g.disputed) throw new Error('la disputa no quedó registrada on-chain');
  return hash;
}
function signWith(tx: Transaction, secret: string) { tx.sign(Keypair.fromSecret(secret)); return tx; }

// Resolución de disputas: api/_lib/disputeResolve.ts (la usan el script y el panel admin).

const EPS = 1e-7;
/** Fondeo válido: escrow on-chain por el monto exacto del pedido, el depósito propio cubre el monto (after-before ≥ monto)
 *  y el saldo total ≥ monto. Un depósito parcial o ajeno nunca cuenta como pagado. */
export function fundingCheck(p: { orderAmount: number; escrowAmountStroops: unknown; before: number; after: number }): { ok: true } | { ok: false; reason: string } {
  const escAmt = Number(p.escrowAmountStroops ?? NaN) / 1e7;
  if (!(Math.abs(escAmt - p.orderAmount) < EPS)) return { ok: false, reason: 'escrow_amount_mismatch' };
  if (p.after - p.before + EPS < p.orderAmount) return { ok: false, reason: 'deposit_short' };
  if (p.after + EPS < p.orderAmount) return { ok: false, reason: 'balance_short' };
  return { ok: true };
}
/** TW single-release libera escrow.amount (menos fee TW 0.3%), NO el saldo total (probado en t18): un excedente queda
 *  en el contrato y nunca llega al vendedor. Se exige saldo ≥ monto; el excedente solo se reporta. */
export function releaseCheck(bal: number, orderAmount: number): { ok: true; excess: number } | { ok: false; reason: 'insufficient' } {
  if (bal + EPS < orderAmount) return { ok: false, reason: 'insufficient' };
  return { ok: true, excess: Math.max(0, Math.round((bal - orderAmount) * 1e7) / 1e7) };
}
/** Disputa: el porcentaje se aplica sobre el monto del pedido; el vendedor nunca recibe más que su parte de ese monto.
 *  Excedente (saldo - monto) vuelve al comprador. La suma = saldo (requisito de TW). */
export function disputeSplit(bal: number, orderAmount: number, buyerPct: number) {
  const r = (x: number) => Math.round(x * 1e7) / 1e7;
  const base = Math.min(bal, orderAmount);
  const toSeller = r(base - r(base * buyerPct / 100));
  const toBuyer = r(bal - toSeller);
  return { toBuyer, toSeller };
}
