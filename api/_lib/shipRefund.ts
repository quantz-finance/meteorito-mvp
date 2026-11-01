// Regla "Reembolso si no se envía" (v1, lib/rules.ts SHIP_REFUND_RULE). Solo pedidos con envío y rules_version >= 1
// (migración 033): nada retroactivo. Plazo FIJO desde el pago (api/_lib/orderRules.ts shipDeadline), aparte del plazo
// acordado de liberación (que corre después del envío).
//  - Día 2: aviso a quien vende ("Te queda 1 día para marcar 'Ya lo envié'"), una sola vez (orders.ship_reminded_at).
//  - Día 3: quien compra puede "Cancelar y recibir reembolso" (POST /api/escrow/confirm { reason:'cancel_unshipped' }).
//  - Día 5 sin envío ni cancelación: el cron reembolsa solo (GET /api/escrow/cron).
// Reembolso = el MISMO camino de las disputas: dispute-escrow on-chain (approver) + resolución 100% al comprador por el
// dispute resolver (decideDispute, auditoría en dispute_decisions/order_events, regla 'sin_envio'). Sin
// DISPUTE_RESOLVER_SECRET queda 'pending_onchain' en el panel de disputas para ejecutarlo a mano.
// Idempotente: lock por fila (release_lock_until), updates condicionados al status, disputa única por pedido (PK) y una
// sola decisión vigente por pedido.
import { db, logEvent } from './db';
import { HttpError } from './auth';
import { openDispute } from './escrow';
import { decideDispute, loadDecisions, resolverSecret } from './disputeResolve';
import { missingColumn } from './listings';
import { notifyOrder, shipRuleMessages, type PushDeps } from './push';
import { RULE_VERSION, SHIP_AUTO_REFUND_EXTRA_DAYS, SHIP_DAYS, SHIP_REMIND_DAYS, shipDeadline, shipRuleApplies } from './orderRules';

const D = 86_400_000;
export type ShipCancelBy = 'buyer' | 'auto';
export interface ShipRefundOpts { now?: number; secret?: string | null; push?: PushDeps }

async function claim(id: string, now: number): Promise<boolean> {
  const { data } = await db().from('orders').update({ release_lock_until: new Date(now + 120_000).toISOString() })
    .eq('id', id).or(`release_lock_until.is.null,release_lock_until.lt.${new Date(now).toISOString()}`).select('id');
  return !!data?.length;
}
const unlock = (id: string) => db().from('orders').update({ release_lock_until: null }).eq('id', id);
const reload = async (id: string) => (await db().from('orders').select('*').eq('id', id).single()).data;

/** Cancela y reembolsa el 100% desde la custodia. by='buyer': desde el día 3 (quien compra, ya autenticado por quien
 *  llama); by='auto': desde el día 5 (cron). Devuelve { refunded|pending|already }. */
export async function refundUnshipped(order: any, by: ShipCancelBy, opts: ShipRefundOpts = {}) {
  const now = opts.now ?? Date.now();
  if (!shipRuleApplies(order)) throw Object.assign(new HttpError(409, 'Esta compra no tiene reembolso por falta de envío.'), { code: 'rule_not_applicable' });
  if (order.status === 'resuelto') return { already: true, status: order.status };
  // Reanudar: ya se canceló (disputa abierta por esta regla) pero la resolución no terminó (falló o no había secreto).
  const resuming = order.status === 'en_disputa' && !!order.ship_cancel;
  if (!resuming) {
    const ph = shipDeadline(order, now).phase;
    const ok = by === 'buyer' ? ph === 'cancelable' || ph === 'auto_due' : ph === 'auto_due';
    if (!ok) {
      if (order.status === 'enviado' || order.shipped_at) throw Object.assign(new HttpError(409, 'Quien vende ya marcó "Ya lo envié".'), { code: 'already_shipped' });
      if (order.status !== 'fondeado') throw Object.assign(new HttpError(409, 'Esta compra ya no se puede cancelar.'), { code: 'not_cancelable' });
      throw Object.assign(new HttpError(409, `Podrás cancelar si pasan ${SHIP_DAYS} días desde el pago sin "Ya lo envié".`), { code: 'not_yet' });
    }
    if (!(await claim(order.id, now))) return { already: true, status: 'locked' };
    try {
      const cur = await reload(order.id); // el vendedor pudo haber marcado el envío mientras tanto
      const ph2 = shipDeadline(cur, now).phase;
      if (!(by === 'buyer' ? ph2 === 'cancelable' || ph2 === 'auto_due' : ph2 === 'auto_due')) throw Object.assign(new HttpError(409, 'El pedido cambió. Vuelve a cargarlo.'), { code: 'changed' });
      const at = new Date(now).toISOString();
      await openDispute(cur, cur.buyer_user_id, { reason: 'no_llego', description: by === 'buyer' ? `Cancelado por quien compra: sin "Ya lo envié" en ${SHIP_DAYS} días.` : `Reembolso automático: ${SHIP_DAYS + SHIP_AUTO_REFUND_EXTRA_DAYS} días sin envío ni cancelación.`, evidence: [] },
        { patch: { ship_cancel: { by, at } }, notify: false });
      await logEvent(order.id, 'ship_cancel', { by, at, rule: 'reembolso_sin_envio', rules_version: order.rules_version });
      await notifyOrder(cur, opts.push ?? {}, shipRuleMessages(cur, by === 'buyer' ? 'cancel_buyer' : 'cancel_auto'));
    } finally { await unlock(order.id); }
  }
  const o = await reload(order.id);
  if (o.status !== 'en_disputa') return { already: true, status: o.status };
  const dec = await loadDecisions([o.id]);
  const live = (dec.byOrder[o.id] ?? []).find((d) => d.status !== 'failed');
  if (live) return { pending: live.status !== 'executed', already: true, status: o.status, decision: live.status };
  const secret = opts.secret === undefined ? resolverSecret() : opts.secret;
  const r = await decideDispute(o, { sub: by === 'buyer' ? String(o.buyer_user_id) : 'auto', email: null, source: 'auto_rule' },
    { outcome: 'refund', buyerPct: 100, note: by === 'buyer' ? `Cancelado por quien compra: sin "Ya lo envié" en ${SHIP_DAYS} días (regla v${RULE_VERSION.shipRefund}).` : `Reembolso automático: ${SHIP_DAYS + SHIP_AUTO_REFUND_EXTRA_DAYS} días sin envío ni cancelación (regla v${RULE_VERSION.shipRefund}).`, ruleId: 'sin_envio' },
    { secret, notify: false });
  return r.executed ? { refunded: true, resolvedTx: r.resolvedTx, toBuyer: r.toBuyer } : { pending: true };
}

/** Aviso del día 2 (una vez). true si se mandó. */
export async function remindSeller(order: any, opts: ShipRefundOpts = {}): Promise<boolean> {
  const now = opts.now ?? Date.now();
  if (shipDeadline(order, now).phase !== 'reminder' || order.ship_reminded_at) return false;
  const { data, error } = await db().from('orders').update({ ship_reminded_at: new Date(now).toISOString() }).eq('id', order.id).eq('status', 'fondeado').is('ship_reminded_at', null).select('id');
  if (error) { if (!missingColumn(error)) console.warn('[ship-rule] aviso', error.message); return false; }
  if (!data?.length) return false;
  await notifyOrder(order, opts.push ?? {}, shipRuleMessages(order, 'reminder'));
  await logEvent(order.id, 'ship_reminder_sent', { rule: 'reembolso_sin_envio' });
  return true;
}

/** Pasada del cron: avisos del día 2 y reembolsos automáticos del día 5. Sin la migración 033: no hace nada. Nunca lanza. */
export async function shipRulePass(opts: ShipRefundOpts & { limit?: number } = {}) {
  const now = opts.now ?? Date.now();
  const out = { reminded: [] as string[], refunded: [] as string[], pending: [] as string[], errors: [] as string[] };
  const { data, error } = await db().from('orders').select('*').eq('status', 'fondeado').eq('delivery_mode', 'envio').gte('rules_version', RULE_VERSION.shipRefund)
    .is('shipped_at', null).lte('funded_at', new Date(now - SHIP_REMIND_DAYS * D).toISOString()).limit(opts.limit ?? 25);
  if (error) { if (missingColumn(error)) return { ...out, skipped: 'sin_033' }; return { ...out, errors: [String(error.message).slice(0, 120)] }; }
  // Reanudar reembolsos que quedaron a medias (disputa por esta regla sin decisión vigente).
  const { data: open } = await db().from('orders').select('*').eq('status', 'en_disputa').not('ship_cancel', 'is', null).limit(10);
  for (const o of [...(data ?? []), ...(open ?? [])]) {
    try {
      const ph = shipDeadline(o, now).phase;
      if (ph === 'reminder') { if (await remindSeller(o, { ...opts, now })) out.reminded.push(o.slug); continue; }
      if (ph !== 'auto_due' && !(o.status === 'en_disputa' && o.ship_cancel)) continue;
      const r: any = await refundUnshipped(o, o.ship_cancel?.by === 'buyer' ? 'buyer' : 'auto', { ...opts, now });
      if (r.refunded) out.refunded.push(o.slug); else if (r.pending) out.pending.push(o.slug);
    } catch (e: any) { out.errors.push(`${o.slug}: ${String(e?.message ?? e).slice(0, 120)}`); }
  }
  return out;
}
