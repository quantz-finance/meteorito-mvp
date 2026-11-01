// Regla v2 "Respuesta del vendedor en 48 h" (lib/rules.ts DISPUTE_REPLY_RULE). Solo pedidos con rules_version >= 2 (033):
// nada retroactivo. Plazos y fases puras en api/_lib/orderRules.ts (replyPhase).
//  - Al abrir la disputa, quien compra da su versión (texto, y fotos de la cámara salvo "No llegó"): validateBuyerVersion.
//  - Se le avisa a quien vende (push + aviso en la app) y las 48 h cuentan desde que se manda el aviso
//    (disputes.seller_notified_at y orders.dispute_reply_due_at, 034). Mientras tanto, el pago sigue en custodia.
//  - Quien vende responde con una foto, la guía de envío o un texto (sellerRespond, api/_lib/disputeAdmin.ts) -> panel de
//    disputas: la IA solo resume y una persona decide (nunca se resuelve sola).
//  - Sin respuesta en 48 h: reembolso 100% desde la custodia por el cron (replyRulePass), por el camino de las disputas
//    (decideDispute, source 'auto_rule', regla 'vendedor_sin_respuesta'). Idempotente: una sola decisión vigente.
// Sin 034: el plazo cuenta desde la apertura de la disputa y la respuesta se lee de dispute_responses (027).
import { db, logEvent } from './db';
import { HttpError } from './auth';
import { decideDispute, loadDecisions, resolverSecret } from './disputeResolve';
import { missingColumn } from './listings';
import { isMissingTable, notifyOrder, replyRuleMessages, type PushDeps } from './push';
import { BUYER_VERSION_MIN, RULE_VERSION, SELLER_REPLY_RULE_HOURS, replyPhase, replyRuleApplies } from './orderRules';

const H = 3_600_000;
/** ¿Quien vende ya respondió? (dispute_responses, 027). Sin 027: no hay mecanismo de respuesta -> null. */
async function hasResponse(orderId: string): Promise<boolean | null> {
  const { data, error } = await db().from('dispute_responses').select('order_id').eq('order_id', orderId).limit(1);
  if (error) { if (isMissingTable(error)) return null; throw error; }
  return !!data?.length;
}
export interface ReplyRuleOpts { now?: number; secret?: string | null; push?: PushDeps }

/** v2: quien compra da su versión (y fotos, salvo "No llegó") al abrir la disputa. */
export function validateBuyerVersion(order: any, input: { reason: string; description?: string | null; evidence: string[] }) {
  if (!replyRuleApplies(order)) return;
  if ((input.description ?? '').trim().length < BUYER_VERSION_MIN) throw Object.assign(new HttpError(400, 'Cuéntanos tu versión de lo que pasó (mínimo 10 caracteres).'), { code: 'version_required' });
  if (input.reason !== 'no_llego' && !input.evidence.length) throw Object.assign(new HttpError(400, 'Toma al menos una foto con la cámara para mostrar el problema.'), { code: 'photo_required' });
}

/** Después de abrir la disputa (v2): aviso a quien vende y a quien compra; las 48 h cuentan desde ese aviso. */
export async function startReplyWindow(order: any, opts: ReplyRuleOpts = {}) {
  if (!replyRuleApplies(order)) return null;
  await notifyOrder(order, opts.push ?? {}, replyRuleMessages(order, 'opened'));
  const now = opts.now ?? Date.now();
  const at = new Date(now).toISOString(), due = new Date(now + SELLER_REPLY_RULE_HOURS * H).toISOString();
  const a = await db().from('disputes').update({ seller_notified_at: at }).eq('order_id', order.id).is('seller_notified_at', null);
  const b = await db().from('orders').update({ dispute_reply_due_at: due }).eq('id', order.id).is('dispute_reply_due_at', null);
  for (const e of [a.error, b.error]) if (e && !missingColumn(e)) console.warn('[reply-rule] plazo', e.message);
  await logEvent(order.id, 'seller_reply_window', { notified_at: at, due_at: due, rule: 'respuesta_48h' });
  return { notifiedAt: at, dueAt: due };
}

/** Quien vende respondió (v2): marca (034) y avisa a quien compra. */
export async function markReplied(order: any, opts: ReplyRuleOpts = {}) {
  if (!replyRuleApplies(order)) return;
  const { data, error } = await db().from('orders').update({ dispute_replied_at: new Date(opts.now ?? Date.now()).toISOString() }).eq('id', order.id).is('dispute_replied_at', null).select('id');
  if (error && !missingColumn(error)) console.warn('[reply-rule] respuesta', error.message);
  if (error || data?.length) await notifyOrder(order, opts.push ?? {}, replyRuleMessages(order, 'replied'));
}

/** ¿Venció el plazo para responder? (v2). Para rechazar respuestas tardías: sin respuesta en 48 h se reembolsa. */
export async function replyExpired(order: any, now = Date.now()) {
  if (!replyRuleApplies(order)) return false;
  const { data: d } = await db().from('disputes').select('*').eq('order_id', order.id).maybeSingle();
  return replyPhase(order, now, { dispute: d }).phase === 'due';
}

/** Reembolso por falta de respuesta de UN pedido (cron o ?slug=). Idempotente. */
export async function refundNoReply(order: any, opts: ReplyRuleOpts = {}) {
  const now = opts.now ?? Date.now();
  if (!replyRuleApplies(order) || order.status !== 'en_disputa') return { skipped: 'na' };
  const [{ data: d }, replied, dec] = await Promise.all([db().from('disputes').select('*').eq('order_id', order.id).maybeSingle(), hasResponse(order.id), loadDecisions([order.id])]);
  if (replied === null) return { skipped: 'sin_027' }; // sin mecanismo de respuesta la regla no puede correr: decide una persona
  if (d && d.state !== 'open') return { skipped: 'dispute_' + d.state };
  const ph = replyPhase(order, now, { replied, dispute: d });
  if (ph.phase === 'replied') return { skipped: 'replied' };   // revisión humana en el panel
  if (ph.phase !== 'due') return { skipped: 'waiting', dueAt: ph.dueAt };
  if ((dec.byOrder[order.id] ?? []).some((x) => x.status !== 'failed')) return { already: true };
  const secret = opts.secret === undefined ? resolverSecret() : opts.secret;
  const r = await decideDispute(order, { sub: 'auto', email: null, source: 'auto_rule' },
    { outcome: 'refund', buyerPct: 100, note: `Quien vende no respondió en ${SELLER_REPLY_RULE_HOURS} h (regla v${RULE_VERSION.sellerReply}).`, ruleId: 'vendedor_sin_respuesta' },
    { secret, notify: false });
  await logEvent(order.id, 'seller_reply_missed', { due_at: ph.dueAt, executed: !!r.executed });
  if (r.executed) await notifyOrder(order, opts.push ?? {}, replyRuleMessages(order, 'refund'));
  return r.executed ? { refunded: true } : { pending: true };
}

/** Pasada del cron: reembolsos por falta de respuesta en 48 h. Sin 033: no hace nada. Nunca lanza. */
export async function replyRulePass(opts: ReplyRuleOpts & { limit?: number } = {}) {
  const out = { refunded: [] as string[], pending: [] as string[], errors: [] as string[] };
  const { data, error } = await db().from('orders').select('*').eq('status', 'en_disputa').gte('rules_version', RULE_VERSION.sellerReply)
    .is('ship_cancel', null).is('resolved_tx', null).limit(opts.limit ?? 25);
  if (error) { if (missingColumn(error)) return { ...out, skipped: 'sin_033' }; return { ...out, errors: [String(error.message).slice(0, 120)] }; }
  for (const o of data ?? []) {
    try {
      const r: any = await refundNoReply(o, opts);
      if (r.refunded) out.refunded.push(o.slug); else if (r.pending) out.pending.push(o.slug);
    } catch (e: any) { out.errors.push(`${o.slug}: ${String(e?.message ?? e).slice(0, 120)}`); }
  }
  return out;
}
