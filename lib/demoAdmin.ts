// Modo demo: panel admin de disputas y respuesta del vendedor (mismas formas que api/_lib/disputeAdmin.ts), en memoria.
// El "admin" del demo se activa SOLO con ?admin=1 en el build de demo (nunca en producción: el demo no corre en los
// dominios de producción y el panel real lo decide el servidor con ADMIN_EMAILS). Sin IA en el demo: "no disponible".
import { pctOf } from '../api/_lib/disputeRules';
import { buildRow, counts, EVENT_LABEL, linksOf, responseDeadlineOf, toDecisionView, type AdminDisputeDetail } from '../api/_lib/disputeView';

export interface DemoAdminCtx {
  admin: boolean; role: 'seller' | 'buyer'; orders: Record<string, any>;
  audit: Record<string, any[]>; responses: Record<string, { body: string; photo: string | null; created_at: string }>;
  caps: Map<string, { id: string; purpose: string; ref: string; exp: number; used: boolean }>;
  resolve: (slug: string, buyerPct: number) => void; emit: () => void;
}
const err = (status: number, code: string, msg: string) => Object.assign(new Error(msg), { status, code });
const disputeOf = (o: any) => ({ reason: o.dispute?.reason ?? 'otro', description: o.dispute?.description ?? null, evidence: o.dispute?.evidence ?? [], opened_at: o.dispute?.at ?? o.disputed_at ?? null, state: o.status === 'resuelto' ? 'resolved' : 'open' });
const orderOf = (o: any) => ({ ...o, buyer_user_id: o.buyer ?? 'guest:A', seller_user_id: 'demo-seller', ship_evidence: o.evidence ?? null, ship_evidence_hash: o.shipped_tx ? 'sha256:' + String(o.shipped_tx).slice(0, 16) : null });
const SELLER = { store_slug: 'valeria', display_name: 'Valeria' };

function row(c: DemoAdminCtx, o: any) {
  return buildRow({ order: orderOf(o), dispute: disputeOf(o), seller: SELLER, response: c.responses[o.slug] ?? null, responsesAvailable: true, decisions: (c.audit[o.slug] ?? []).map(toDecisionView) });
}
const disputed = (c: DemoAdminCtx) => Object.values(c.orders).filter((o: any) => o.dispute || o.status === 'en_disputa' || (o.status === 'resuelto' && o.resolution));

export function demoAdminApi(c: DemoAdminCtx, body: any): any {
  const a = String(body.action);
  const get = (slug: string) => { const o = c.orders[slug]; if (!o || !(o.dispute || ['en_disputa', 'resuelto'].includes(o.status))) throw err(404, 'not_found', 'Ese pedido no tiene disputa.'); return o; };
  if (a === 'seller_response_get' || a === 'seller_respond') {
    if (c.role !== 'seller') throw err(403, 'not_seller', 'Solo el vendedor de este pedido puede responder.');
    const o = get(String(body.slug));
    const resp = c.responses[o.slug] ?? null;
    if (a === 'seller_response_get') return { available: true, open: o.status === 'en_disputa', response: resp, deadline: responseDeadlineOf(o, disputeOf(o)), can_respond: o.status === 'en_disputa' };
    if (o.status !== 'en_disputa') throw err(409, 'not_open', 'Esta disputa ya no está abierta.');
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (text.length < 3) throw err(400, 'body_required', 'Cuéntanos tu versión (mínimo 3 caracteres).');
    let photo: string | null = null;
    if (body.photo) { const cap = c.caps.get(String(body.capture ?? '')); if (!cap || cap.purpose !== 'dispute' || cap.ref !== o.slug || !cap.used) throw err(400, 'camera_required', 'Toma la foto con la cámara de Meteorito.'); photo = String(body.photo); }
    c.responses[o.slug] = { body: text.slice(0, 1000), photo, created_at: new Date().toISOString() }; c.emit();
    return { saved: true, response: c.responses[o.slug] };
  }
  if (!c.admin) throw err(404, 'not_found', 'No encontramos esta página.');
  if (a === 'admin_me') return { admin: true, email: 'admin@demo.meteorito.app' };
  if (a === 'admin_list') { const rows = disputed(c).map((o) => row(c, o)); return { disputes: rows, counts: counts(rows), flags: { autoResolve: false, ai: true }, capabilities: { responses: true, executeOnchain: true, auditTable: true, ai: false } }; }
  if (a === 'admin_ai') return { available: false, reason: 'no_credentials', result: null, cached: false };
  if (a === 'admin_get') {
    const o = get(String(body.slug)); const r = row(c, o); const ord = orderOf(o); const d = disputeOf(o);
    const tl = [['created', o.created_at], ['funded', o.funded_at], ['shipped', o.shipped_at], ['dispute_opened', d.opened_at], ['dispute_resolved', o.status === 'resuelto' ? o.released_at : null]]
      .filter(([, at]) => at).map(([kind, at]) => ({ kind: kind as string, at: at as string, label: EVENT_LABEL[kind as string] ?? String(kind) }));
    if (c.responses[o.slug]) tl.push({ kind: 'seller_response', at: c.responses[o.slug].created_at, label: EVENT_LABEL.seller_response });
    tl.sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
    const detail: AdminDisputeDetail = {
      ...r, description: d.description, evidence: (d.evidence as string[]).filter((u) => typeof u === 'string'), delivery_mode: o.delivery_mode ?? 'envio', timeline: tl,
      ship: o.shipped_at || o.evidence ? { shipped_at: o.shipped_at ?? null, photo: o.evidence?.photo ?? null, note: o.evidence?.note ?? null, hash: ord.ship_evidence_hash, captured_at: o.evidence?.captured_at ?? null } : null,
      response: c.responses[o.slug] ?? null, response_deadline: responseDeadlineOf(o, d), responses_available: true,
      chat: { available: true, order: [{ from: 'comprador', body: 'Hola, ¿ya lo enviaste?', at: o.funded_at ?? o.created_at }, { from: 'vendedor', body: 'Sí, hoy por Correos.', at: o.shipped_at ?? o.created_at }], store: [] },
      onchain: { contract_id: o.contract_id, disputed: o.status === 'en_disputa', released: false, resolved: o.status === 'resuelto', balance: o.status === 'en_disputa' ? o.amount_usdc : 0 },
      links: linksOf(o), decisions: (c.audit[o.slug] ?? []).map(toDecisionView),
      ai: { available: false, reason: 'no_credentials', cached: null, cache_available: true }, flags: { autoResolve: false, ai: true }, capabilities: { executeOnchain: true, auditTable: true },
      guest: { is_guest: r.buyer.kind === 'invitado', refund_pending: r.guest_refund_pending, to_buyer: o.resolution?.toBuyer ?? null, contact: null },
    };
    return detail;
  }
  if (a === 'admin_decide') {
    const o = get(String(body.slug));
    if (o.status !== 'en_disputa') throw err(409, 'not_open', 'Esta disputa ya está resuelta.');
    const pct = pctOf(body.outcome, body.buyer_pct);
    if (pct == null) throw err(400, 'bad_decision', body.outcome === 'split' ? 'Elige un porcentaje para el comprador entre 1 y 99.' : 'Elige una decisión.');
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (note.length < 3) throw err(400, 'note_required', 'Escribe una nota con el motivo de la decisión.');
    if (body.confirm !== true) throw err(400, 'confirm_required', 'Confirma la decisión.');
    const amt = Number(o.amount_usdc ?? 0); const toBuyer = Math.round(amt * pct) / 100; const toSeller = Math.round((amt - toBuyer) * 1e7) / 1e7;
    c.resolve(o.slug, pct);
    o.resolution = { buyerPct: pct, toBuyer, toSeller, balance: amt };
    const guest = String(o.buyer ?? 'guest:').startsWith('guest:') && toBuyer > 0;
    (c.audit[o.slug] ??= []).unshift({ id: (c.audit[o.slug]?.length ?? 0) + 1, created_at: new Date().toISOString(), decided_by_email: 'admin@demo.meteorito.app', source: 'admin', outcome: body.outcome, buyer_pct: pct, note, status: 'executed', resolved_tx: null, rule_id: body.rule_id ?? null, guest_refund: guest ? 'pendiente' : 'no_aplica' });
    c.emit();
    return { executed: true, resolvedTx: null, buyerPct: pct, toBuyer, toSeller, guestRefundPending: guest };
  }
  if (a === 'admin_guest_refund') {
    const o = get(String(body.slug)); const d = (c.audit[o.slug] ?? [])[0];
    if (!d || d.guest_refund !== 'pendiente') throw err(409, 'no_refund_pending', 'Este pedido no tiene una devolución pendiente.');
    Object.assign(d, { guest_refund: 'devuelto', guest_refund_note: String(body.note ?? '').slice(0, 500) || null, guest_refunded_at: new Date().toISOString() }); c.emit();
    return { done: true };
  }
  throw err(400, 'bad_action', 'acción inválida');
}
