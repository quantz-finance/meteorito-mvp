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
} as const;
/** Versión vigente: la que se guarda en los pedidos nuevos (si quien vende vio las reglas al publicar). */
export const CURRENT_RULES_VERSION = 1;

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
