// Capa B (reglas deterministas) + capa D (respuesta del vendedor) del panel de disputas. PURO: sin DB ni red, lo usan el
// API, el script y el modo demo. Cada regla devuelve un resultado sugerido y cuál se disparó; NUNCA resuelve sola: la
// auto-resolución es un flag aparte (disputes_auto_resolve), apagado por defecto, y una persona aprueba.
//
// Reglas (en orden; gana la primera):
//  sin_envio               pagado, entrega por envío, nunca marcado como enviado y pasaron ≥ RULE_SHIP_DAYS días desde el pago
//                          -> reembolso total al comprador.
//  envio_sin_prueba        marcado como enviado sin foto ni número de guía -> a favor del comprador (reembolso total).
//  vendedor_sin_respuesta  hay mecanismo de respuesta (migración 027), se le avisó al vendedor y no respondió en
//                          SELLER_REPLY_HOURS horas -> reembolso total.
// Si ninguna aplica: null (pasa a la capa E, resumen con IA, y a la decisión humana).

export const RULE_SHIP_DAYS = 3;
export const SELLER_REPLY_HOURS = 48;
/** Plazo objetivo para decidir una disputa (la app le dice al comprador "respondemos en 24-48 h"). */
export const DISPUTE_SLA_HOURS = 48;
const H = 3_600_000;

export type Outcome = 'refund' | 'release' | 'split';
export type RuleId = 'sin_envio' | 'envio_sin_prueba' | 'vendedor_sin_respuesta';
export interface RuleResult { rule: RuleId; outcome: Outcome; buyerPct: number; title: string; why: string }

export interface RuleFacts {
  order: { status: string; delivery_mode?: string | null; funded_at?: string | null; shipped_at?: string | null; shipped_tx?: string | null;
    ship_evidence?: { photo?: string | null; note?: string | null } | null; ship_evidence_hash?: string | null; disputed_at?: string | null; created_at?: string | null };
  dispute: { opened_at?: string | null; reason?: string | null };
  /** Respuesta del vendedor (027). null = no respondió. */
  response: { created_at: string } | null;
  /** ¿Existe el mecanismo de respuesta (tabla de 027)? Sin él la regla de 48 h no aplica. */
  responsesAvailable: boolean;
  now?: number;
  shipDays?: number;
  replyHours?: number;
}

const t = (s?: string | null) => (s ? Date.parse(s) : NaN);
export const wasShipped = (o: RuleFacts['order']) => !!(o.shipped_at || o.shipped_tx);
export const isF2F = (o: { delivery_mode?: string | null }) => o.delivery_mode === 'cara_a_cara';
export const hasShipProof = (o: RuleFacts['order']) => !!(o.ship_evidence?.photo || (o.ship_evidence?.note ?? '').trim());
/** Desde cuándo corre el plazo del vendedor para responder: la apertura de la disputa. */
export const replyDeadline = (f: Pick<RuleFacts, 'dispute' | 'order'>, hours = SELLER_REPLY_HOURS) => {
  const from = t(f.dispute.opened_at) || t(f.order.disputed_at);
  return Number.isFinite(from) ? new Date(from + hours * H).toISOString() : null;
};
export const decisionDeadline = (f: Pick<RuleFacts, 'dispute' | 'order'>) => replyDeadline(f, DISPUTE_SLA_HOURS);

export function evaluateRules(f: RuleFacts): RuleResult | null {
  const now = f.now ?? Date.now();
  const days = f.shipDays ?? RULE_SHIP_DAYS, hours = f.replyHours ?? SELLER_REPLY_HOURS;
  const o = f.order;
  const opened = t(f.dispute.opened_at) || t(o.disputed_at) || now;
  if (!isF2F(o) && !wasShipped(o) && o.funded_at) {
    const waited = Math.max(opened, now) - t(o.funded_at);
    if (waited >= days * 24 * H) return { rule: 'sin_envio', outcome: 'refund', buyerPct: 100, title: `Pagado y sin envío en ${days} días`,
      why: `El pago entró hace ${Math.floor(waited / (24 * H))} días y el vendedor nunca lo marcó como enviado.` };
  }
  if (!isF2F(o) && wasShipped(o) && !hasShipProof(o)) return { rule: 'envio_sin_prueba', outcome: 'refund', buyerPct: 100, title: 'Enviado sin foto ni guía',
    why: 'El vendedor lo marcó como enviado sin foto del paquete ni número de guía: se favorece al comprador.' };
  if (f.responsesAvailable && !f.response && now - opened >= hours * H) return { rule: 'vendedor_sin_respuesta', outcome: 'refund', buyerPct: 100,
    title: `El vendedor no respondió en ${hours} h`, why: `Le avisamos al vendedor al abrirse la disputa y no respondió en ${hours} horas.` };
  return null;
}

/** Flags de auto-resolución: SOLO con el flag encendido y una regla disparada; aun así el servidor necesita el secreto. */
export const autoResolvable = (r: RuleResult | null, flags: { autoResolve: boolean }) => !!r && flags.autoResolve === true;

export type DisputeTab = 'nuevas' | 'decidir' | 'resueltas';
/** Pestaña del panel. Nuevas: esperando la respuesta del vendedor (dentro de las 48 h, sin regla). Necesitan decisión: hay
 *  regla, respuesta, venció el plazo, hay una decisión sin ejecutar o no existe el mecanismo de respuesta. */
export function tabOf(x: { orderStatus: string; disputeState?: string | null; rule: RuleResult | null; response: unknown; responsesAvailable: boolean;
  openedAt?: string | null; now?: number; replyHours?: number }): DisputeTab {
  if (x.orderStatus === 'resuelto' || x.disputeState === 'resolved') return 'resueltas';
  if (x.rule || x.response || !x.responsesAvailable) return 'decidir';
  const opened = t(x.openedAt);
  if (!Number.isFinite(opened)) return 'decidir';
  return (x.now ?? Date.now()) - opened >= (x.replyHours ?? SELLER_REPLY_HOURS) * H ? 'decidir' : 'nuevas';
}

/** buyerPct de una decisión. Dividir: 1..99 (0 y 100 son Liberar y Reembolsar). */
export function pctOf(outcome: unknown, pct?: unknown): number | null {
  if (outcome === 'refund') return 100;
  if (outcome === 'release') return 0;
  if (outcome === 'split') { const n = Number(pct); return Number.isInteger(n) && n >= 1 && n <= 99 ? n : null; }
  return null;
}
export const OUTCOME_LABEL: Record<Outcome, string> = { refund: 'Reembolsar al comprador', release: 'Liberar al vendedor', split: 'Dividir' };
export const REASON_LABEL: Record<string, string> = { no_llego: 'No llegó', no_funciona: 'No funciona', no_es_lo_descrito: 'No es lo descrito', otro: 'Otro' };
