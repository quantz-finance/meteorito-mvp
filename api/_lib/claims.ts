// Regla v3 "Período de reclamo de 30 días" (lib/rules.ts CLAIM_RULE). Solo pedidos con rules_version >= 3 (033): nada
// retroactivo. Plazos y conteo puros en api/_lib/orderRules.ts (claimWindow, claimCounts, claimHistory).
//  - Después de liberado el pago, quien compra tiene 30 días para reportar un problema (motivo + su versión).
//  - Se le avisa a quien vende, que puede responder ANTES de que el reporte cuente en su historial (48 h desde el aviso).
//  - NO congela fondos ni promete devolución: el pago ya se liberó. El equipo puede marcar el reporte como resuelto.
//  - El historial público de quien vende muestra SOLO el conteo por estado (abierto / respondido / resuelto); el texto de
//    quien compra lo ven solo quien vende y el equipo.
// Tabla order_claims (migración 035). Sin ella: available:false (la app no ofrece reportar) y el perfil no muestra conteo.
import { db, logEvent } from './db';
import { HttpError } from './auth';
import { isBuyerOf, type BuyerIdentity } from './guest';
/** = DISPUTE_REASONS de api/_lib/escrow.ts (aquí sin importar escrow: feed.ts usa claimSummary y no carga Stellar). t101 revisa que coincidan. */
export const CLAIM_REASONS = ['no_llego', 'no_funciona', 'no_es_lo_descrito', 'otro'] as const;
import { claimMessages, isMissingTable, notifyOrder, type PushDeps } from './push';
import { CLAIM_GRACE_HOURS, CLAIM_TEXT_MIN, claimCounts, claimCountsAt, claimHistory, claimRuleApplies, claimStatusOf, claimWindow, type ClaimHistory } from './orderRules';

const H = 3_600_000;
const COLS = 'order_id, slug, seller_user_id, buyer_sub, reason, description, status, opened_at, seller_notified_at, counts_at, seller_response, responded_at, resolved_at, resolved_by, resolution_note';
export interface ClaimOpts { now?: number; push?: PushDeps }
const err = (status: number, code: string, msg: string) => Object.assign(new HttpError(status, msg), { code });

/** Reporte del pedido. undefined = no hay tabla (035). */
async function loadClaim(orderId: string): Promise<any | null | undefined> {
  const { data, error } = await db().from('order_claims').select(COLS).eq('order_id', orderId).maybeSingle();
  if (error) { if (isMissingTable(error)) return undefined; throw error; }
  return data ?? null;
}
const view = (c: any, now: number) => c ? {
  status: claimStatusOf(c), reason: c.reason, description: c.description, opened_at: c.opened_at, counts_at: claimCountsAt(c),
  counts: claimCounts(c, now), seller_response: c.seller_response ?? null, responded_at: c.responded_at ?? null, resolved_at: c.resolved_at ?? null,
} : null;

/** Quien compra: ¿puede reportar?, hasta cuándo y su reporte (si ya lo hizo). */
export async function claimForBuyer(order: any, who: BuyerIdentity, opts: ClaimOpts = {}) {
  if (!isBuyerOf(order, who)) throw err(403, 'not_buyer', 'Solo quien compró puede reportar un problema.');
  const now = opts.now ?? Date.now();
  const w = claimWindow(order, now);
  if (!claimRuleApplies(order)) return { available: true, applies: false, window: w, claim: null };
  const c = await loadClaim(order.id);
  if (c === undefined) return { available: false, applies: true, window: w, claim: null };
  return { available: true, applies: true, window: w, claim: view(c, now) };
}

/** Quien compra reporta un problema (una vez por pedido, dentro de los 30 días). Idempotente. */
export async function openClaim(order: any, who: BuyerIdentity, input: { reason?: unknown; description?: unknown }, opts: ClaimOpts = {}) {
  if (!isBuyerOf(order, who)) throw err(403, 'not_buyer', 'Solo quien compró puede reportar un problema.');
  if (!claimRuleApplies(order)) throw err(409, 'claim_not_applicable', 'Esta compra no tiene período de reclamo.');
  const now = opts.now ?? Date.now();
  const w = claimWindow(order, now);
  if (w.phase === 'na') throw err(409, 'claim_not_released', 'Puedes reportar un problema después de liberado el pago.');
  const existing = await loadClaim(order.id);
  if (existing === undefined) throw err(503, 'claims_unavailable', 'Por ahora no se pueden reportar problemas. Intenta más tarde.');
  if (existing) return { already: true, claim: view(existing, now) };
  if (w.phase === 'closed') throw err(409, 'claim_window_closed', 'Pasaron los 30 días para reportar un problema con esta compra.');
  const reason = String(input.reason ?? '');
  if (!(CLAIM_REASONS as readonly string[]).includes(reason)) throw err(400, 'bad_reason', 'Elige qué pasó.');
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (description.length < CLAIM_TEXT_MIN || description.length > 2000) throw err(400, 'claim_text_required', 'Cuéntanos qué pasó (mínimo 10 caracteres).');
  const at = new Date(now).toISOString();
  const row = { order_id: order.id, slug: order.slug, seller_user_id: order.seller_user_id, buyer_sub: order.buyer_user_id, reason, description,
    status: 'abierto', opened_at: at, counts_at: new Date(now + CLAIM_GRACE_HOURS * H).toISOString() };
  const { error } = await db().from('order_claims').insert(row);
  if (error) {
    if (error.code === '23505') { const c = await loadClaim(order.id); return { already: true, claim: view(c, now) }; }
    if (isMissingTable(error)) throw err(503, 'claims_unavailable', 'Por ahora no se pueden reportar problemas. Intenta más tarde.');
    throw error;
  }
  // Aviso a quien vende; sus 48 h para responder antes de que cuente arrancan con el aviso.
  await notifyOrder(order, opts.push ?? {}, claimMessages(order, 'opened'));
  const sent = opts.now ?? Date.now();
  const counts_at = new Date(sent + CLAIM_GRACE_HOURS * H).toISOString();
  await db().from('order_claims').update({ seller_notified_at: new Date(sent).toISOString(), counts_at }).eq('order_id', order.id).is('seller_notified_at', null);
  await logEvent(order.id, 'claim_opened', { reason, rule: 'reclamo_30_dias', counts_at });
  return { opened: true, claim: view({ ...row, counts_at, seller_notified_at: new Date(sent).toISOString() }, now) };
}

/** Quien vende: el reporte de SU pedido (con el texto de quien compra) y hasta cuándo responder antes de que cuente. */
export async function claimForSeller(order: any, sub: string, opts: ClaimOpts = {}) {
  if (!order || order.seller_user_id !== sub) throw err(404, 'not_found', 'No encontramos este pedido.');
  const now = opts.now ?? Date.now();
  if (!claimRuleApplies(order)) return { available: true, claim: null };
  const c = await loadClaim(order.id);
  if (c === undefined) return { available: false, claim: null };
  return { available: true, claim: view(c, now), can_respond: !!c && c.status !== 'resuelto' };
}

/** Quien vende responde (texto). Se puede responder también después de las 48 h; antes, el reporte cuenta ya respondido. */
export async function respondClaim(order: any, sub: string, input: { body?: unknown }, opts: ClaimOpts = {}) {
  if (!order || order.seller_user_id !== sub) throw err(404, 'not_found', 'No encontramos este pedido.');
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!body || body.length > 1000) throw err(400, 'claim_reply_required', 'Escribe tu respuesta (hasta 1000 caracteres).');
  const c = await loadClaim(order.id);
  if (c === undefined) throw err(503, 'claims_unavailable', 'Por ahora no se pueden responder reportes. Intenta más tarde.');
  if (!c) throw err(404, 'claim_not_found', 'Esta compra no tiene un reporte.');
  if (c.status === 'resuelto') throw err(409, 'claim_resolved', 'Este reporte ya está resuelto.');
  const now = opts.now ?? Date.now(), at = new Date(now).toISOString();
  const first = !c.responded_at;
  const { error } = await db().from('order_claims').update({ seller_response: body, responded_at: c.responded_at ?? at, status: 'respondido' }).eq('order_id', order.id).neq('status', 'resuelto');
  if (error) throw error;
  if (first) { await notifyOrder(order, opts.push ?? {}, claimMessages(order, 'replied')); await logEvent(order.id, 'claim_replied', { rule: 'reclamo_30_dias', in_grace: !claimCounts(c, now) }); }
  return { responded: true, claim: view({ ...c, seller_response: body, responded_at: c.responded_at ?? at, status: 'respondido' }, now) };
}

/** Equipo: reportes (los no resueltos primero). Incluye el texto de las dos partes (solo admins). */
export async function adminClaims(opts: ClaimOpts = {}) {
  const now = opts.now ?? Date.now();
  const { data, error } = await db().from('order_claims').select(COLS).order('opened_at', { ascending: false }).limit(200);
  if (error) { if (isMissingTable(error)) return { available: false, claims: [] }; throw error; }
  const list = (data ?? []).map((c: any) => ({ slug: c.slug, ...view(c, now), resolved_by: c.resolved_by ?? null, resolution_note: c.resolution_note ?? null }));
  list.sort((a: any, b: any) => Number(a.status === 'resuelto') - Number(b.status === 'resuelto'));
  return { available: true, claims: list };
}

/** Equipo: marca un reporte como resuelto (con nota). No mueve fondos. Idempotente. */
export async function resolveClaim(order: any, admin: { email: string }, note: unknown, opts: ClaimOpts = {}) {
  const n = typeof note === 'string' ? note.trim() : '';
  if (n.length < 3 || n.length > 1000) throw err(400, 'note_required', 'Escribe una nota (mínimo 3 caracteres).');
  const c = await loadClaim(order.id);
  if (c === undefined) throw err(503, 'claims_unavailable', 'Falta la migración 035.');
  if (!c) throw err(404, 'claim_not_found', 'Esta compra no tiene un reporte.');
  if (c.status === 'resuelto') return { already: true };
  const at = new Date(opts.now ?? Date.now()).toISOString();
  const { error } = await db().from('order_claims').update({ status: 'resuelto', resolved_at: at, resolved_by: admin.email, resolution_note: n }).eq('order_id', order.id).neq('status', 'resuelto');
  if (error) throw error;
  await notifyOrder(order, opts.push ?? {}, claimMessages(order, 'resolved'));
  await logEvent(order.id, 'claim_resolved', { by: admin.email });
  return { resolved: true };
}

/** Historial público de quien vende: SOLO el conteo por estado de los reportes que ya cuentan. Sin 035 o ante error: null. */
export async function claimSummary(sellerSub: string, now = Date.now()): Promise<ClaimHistory | null> {
  try {
    const { data, error } = await db().from('order_claims').select('status, opened_at, counts_at, responded_at').eq('seller_user_id', sellerSub).limit(5000);
    if (error) return null;
    return claimHistory(data ?? [], now);
  } catch { return null; }
}
