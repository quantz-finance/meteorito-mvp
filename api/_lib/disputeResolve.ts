// Resolución de disputas: UNA sola implementación para el script manual (scripts/resolve-dispute.ts) y el panel admin
// (/admin/disputas -> POST /api/escrow/dispute { action:'admin_decide' }). Reparte el saldo on-chain (disputeSplit),
// firma el dispute resolver, actualiza pedido + disputa y deja auditoría: quién decidió, cuándo, por qué y el resultado.
// Auditoría: tabla dispute_decisions (migración 027) y SIEMPRE también en order_events (kind 'dispute_decision'), así
// funciona sin 027. El secreto del dispute resolver (DISPUTE_RESOLVER_SECRET) es opcional en el servidor: sin él la
// decisión queda registrada como 'pending_onchain' y el panel muestra el comando del script para ejecutarla.
// Reembolsos a compradores invitados: el buyer_address del escrow es la wallet 'platform' (docs/guest-checkout.md), así
// que la parte del comprador llega a 'platform' y hay que devolvérsela por fuera: queda la tarea 'pendiente devolver'.
import { Keypair } from '@stellar/stellar-sdk';
import { HttpError } from './auth';
import { advance, db, logEvent } from './db';
import { chain, disputeSplit } from './escrow';
import { env } from './env';
import { isGuestSub } from './guest';
import { isMissingTable } from './push';
import type { Outcome, RuleResult } from './disputeRules';
import { pctOf } from './disputeRules';

/** Reparto on-chain + actualización de pedido y disputa. buyerPct 0..100 del monto del pedido (excedente al comprador). */
export async function resolveOrderDispute(order: any, resolverSecret: string, buyerPct: number) {
  if (!(buyerPct >= 0 && buyerPct <= 100)) throw new HttpError(400, 'buyerPct 0..100');
  if (order.status !== 'en_disputa') throw new HttpError(409, `status ${order.status}`);
  const g = await chain().releaseGuard(order.contract_id);
  if (!g.disputed) throw new HttpError(409, 'el escrow no está en disputa on-chain');
  const bal = await chain().getBalance(order.contract_id);
  const { toBuyer, toSeller } = disputeSplit(bal, Number(order.amount_usdc), buyerPct);
  const distributions = [
    ...(toBuyer > 0 ? [{ address: order.buyer_address, amount: toBuyer }] : []),
    ...(toSeller > 0 ? [{ address: order.seller_address, amount: toSeller }] : []),
  ];
  const r = await chain().resolveDispute(order.contract_id, resolverSecret, distributions);
  const resolution = { buyerPct, toBuyer, toSeller, balance: bal };
  const now = new Date().toISOString();
  // advance() avisa por push a las dos partes ('resuelto').
  await advance(order.id, 'en_disputa', { resolved_tx: r.hash, resolved_at: now, resolution, status: 'resuelto' });
  await db().from('disputes').update({ state: 'resolved', resolution, resolved_tx: r.hash, resolved_at: now }).eq('order_id', order.id);
  await logEvent(order.id, 'dispute_resolved', { hash: r.hash, ...resolution });
  return { resolvedTx: r.hash as string, ...resolution };
}

/** Secreto del dispute resolver en el servidor (opcional). Debe corresponder a DISPUTE_RESOLVER_PUBLIC. */
export function resolverSecret(): string | null {
  const s = process.env.DISPUTE_RESOLVER_SECRET;
  if (!s) return null;
  try {
    const pub = Keypair.fromSecret(s).publicKey();
    if (process.env.DISPUTE_RESOLVER_PUBLIC && pub !== process.env.DISPUTE_RESOLVER_PUBLIC) { console.error('[disputes] DISPUTE_RESOLVER_SECRET no corresponde a DISPUTE_RESOLVER_PUBLIC'); return null; }
    return s;
  } catch { console.error('[disputes] DISPUTE_RESOLVER_SECRET inválido'); return null; }
}
export const resolveCommand = (slug: string, pct: number) => `DISPUTE_RESOLVER_SECRET=… npx tsx scripts/resolve-dispute.ts ${slug} ${pct}`;

export type DecisionStatus = 'executing' | 'executed' | 'failed' | 'pending_onchain';
export type DecisionSource = 'admin' | 'script' | 'auto_rule';
export interface Decision {
  id?: number | string; order_id: string; slug: string; decided_by: string; decided_by_email: string | null; source: DecisionSource;
  outcome: Outcome; buyer_pct: number; note: string; rule_id: string | null; ai_recommendation: string | null; status: DecisionStatus;
  resolved_tx?: string | null; error?: string | null; to_buyer?: number | null; to_seller?: number | null;
  guest_refund?: 'no_aplica' | 'pendiente' | 'devuelto'; guest_refund_note?: string | null; guest_refunded_at?: string | null; guest_refunded_by?: string | null;
  created_at: string; executed_at?: string | null;
}
const AUDIT_EVENT = 'dispute_decision';
const GUEST_EVENT = 'guest_refund_done';

/** Inserta la decisión en dispute_decisions (si existe 027) y en order_events. Devuelve el id de 027 o null. */
export async function recordDecision(d: Decision): Promise<{ id: number | string | null; table: boolean }> {
  let id: number | string | null = null, table = false;
  const { data, error } = await db().from('dispute_decisions').insert(d).select('id');
  if (!error) { id = data?.[0]?.id ?? null; table = true; }
  else if (!isMissingTable(error)) console.warn('[disputes] auditoría (027) falló', error.code ?? error.message);
  await logEvent(d.order_id, AUDIT_EVENT, { ...d, audit_id: id });
  return { id, table };
}
export async function updateDecision(ref: { id: number | string | null; table: boolean }, orderId: string, patch: Partial<Decision>) {
  if (ref.table && ref.id != null) {
    const { error } = await db().from('dispute_decisions').update(patch).eq('id', ref.id);
    if (error && !isMissingTable(error)) console.warn('[disputes] auditoría (027) update falló', error.code ?? error.message);
  }
  await logEvent(orderId, AUDIT_EVENT + '_update', { audit_id: ref.id, ...patch });
}

/** Decisiones de unos pedidos: 027 si existe; si no, reconstruidas desde order_events. Más reciente primero. */
export async function loadDecisions(orderIds: string[]): Promise<{ byOrder: Record<string, Decision[]>; table: boolean }> {
  const byOrder: Record<string, Decision[]> = {};
  if (!orderIds.length) return { byOrder, table: false };
  const { data, error } = await db().from('dispute_decisions').select('*').in('order_id', orderIds).order('created_at', { ascending: false });
  if (!error) { for (const d of data ?? []) (byOrder[d.order_id] ??= []).push(d); return { byOrder, table: true }; }
  if (!isMissingTable(error)) console.warn('[disputes] lectura de auditoría falló', error.code ?? error.message);
  const { data: evs } = await db().from('order_events').select('order_id, kind, detail, created_at').in('order_id', orderIds)
    .in('kind', [AUDIT_EVENT, AUDIT_EVENT + '_update', GUEST_EVENT]).order('created_at', { ascending: true });
  const last: Record<string, Decision> = {};
  for (const e of evs ?? []) {
    if (e.kind === AUDIT_EVENT) { const d = { ...(e.detail as Decision), id: (e.detail as any)?.audit_id ?? `ev-${e.created_at}` }; (byOrder[e.order_id] ??= []).unshift(d); last[e.order_id] = d; }
    else if (e.kind === AUDIT_EVENT + '_update' && last[e.order_id]) { const { audit_id, ...p } = e.detail as any; void audit_id; Object.assign(last[e.order_id], p); }
    else if (e.kind === GUEST_EVENT && last[e.order_id]) Object.assign(last[e.order_id], { guest_refund: 'devuelto', guest_refund_note: (e.detail as any)?.note ?? null, guest_refunded_at: e.created_at, guest_refunded_by: (e.detail as any)?.by ?? null });
  }
  return { byOrder, table: false };
}

export interface DecideInput { outcome: Outcome; buyerPct?: number; note: string; ruleId?: string | null; aiRecommendation?: string | null }
export interface DecideBy { sub: string; email: string | null; source: DecisionSource }
export function validateDecision(raw: any): DecideInput & { buyerPct: number } {
  const outcome = raw?.outcome;
  const pct = pctOf(outcome, raw?.buyer_pct ?? raw?.buyerPct);
  if (pct == null) throw Object.assign(new HttpError(400, outcome === 'split' ? 'Elige un porcentaje para el comprador entre 1 y 99.' : 'Elige una decisión.'), { code: 'bad_decision' });
  const note = typeof raw?.note === 'string' ? raw.note.trim() : '';
  if (note.length < 3) throw Object.assign(new HttpError(400, 'Escribe una nota con el motivo de la decisión.'), { code: 'note_required' });
  if (note.length > 1000) throw Object.assign(new HttpError(400, 'La nota es muy larga (máximo 1000 caracteres).'), { code: 'note_too_long' });
  if (raw?.confirm !== true) throw Object.assign(new HttpError(400, 'Confirma la decisión.'), { code: 'confirm_required' });
  return { outcome, buyerPct: pct, note, ruleId: typeof raw?.rule_id === 'string' ? raw.rule_id.slice(0, 40) : null, aiRecommendation: typeof raw?.ai_recommendation === 'string' ? raw.ai_recommendation.slice(0, 40) : null };
}

/** Decide una disputa: audita, ejecuta on-chain (si hay secreto) y deja la tarea de devolución al invitado. */
export async function decideDispute(order: any, by: DecideBy, input: DecideInput & { buyerPct: number }, opts: { secret?: string | null } = {}) {
  if (order.status !== 'en_disputa') throw Object.assign(new HttpError(409, order.status === 'resuelto' ? 'Esta disputa ya está resuelta.' : `El pedido no está en disputa (${order.status}).`), { code: 'not_open' });
  const secret = opts.secret === undefined ? resolverSecret() : opts.secret;
  const base: Decision = { order_id: order.id, slug: order.slug, decided_by: by.sub, decided_by_email: by.email, source: by.source, outcome: input.outcome,
    buyer_pct: input.buyerPct, note: input.note, rule_id: input.ruleId ?? null, ai_recommendation: input.aiRecommendation ?? null,
    status: secret ? 'executing' : 'pending_onchain', created_at: new Date().toISOString() };
  const ref = await recordDecision(base);
  if (!secret) return { executed: false as const, pending: true, command: resolveCommand(order.slug, input.buyerPct), auditId: ref.id };
  try {
    const r = await resolveOrderDispute(order, secret, input.buyerPct);
    const guest = isGuestSub(order.buyer_user_id) && r.toBuyer > 0;
    const patch: Partial<Decision> = { status: 'executed', resolved_tx: r.resolvedTx, to_buyer: r.toBuyer, to_seller: r.toSeller, executed_at: new Date().toISOString(), guest_refund: guest ? 'pendiente' : 'no_aplica' };
    await updateDecision(ref, order.id, patch);
    return { executed: true as const, ...r, guestRefundPending: guest, auditId: ref.id };
  } catch (e: any) {
    await updateDecision(ref, order.id, { status: 'failed', error: String(e?.message ?? e).slice(0, 300) });
    throw e;
  }
}

/** Tarea de devolución al comprador invitado: el admin la marca como hecha (con nota). */
export async function markGuestRefunded(order: any, by: { sub: string; email: string | null }, note: string) {
  if (order.status !== 'resuelto' || !isGuestSub(order.buyer_user_id) || !(Number(order.resolution?.toBuyer) > 0)) throw Object.assign(new HttpError(409, 'Este pedido no tiene una devolución pendiente.'), { code: 'no_refund_pending' });
  const at = new Date().toISOString();
  const clean = String(note ?? '').trim().slice(0, 500) || null;
  const { error } = await db().from('dispute_decisions').update({ guest_refund: 'devuelto', guest_refund_note: clean, guest_refunded_at: at, guest_refunded_by: by.email ?? by.sub })
    .eq('order_id', order.id).eq('status', 'executed');
  if (error && !isMissingTable(error)) console.warn('[disputes] devolución (027) falló', error.code ?? error.message);
  await logEvent(order.id, GUEST_EVENT, { by: by.email ?? by.sub, note: clean });
  return { done: true, at };
}

/** Resolución desde el script: misma lógica + auditoría con source 'script'. */
export async function resolveFromScript(order: any, secret: string, buyerPct: number, note = 'scripts/resolve-dispute.ts') {
  const outcome: Outcome = buyerPct === 100 ? 'refund' : buyerPct === 0 ? 'release' : 'split';
  return decideDispute(order, { sub: 'script', email: null, source: 'script' }, { outcome, buyerPct, note }, { secret });
}
export type { RuleResult };
