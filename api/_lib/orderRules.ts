// Reglas por pedido con VERSIÓN (pura, sin dependencias: la usan la app, el demo, el mock y la API).
//  - Cada pedido guarda la versión de reglas con la que se creó (orders.rules_version, migración 033; default 0).
//    Una regla solo rige si rules_version >= su versión: NADA es retroactivo. Los pedidos hijos de un producto
//    permanente copian la versión del producto (la que vio quien vende al publicar).
//  - El texto de cada regla vive en lib/rules.ts (un solo lugar); aquí solo los plazos y la lógica de tiempo.
//  - Todo recibe `now` (reloj inyectable) para probar el tiempo sin esperar.
import { isFaceToFace } from './agreement';

/** Versión en la que entra cada regla. */
export const RULE_VERSION = {
  /** v1: reembolso si no se envía (3 días para "Ya lo envié"; 2 días más y el reembolso se hace solo). */
  shipRefund: 1,
  /** v2: quien vende tiene 48 h para responder una disputa; sin respuesta, se reembolsa desde la custodia. */
  sellerReply: 2,
  /** v3: después de liberado el pago, quien compra tiene 30 días para reportar un problema (sin congelar ni devolver el pago). */
  claims: 3,
} as const;
/** Versión vigente: la que se guarda en los pedidos nuevos (si quien vende vio las reglas al publicar). */
export const CURRENT_RULES_VERSION = 3;

const H = 3_600_000, D = 24 * H;
/** Días desde el pago para marcar "Ya lo envié" (plazo fijo; no tiene que ver con el plazo acordado de liberación). */
export const SHIP_DAYS = 3;
/** Día del aviso a quien vende ("Te queda 1 día…"). */
export const SHIP_REMIND_DAYS = 2;
/** Días extra (después de los 3) sin envío ni cancelación para que el reembolso se haga solo. */
export const SHIP_AUTO_REFUND_EXTRA_DAYS = 2;

export const rulesVersionOf = (o: { rules_version?: number | null } | null | undefined) => {
  const v = Number(o?.rules_version); return Number.isInteger(v) && v > 0 ? v : 0;
};
/** Versión que se guarda al crear un pedido: la que quien vende aceptó en la app (0..vigente). */
export const stampVersion = (ack: unknown) => {
  const v = Number(ack); return Number.isInteger(v) && v > 0 ? Math.min(v, CURRENT_RULES_VERSION) : 0;
};

export interface ShipRuleOrder {
  status?: string | null; delivery_mode?: string | null; rules_version?: number | null; funded_at?: string | null;
  shipped_at?: string | null; shipped_tx?: string | null; disputed_at?: string | null; dispute_tx?: string | null; ship_cancel?: { by?: string; at?: string } | null;
}
export type ShipPhase = 'na' | 'waiting' | 'reminder' | 'cancelable' | 'auto_due';
export interface ShipDeadline { phase: ShipPhase; paidAt: string | null; remindAt: string | null; cancelAt: string | null; autoAt: string | null }

/** ¿La regla "reembolso si no se envía" rige para este pedido? Solo envío (cara a cara excluido) y versión >= 1. */
export const shipRuleApplies = (o: ShipRuleOrder | null | undefined) => !!o && rulesVersionOf(o) >= RULE_VERSION.shipRefund && !isFaceToFace(o);

/** Fases del plazo de envío (pedido pagado, sin "Ya lo envié", sin disputa ni cancelación):
 *  waiting (< 2 días) · reminder (día 2: aviso a quien vende) · cancelable (≥ 3 días: quien compra puede cancelar) ·
 *  auto_due (≥ 5 días: el reembolso se hace solo). 'na' si no aplica. */
export function shipDeadline(o: ShipRuleOrder | null | undefined, now = Date.now()): ShipDeadline {
  const none: ShipDeadline = { phase: 'na', paidAt: null, remindAt: null, cancelAt: null, autoAt: null };
  if (!o || !shipRuleApplies(o)) return none;
  const paid = Date.parse(o.funded_at ?? '');
  if (!Number.isFinite(paid)) return none;
  const iso = (ms: number) => new Date(ms).toISOString();
  const d: ShipDeadline = { phase: 'na', paidAt: iso(paid), remindAt: iso(paid + SHIP_REMIND_DAYS * D), cancelAt: iso(paid + SHIP_DAYS * D), autoAt: iso(paid + (SHIP_DAYS + SHIP_AUTO_REFUND_EXTRA_DAYS) * D) };
  if (o.status !== 'fondeado' || o.shipped_at || o.shipped_tx || o.disputed_at || o.dispute_tx || o.ship_cancel) return d;
  const t = now - paid;
  d.phase = t >= (SHIP_DAYS + SHIP_AUTO_REFUND_EXTRA_DAYS) * D ? 'auto_due' : t >= SHIP_DAYS * D ? 'cancelable' : t >= SHIP_REMIND_DAYS * D ? 'reminder' : 'waiting';
  return d;
}

/** Aviso a quien vende el día 2 (texto EXACTO aprobado). */
export const SHIP_REMINDER_TEXT = "Te queda 1 día para marcar 'Ya lo envié'";

/* ---------- v2: respuesta del vendedor en 48 h ---------- */
/** Horas que tiene quien vende para responder una disputa, desde que se le manda el aviso. */
export const SELLER_REPLY_RULE_HOURS = 48;
/** Largo mínimo de la versión de quien compra al abrir la disputa (v2). */
export const BUYER_VERSION_MIN = 10;

export interface ReplyRuleOrder { status?: string | null; rules_version?: number | null; ship_cancel?: unknown; disputed_at?: string | null;
  dispute_reply_due_at?: string | null; dispute_replied_at?: string | null; resolved_tx?: string | null }
export type ReplyPhase = 'na' | 'waiting' | 'replied' | 'due';
/** ¿La regla de las 48 h rige para este pedido? v2+ y no es la cancelación por falta de envío (v1, se resuelve sola). */
export const replyRuleApplies = (o: ReplyRuleOrder | null | undefined) => !!o && rulesVersionOf(o) >= RULE_VERSION.sellerReply && !o.ship_cancel;
/** Vencimiento de las 48 h: el guardado (034) o, sin 034, desde el aviso/apertura de la disputa. */
export function replyDueAt(o: ReplyRuleOrder, dispute?: { seller_notified_at?: string | null; opened_at?: string | null } | null): string | null {
  if (o.dispute_reply_due_at) return o.dispute_reply_due_at;
  const from = Date.parse(dispute?.seller_notified_at ?? dispute?.opened_at ?? o.disputed_at ?? '');
  return Number.isFinite(from) ? new Date(from + SELLER_REPLY_RULE_HOURS * H).toISOString() : null;
}
/** Fase: waiting (corre el plazo) · replied (respondió: revisión humana) · due (venció sin respuesta: reembolso). */
export function replyPhase(o: ReplyRuleOrder | null | undefined, now = Date.now(), x: { replied?: boolean; dispute?: { seller_notified_at?: string | null; opened_at?: string | null } | null } = {}): { phase: ReplyPhase; dueAt: string | null } {
  if (!o || !replyRuleApplies(o) || o.status !== 'en_disputa' || o.resolved_tx) return { phase: 'na', dueAt: null };
  const dueAt = replyDueAt(o, x.dispute);
  if (x.replied || o.dispute_replied_at) return { phase: 'replied', dueAt };
  if (!dueAt) return { phase: 'na', dueAt: null };
  return { phase: now >= Date.parse(dueAt) ? 'due' : 'waiting', dueAt };
}

/* ---------- v3: período de reclamo de 30 días (después de liberado el pago) ---------- */
/** Días desde la liberación en los que quien compra puede reportar un problema. */
export const CLAIM_DAYS = 30;
/** Horas que tiene quien vende para responder ANTES de que el reporte cuente en su historial. */
export const CLAIM_GRACE_HOURS = 48;
/** Largo mínimo del reporte de quien compra. */
export const CLAIM_TEXT_MIN = 10;
export type ClaimStatus = 'abierto' | 'respondido' | 'resuelto';
export interface ClaimRuleOrder { status?: string | null; rules_version?: number | null; released_at?: string | null; released_tx?: string | null }
/** ¿La regla de los 30 días rige para este pedido? v3+ (nada retroactivo). */
export const claimRuleApplies = (o: ClaimRuleOrder | null | undefined) => !!o && rulesVersionOf(o) >= RULE_VERSION.claims;
/** Ventana para reportar: 30 días desde la liberación. 'na' si no aplica o el pago no está liberado (o no se sabe cuándo). */
export function claimWindow(o: ClaimRuleOrder | null | undefined, now = Date.now()): { phase: 'na' | 'open' | 'closed'; until: string | null } {
  if (!o || !claimRuleApplies(o) || o.status !== 'liberado') return { phase: 'na', until: null };
  const rel = Date.parse(o.released_at ?? '');
  if (!Number.isFinite(rel)) return { phase: 'na', until: null };
  const until = rel + CLAIM_DAYS * D;
  return { phase: now < until ? 'open' : 'closed', until: new Date(until).toISOString() };
}
export interface ClaimLike { status?: string | null; opened_at?: string | null; counts_at?: string | null; responded_at?: string | null }
/** Hasta cuándo puede responder quien vende antes de que el reporte cuente (48 h desde el aviso). */
export function claimCountsAt(c: ClaimLike): string | null {
  if (c.counts_at) return c.counts_at;
  const t = Date.parse(c.opened_at ?? '');
  return Number.isFinite(t) ? new Date(t + CLAIM_GRACE_HOURS * H).toISOString() : null;
}
/** ¿El reporte ya cuenta en el historial de quien vende? Sí si respondió, si se resolvió o si pasaron las 48 h. */
export function claimCounts(c: ClaimLike, now = Date.now()): boolean {
  if (c.status === 'respondido' || c.status === 'resuelto' || c.responded_at) return true;
  const at = Date.parse(claimCountsAt(c) ?? '');
  return Number.isFinite(at) && now >= at;
}
/** Estado agregado que se muestra en el historial de quien vende (nunca el texto de quien compra). */
export const claimStatusOf = (c: ClaimLike): ClaimStatus => (c.status === 'resuelto' ? 'resuelto' : c.status === 'respondido' || c.responded_at ? 'respondido' : 'abierto');
export interface ClaimHistory { abierto: number; respondido: number; resuelto: number }
/** Conteo del historial: solo los reportes que ya cuentan (después de que quien vende pudo responder). */
export function claimHistory(claims: ClaimLike[], now = Date.now()): ClaimHistory {
  const h: ClaimHistory = { abierto: 0, respondido: 0, resuelto: 0 };
  for (const c of claims) if (claimCounts(c, now)) h[claimStatusOf(c)]++;
  return h;
}
