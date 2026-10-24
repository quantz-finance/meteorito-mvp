// Formas que ve el panel admin de disputas (lista y detalle). PURO: lo usan el API (api/_lib/disputeAdmin.ts), el modo
// demo (lib/demo.ts) y la app (tipos). Sin PII de más: del comprador solo el tipo (invitado / cuenta) y un id corto.
import { decisionDeadline, evaluateRules, REASON_LABEL, replyDeadline, tabOf, type DisputeTab, type Outcome, type RuleResult } from './disputeRules';

export interface DecisionView { id: string | number | null; at: string; by: string; source: string; outcome: Outcome; buyer_pct: number; note: string; status: string;
  resolved_tx: string | null; error: string | null; rule_id: string | null; ai_recommendation: string | null; guest_refund: string | null; guest_refund_note: string | null; guest_refunded_at: string | null }
export interface AiView { summary: string; recommendation: Outcome; buyerPct: number; confidence: 'alta' | 'media' | 'baja'; reasons: string[]; model: string; at: string }
export interface AdminDisputeRow {
  slug: string; product: string; photo: string | null; price_crc: number; amount_usdc: number | null; status: string; state: string | null;
  reason: string; reason_label: string; description_preview: string | null; opened_at: string | null; deadline: string | null; tab: DisputeTab;
  seller: { store_slug: string | null; name: string | null }; buyer: { kind: 'invitado' | 'cuenta'; ref: string };
  rule: RuleResult | null; has_response: boolean; decision: { status: string; outcome: Outcome; buyer_pct: number } | null;
  guest_refund_pending: boolean; resolution: { buyerPct?: number; toBuyer?: number; toSeller?: number } | null;
}
export interface ChatLine { from: 'comprador' | 'vendedor'; body: string; at: string }
export interface AdminDisputeDetail extends AdminDisputeRow {
  description: string | null; evidence: string[]; delivery_mode: string | null;
  timeline: { kind: string; label: string; at: string }[];
  ship: { shipped_at: string | null; photo: string | null; note: string | null; hash: string | null; captured_at: string | null } | null;
  response: { body: string; photo: string | null; created_at: string } | null; response_deadline: string | null; responses_available: boolean;
  chat: { available: boolean; order: ChatLine[]; store: ChatLine[] };
  onchain: { contract_id: string | null; disputed?: boolean; released?: boolean; resolved?: boolean; balance?: number | null; error?: string | null };
  links: { label: string; url: string }[];
  decisions: DecisionView[];
  ai: { available: boolean; reason?: string; cached: AiView | null; cache_available: boolean };
  flags: { autoResolve: boolean; ai: boolean };
  capabilities: { executeOnchain: boolean; auditTable: boolean };
  guest: { is_guest: boolean; refund_pending: boolean; to_buyer: number | null; contact: string | null };
}

export const EVENT_LABEL: Record<string, string> = {
  created: 'Link creado', escrow_deployed: 'Custodia creada', funded: 'Pago recibido', shipped: 'Marcado como enviado', approved: 'Entrega aprobada',
  released: 'Pago liberado', dispute_opened: 'Disputa abierta', dispute_resolved: 'Disputa resuelta', pin_failed: 'PIN incorrecto',
  release_refused: 'Liberación rechazada', extension_requested: 'Pidieron más tiempo', auto_release_extended: 'Plazo corregido', agreement_accepted: 'Acuerdo aceptado',
  funding_mismatch: 'Pago no coincide', card_mismatch: 'Pago con tarjeta no coincide', dispute_decision: 'Decisión registrada', guest_refund_done: 'Devolución al comprador hecha',
  seller_response: 'Respuesta del vendedor',
};
export const productOf = (o: { brand?: string | null; model?: string | null; slug?: string }) => (`${o.brand ?? ''} ${o.model ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, 60)) || `Pedido ${o.slug ?? ''}`.trim();
export const buyerOf = (id: string | null | undefined): AdminDisputeRow['buyer'] => ({ kind: String(id ?? '').startsWith('guest:') ? 'invitado' : 'cuenta', ref: String(id ?? '').replace(/^guest:/, '').slice(-6) || '—' });
export const shortDesc = (s: string | null | undefined, n = 90) => { const x = String(s ?? '').replace(/\s+/g, ' ').trim(); return x ? (x.length > n ? x.slice(0, n - 1) + '…' : x) : null; };

export interface RowInput {
  order: any; dispute: any; seller?: { store_slug?: string | null; display_name?: string | null } | null;
  response: { created_at: string } | null; responsesAvailable: boolean; decisions: DecisionView[] | any[]; now?: number;
}
export function guestRefundPending(order: any, decisions: any[]): boolean {
  if (order.status !== 'resuelto' || !String(order.buyer_user_id ?? '').startsWith('guest:') || !(Number(order.resolution?.toBuyer) > 0)) return false;
  return !decisions.some((d) => d.guest_refund === 'devuelto');
}
export function buildRow(x: RowInput): AdminDisputeRow {
  const o = x.order, d = x.dispute ?? {};
  const facts = { order: o, dispute: { opened_at: d.opened_at ?? o.disputed_at, reason: d.reason }, response: x.response, responsesAvailable: x.responsesAvailable, now: x.now };
  const open = o.status === 'en_disputa';
  const rule = open ? evaluateRules(facts) : null;
  const last = x.decisions[0] ?? null;
  return {
    slug: o.slug, product: productOf(o), photo: Array.isArray(o.photos) && typeof o.photos[0] === 'string' ? o.photos[0] : null,
    price_crc: Number(o.price_crc) || 0, amount_usdc: o.amount_usdc == null ? null : Number(o.amount_usdc), status: o.status, state: d.state ?? null,
    reason: d.reason ?? 'otro', reason_label: REASON_LABEL[d.reason] ?? 'Otro', description_preview: shortDesc(d.description),
    opened_at: d.opened_at ?? o.disputed_at ?? null, deadline: open ? decisionDeadline(facts) : null,
    tab: last && last.status === 'pending_onchain' && open ? 'decidir' : tabOf({ orderStatus: o.status, disputeState: d.state, rule, response: x.response, responsesAvailable: x.responsesAvailable, openedAt: d.opened_at ?? o.disputed_at, now: x.now }),
    seller: { store_slug: x.seller?.store_slug ?? null, name: x.seller?.display_name ?? null }, buyer: buyerOf(o.buyer_user_id),
    rule, has_response: !!x.response, decision: last ? { status: last.status, outcome: last.outcome, buyer_pct: last.buyer_pct } : null,
    guest_refund_pending: guestRefundPending(o, x.decisions), resolution: o.resolution ?? null,
  };
}
export const responseDeadlineOf = (order: any, dispute: any) => replyDeadline({ order, dispute: { opened_at: dispute?.opened_at ?? order.disputed_at } });
export function toDecisionView(d: any): DecisionView {
  return { id: d.id ?? null, at: d.created_at, by: d.decided_by_email ?? (d.source === 'script' ? 'script' : String(d.decided_by ?? '').slice(0, 8)), source: d.source ?? 'admin',
    outcome: d.outcome, buyer_pct: Number(d.buyer_pct), note: d.note ?? '', status: d.status, resolved_tx: d.resolved_tx ?? null, error: d.error ?? null, rule_id: d.rule_id ?? null,
    ai_recommendation: d.ai_recommendation ?? null, guest_refund: d.guest_refund ?? null, guest_refund_note: d.guest_refund_note ?? null, guest_refunded_at: d.guest_refunded_at ?? null };
}
export const TABS: { id: DisputeTab; label: string }[] = [{ id: 'nuevas', label: 'Nuevas' }, { id: 'decidir', label: 'Necesitan decisión' }, { id: 'resueltas', label: 'Resueltas' }];
export function counts(rows: AdminDisputeRow[]) { return { nuevas: rows.filter((r) => r.tab === 'nuevas').length, decidir: rows.filter((r) => r.tab === 'decidir').length, resueltas: rows.filter((r) => r.tab === 'resueltas').length }; }

/** Links al explorador (testnet) del contrato y de las tx conocidas del pedido. */
export const EXPLORER = 'https://stellar.expert/explorer/testnet';
export function linksOf(o: any) {
  const out: { label: string; url: string }[] = [];
  if (o.contract_id) out.push({ label: 'Contrato', url: `${EXPLORER}/contract/${o.contract_id}` });
  for (const [k, label] of [['deploy_tx', 'Tx de creación'], ['funded_tx', 'Tx de pago'], ['shipped_tx', 'Tx de envío'], ['dispute_tx', 'Tx de disputa'], ['resolved_tx', 'Tx de resolución'], ['released_tx', 'Tx de liberación']] as const)
    if (typeof o[k] === 'string' && /^[0-9a-f]{64}$/.test(o[k])) out.push({ label, url: `${EXPLORER}/tx/${o[k]}` });
  return out;
}
