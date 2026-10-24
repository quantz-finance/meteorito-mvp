// Panel admin de disputas (server). Lee disputas + pedidos + evidencia + chat + estado on-chain y arma las vistas de
// api/_lib/disputeView.ts. Todo degrada sin la migración 027: sin respuestas del vendedor (la regla de 48 h no aplica),
// sin caché de IA (se genera solo al pedirla), sin flags en DB (solo env) y la auditoría va a order_events.
// Acciones (api/escrow/dispute.ts): admin_me, admin_list, admin_get, admin_ai, admin_decide, admin_guest_refund (admin);
// seller_response_get, seller_respond (vendedor del pedido).
import { HttpError } from './auth';
import { db } from './db';
import { chain } from './escrow';
import { isMissingTable } from './push';
import { aiStatus, buildAiInput, inputHash, runAi, type AiFacts, type AiResult } from './disputeAi';
import { evaluateRules } from './disputeRules';
import { decideDispute, loadDecisions, resolverSecret } from './disputeResolve';
import { buildRow, counts, EVENT_LABEL, linksOf, responseDeadlineOf, toDecisionView, type AdminDisputeDetail, type AdminDisputeRow, type ChatLine } from './disputeView';
import { cameraPhoto, captureUrl, checkCaptureToken } from './capture';

const ORDER_COLS = 'id, slug, status, brand, model, photos, price_crc, amount_usdc, buyer_user_id, seller_user_id, buyer_address, seller_address, contract_id, deploy_tx, funded_tx, funded_at, shipped_tx, shipped_at, ship_evidence, ship_evidence_hash, dispute_tx, disputed_at, resolved_tx, resolved_at, resolution, released_tx, created_at, delivery_mode';
const ORDER_COLS_OLD = ORDER_COLS.replace(', delivery_mode', '');

/* ---------- Flags (027: app_flags; env manda si está puesta) ---------- */
export interface DisputeFlags { autoResolve: boolean; ai: boolean }
export async function disputeFlags(): Promise<DisputeFlags & { table: boolean }> {
  let db_: Record<string, any> = {}; let table = false;
  const { data, error } = await db().from('app_flags').select('key, value').in('key', ['disputes_auto_resolve', 'disputes_ai']);
  if (!error) { table = true; for (const r of data ?? []) db_[r.key] = r.value; } else if (!isMissingTable(error)) console.warn('[disputes] flags', error.code ?? error.message);
  const envB = (k: string) => (process.env[k] === '1' ? true : process.env[k] === '0' ? false : undefined);
  const autoResolve = envB('DISPUTES_AUTO_RESOLVE') ?? db_.disputes_auto_resolve === true; // apagado por defecto
  const ai = envB('DISPUTES_AI') ?? db_.disputes_ai !== false;
  return { autoResolve, ai, table };
}

/* ---------- Respuesta del vendedor (027: dispute_responses) ---------- */
export async function loadResponses(orderIds: string[]): Promise<{ byOrder: Record<string, any>; available: boolean }> {
  const byOrder: Record<string, any> = {};
  if (!orderIds.length) { const { error } = await db().from('dispute_responses').select('order_id').limit(1); return { byOrder, available: !error || !isMissingTable(error) }; }
  const { data, error } = await db().from('dispute_responses').select('order_id, body, photo, created_at, updated_at').in('order_id', orderIds);
  if (error) { if (!isMissingTable(error)) console.warn('[disputes] respuestas', error.code ?? error.message); return { byOrder, available: !isMissingTable(error) }; }
  for (const r of data ?? []) byOrder[r.order_id] = r;
  return { byOrder, available: true };
}

async function ordersByIds(ids: string[]) {
  if (!ids.length) return [];
  let { data, error } = await db().from('orders').select(ORDER_COLS).in('id', ids);
  if (error && /delivery_mode/.test(String(error.message))) ({ data, error } = await db().from('orders').select(ORDER_COLS_OLD).in('id', ids));
  if (error) throw error;
  return data ?? [];
}
async function sellers(subs: string[]) {
  const out: Record<string, any> = {};
  if (!subs.length) return out;
  const { data, error } = await db().from('seller_profiles').select('sub, store_slug, display_name').in('sub', subs);
  if (!error) for (const r of data ?? []) out[r.sub] = r;
  return out;
}

export async function adminList(req?: any): Promise<{ disputes: AdminDisputeRow[]; counts: ReturnType<typeof counts>; flags: DisputeFlags; capabilities: { responses: boolean; executeOnchain: boolean; auditTable: boolean; ai: boolean } }> {
  const { data: ds, error } = await db().from('disputes').select('order_id, reason, description, evidence, opened_at, state, resolved_at, resolution').order('opened_at', { ascending: false }).limit(300);
  if (error) throw error;
  const list = ds ?? [];
  const ids = list.map((d: any) => d.order_id);
  const [orders, resp, dec, flags] = await Promise.all([ordersByIds(ids), loadResponses(ids), loadDecisions(ids), disputeFlags()]);
  const byId: Record<string, any> = Object.fromEntries(orders.map((o: any) => [o.id, o]));
  const sel = await sellers([...new Set(orders.map((o: any) => o.seller_user_id).filter(Boolean))] as string[]);
  const now = Date.now();
  const rows = list.filter((d: any) => byId[d.order_id] && (byId[d.order_id].status === 'en_disputa' || byId[d.order_id].status === 'resuelto' || d.state === 'open' || d.state === 'resolved'))
    .map((d: any) => { const o = byId[d.order_id]; return buildRow({ order: o, dispute: d, seller: sel[o.seller_user_id], response: resp.byOrder[o.id] ?? null, responsesAvailable: resp.available, decisions: (dec.byOrder[o.id] ?? []).map(toDecisionView), now }); });
  return { disputes: rows, counts: counts(rows), flags: { autoResolve: flags.autoResolve, ai: flags.ai }, capabilities: { responses: resp.available, executeOnchain: !!resolverSecret(), auditTable: dec.table, ai: flags.ai && aiStatus(req).available } };
}

const safeTimeline = (o: any, evs: any[]) => {
  const base = [
    { kind: 'created', at: o.created_at }, { kind: 'funded', at: o.funded_at }, { kind: 'shipped', at: o.shipped_at }, { kind: 'dispute_opened', at: o.disputed_at }, { kind: 'dispute_resolved', at: o.resolved_at },
  ].filter((e) => e.at);
  const seen = new Set(base.map((e) => e.kind));
  const extra = evs.filter((e) => !seen.has(e.kind) || !['created', 'funded', 'shipped', 'dispute_opened', 'dispute_resolved'].includes(e.kind)).filter((e) => !String(e.kind).endsWith('_update'))
    .map((e) => ({ kind: e.kind, at: e.created_at }));
  return [...base, ...extra].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).map((e) => ({ ...e, label: EVENT_LABEL[e.kind] ?? e.kind.replace(/_/g, ' ') }));
};

async function chatFor(o: any): Promise<AdminDisputeDetail['chat']> {
  const convs: any[] = [];
  const a = await db().from('chat_conversations').select('id, ctx, order_slug').eq('order_slug', o.slug);
  if (a.error) return { available: false, order: [], store: [] };
  convs.push(...(a.data ?? []));
  if (o.buyer_user_id && o.seller_user_id) {
    const b = await db().from('chat_conversations').select('id, ctx, order_slug').eq('ctx', 'store').eq('buyer_id', o.buyer_user_id).eq('seller_user_id', o.seller_user_id);
    if (!b.error) convs.push(...(b.data ?? []));
  }
  if (!convs.length) return { available: true, order: [], store: [] };
  const { data: msgs, error } = await db().from('chat_messages').select('conversation_id, sender, body, created_at, id').in('conversation_id', convs.map((c) => c.id)).order('id', { ascending: true }).limit(400);
  if (error) return { available: false, order: [], store: [] };
  const ctxOf: Record<string, string> = Object.fromEntries(convs.map((c) => [c.id, c.ctx === 'store' ? 'store' : 'order']));
  const line = (m: any): ChatLine => ({ from: m.sender === 'seller' ? 'vendedor' : 'comprador', body: String(m.body ?? ''), at: m.created_at });
  return { available: true, order: (msgs ?? []).filter((m: any) => ctxOf[m.conversation_id] === 'order').map(line), store: (msgs ?? []).filter((m: any) => ctxOf[m.conversation_id] === 'store').map(line) };
}

const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('tiempo agotado')), ms))]);
async function onchainOf(o: any): Promise<AdminDisputeDetail['onchain']> {
  if (!o.contract_id) return { contract_id: null };
  try {
    const [g, bal] = await withTimeout(Promise.all([chain().releaseGuard(o.contract_id), chain().getBalance(o.contract_id).catch(() => null)]), 8000);
    return { contract_id: o.contract_id, disputed: !!g.disputed, released: !!g.released, resolved: !!g.resolved, balance: bal };
  } catch (e: any) { return { contract_id: o.contract_id, error: String(e?.message ?? e).slice(0, 120) }; }
}

async function loadOne(slug: string) {
  if (typeof slug !== 'string' || !/^[a-z0-9]{6}$/.test(slug)) throw new HttpError(400, 'slug inválido');
  let { data: o, error } = await db().from('orders').select(ORDER_COLS).eq('slug', slug).maybeSingle();
  if (error && /delivery_mode/.test(String(error.message))) ({ data: o, error } = await db().from('orders').select(ORDER_COLS_OLD).eq('slug', slug).maybeSingle());
  if (error) throw error;
  if (!o) throw Object.assign(new HttpError(404, 'Ese pedido no existe.'), { code: 'not_found' });
  const { data: d } = await db().from('disputes').select('*').eq('order_id', o.id).maybeSingle();
  if (!d) throw Object.assign(new HttpError(404, 'Ese pedido no tiene disputa.'), { code: 'no_dispute' });
  return { o, d };
}

/** Hechos minimizados para la IA (y su hash para la caché). */
function aiFacts(o: any, d: any, evs: any[], response: any, chat: AdminDisputeDetail['chat'], rule: any): AiFacts {
  return {
    product: `${o.brand ?? ''} ${o.model ?? ''}`.trim() || 'Producto', priceCrc: Number(o.price_crc) || 0, delivery: o.delivery_mode === 'cara_a_cara' ? 'cara_a_cara' : 'envio',
    reason: d.reason, description: d.description ?? null, evidenceCount: Array.isArray(d.evidence) ? d.evidence.length : 0, openedAt: d.opened_at ?? o.disputed_at ?? null,
    timeline: safeTimeline(o, evs).map((e) => ({ kind: e.kind, at: e.at })),
    ship: { shipped: !!(o.shipped_at || o.shipped_tx), photo: !!o.ship_evidence?.photo, note: !!String(o.ship_evidence?.note ?? '').trim(), hash: !!o.ship_evidence_hash },
    response: response ? { body: response.body, photo: !!response.photo, at: response.updated_at ?? response.created_at } : null,
    chat: [...chat.order.map((m) => ({ ...m, ctx: 'pedido' as const })), ...chat.store.map((m) => ({ ...m, ctx: 'tienda' as const }))].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      .map((m) => ({ from: m.from, body: m.body, at: m.at, ctx: m.ctx })),
    rule,
  };
}

async function aiCacheGet(orderId: string): Promise<{ row: any; available: boolean }> {
  const { data, error } = await db().from('dispute_ai_summaries').select('order_id, input_hash, result, model, created_at').eq('order_id', orderId).maybeSingle();
  if (error) return { row: null, available: !isMissingTable(error) };
  return { row: data ?? null, available: true };
}

export async function adminDetail(slug: string, req?: any): Promise<AdminDisputeDetail> {
  const { o, d } = await loadOne(slug);
  const [{ data: evs }, resp, dec, chat, onchain, flags, cache] = await Promise.all([
    db().from('order_events').select('kind, created_at').eq('order_id', o.id).order('created_at', { ascending: true }).limit(200),
    loadResponses([o.id]), loadDecisions([o.id]), chatFor(o), onchainOf(o), disputeFlags(), aiCacheGet(o.id),
  ]);
  const sel = await sellers([o.seller_user_id].filter(Boolean));
  const response = resp.byOrder[o.id] ?? null;
  const decisions = (dec.byOrder[o.id] ?? []).map(toDecisionView);
  const row = buildRow({ order: o, dispute: d, seller: sel[o.seller_user_id], response, responsesAvailable: resp.available, decisions });
  const ev = o.ship_evidence ?? null;
  const st = aiStatus(req);
  const isGuest = row.buyer.kind === 'invitado';
  return {
    ...row, description: d.description ?? null, evidence: Array.isArray(d.evidence) ? d.evidence.filter((u: unknown) => typeof u === 'string') : [], delivery_mode: o.delivery_mode ?? null,
    timeline: safeTimeline(o, evs ?? []),
    ship: o.shipped_at || ev ? { shipped_at: o.shipped_at ?? null, photo: ev?.photo ?? null, note: ev?.note ?? null, hash: o.ship_evidence_hash ?? null, captured_at: ev?.captured_at ?? null } : null,
    response: response ? { body: response.body, photo: response.photo ?? null, created_at: response.updated_at ?? response.created_at } : null,
    response_deadline: responseDeadlineOf(o, d), responses_available: resp.available,
    chat, onchain, links: linksOf(o), decisions,
    ai: { available: flags.ai && st.available, reason: !flags.ai ? 'flag_off' : st.reason, cached: (cache.row?.result as AiResult) ?? null, cache_available: cache.available },
    flags: { autoResolve: flags.autoResolve, ai: flags.ai }, capabilities: { executeOnchain: !!resolverSecret(), auditTable: dec.table },
    // El invitado no deja contacto (docs/guest-checkout.md): el canal es el chat del pedido.
    guest: { is_guest: isGuest, refund_pending: row.guest_refund_pending, to_buyer: o.resolution?.toBuyer ?? null, contact: null },
  };
}

/** Capa E con caché por disputa (hash de la entrada). refresh=true fuerza una nueva llamada. */
export async function adminAi(slug: string, req: any, refresh = false): Promise<{ available: boolean; reason?: string; result: AiResult | null; cached: boolean }> {
  const flags = await disputeFlags();
  const st = aiStatus(req);
  if (!flags.ai || !st.available) return { available: false, reason: !flags.ai ? 'flag_off' : st.reason, result: null, cached: false };
  const { o, d } = await loadOne(slug);
  const [{ data: evs }, resp, chat, cache] = await Promise.all([
    db().from('order_events').select('kind, created_at').eq('order_id', o.id).order('created_at', { ascending: true }).limit(200), loadResponses([o.id]), chatFor(o), aiCacheGet(o.id)]);
  const response = resp.byOrder[o.id] ?? null;
  const rule = o.status === 'en_disputa' ? evaluateRules({ order: o, dispute: { opened_at: d.opened_at, reason: d.reason }, response, responsesAvailable: resp.available }) : null;
  const input = buildAiInput(aiFacts(o, d, evs ?? [], response, chat, rule));
  const hash = inputHash(input);
  if (!refresh && cache.row && cache.row.input_hash === hash && cache.row.result) return { available: true, result: cache.row.result, cached: true };
  const result = await runAi(input, req);
  if (cache.available) {
    const { error } = await db().from('dispute_ai_summaries').upsert({ order_id: o.id, input_hash: hash, result, model: result.model, created_at: result.at }, { onConflict: 'order_id' });
    if (error && !isMissingTable(error)) console.warn('[disputes] caché IA', error.code ?? error.message);
  }
  return { available: true, result, cached: false };
}

/* ---------- Respuesta del vendedor (capa D) ---------- */
export async function sellerResponseGet(order: any, sellerSub: string) {
  if (order.seller_user_id !== sellerSub) throw Object.assign(new HttpError(403, 'Solo el vendedor de este pedido puede responder.'), { code: 'not_seller' });
  const { data: d } = await db().from('disputes').select('opened_at, state').eq('order_id', order.id).maybeSingle();
  const resp = await loadResponses([order.id]);
  const open = order.status === 'en_disputa';
  return { available: resp.available, open, response: resp.byOrder[order.id] ? { body: resp.byOrder[order.id].body, photo: resp.byOrder[order.id].photo ?? null, created_at: resp.byOrder[order.id].updated_at ?? resp.byOrder[order.id].created_at } : null,
    deadline: d ? responseDeadlineOf(order, d) : null, can_respond: resp.available && open && !!d };
}
export async function sellerRespond(order: any, sellerSub: string, raw: any) {
  if (order.seller_user_id !== sellerSub) throw Object.assign(new HttpError(403, 'Solo el vendedor de este pedido puede responder.'), { code: 'not_seller' });
  if (order.status !== 'en_disputa') throw Object.assign(new HttpError(409, 'Esta disputa ya no está abierta.'), { code: 'not_open' });
  const body = typeof raw?.body === 'string' ? raw.body.trim() : '';
  if (body.length < 3) throw Object.assign(new HttpError(400, 'Cuéntanos tu versión (mínimo 3 caracteres).'), { code: 'body_required' });
  if (body.length > 1000) throw Object.assign(new HttpError(400, 'Máximo 1000 caracteres.'), { code: 'body_too_long' });
  let photo: string | null = null;
  if (raw?.photo != null && raw.photo !== '') {
    let c;
    try { c = checkCaptureToken(raw.capture, { purpose: 'dispute', subs: [sellerSub], ref: order.slug, allowExpired: true }); }
    catch (e: any) { throw Object.assign(new HttpError(400, e.message), { code: e.code === 'capture_token_required' ? 'camera_required' : e.code }); }
    const cam = cameraPhoto(raw.photo, sellerSub);
    if (!cam || cam.id !== c.id || raw.photo !== captureUrl(c)) throw Object.assign(new HttpError(400, 'Toma la foto con la cámara de Meteorito.'), { code: 'camera_required' });
    photo = raw.photo;
  }
  const now = new Date().toISOString();
  const { error } = await db().from('dispute_responses').upsert({ order_id: order.id, seller_user_id: sellerSub, body, photo, updated_at: now }, { onConflict: 'order_id' });
  if (error) {
    if (isMissingTable(error)) throw Object.assign(new HttpError(503, 'Todavía no puedes responder aquí. Escríbenos por el chat del pedido.'), { code: 'responses_unavailable' });
    throw error;
  }
  await db().from('order_events').insert({ order_id: order.id, kind: 'seller_response', detail: { photo: !!photo, length: body.length } });
  return { saved: true, response: { body, photo, created_at: now } };
}

/** Auto-resolución por reglas (capa B). SOLO corre con el flag disputes_auto_resolve encendido (apagado por defecto) y con
 *  DISPUTE_RESOLVER_SECRET en el servidor. Nunca toca una disputa que ya tiene una decisión registrada. Lo llama el cron. */
export async function autoResolvePass(limit = 5): Promise<{ skipped?: string; resolved: string[]; errors: string[] }> {
  const flags = await disputeFlags();
  if (!flags.autoResolve) return { skipped: 'flag_off', resolved: [], errors: [] };
  const secret = resolverSecret();
  if (!secret) return { skipped: 'no_secret', resolved: [], errors: [] };
  const { data: ds, error } = await db().from('disputes').select('order_id, reason, opened_at, state').eq('state', 'open').limit(50);
  if (error) throw error;
  const ids = (ds ?? []).map((d: any) => d.order_id);
  const [orders, resp, dec] = await Promise.all([ordersByIds(ids), loadResponses(ids), loadDecisions(ids)]);
  const out = { resolved: [] as string[], errors: [] as string[] };
  for (const o of orders.filter((x: any) => x.status === 'en_disputa')) {
    if (out.resolved.length >= limit) break;
    if ((dec.byOrder[o.id] ?? []).length) continue;
    const d = (ds ?? []).find((x: any) => x.order_id === o.id);
    const rule = evaluateRules({ order: o, dispute: { opened_at: d?.opened_at, reason: d?.reason }, response: resp.byOrder[o.id] ?? null, responsesAvailable: resp.available });
    if (!rule) continue;
    try { await decideDispute(o, { sub: 'auto', email: null, source: 'auto_rule' }, { outcome: rule.outcome, buyerPct: rule.buyerPct, note: `${rule.title}. ${rule.why}`, ruleId: rule.rule }, { secret }); out.resolved.push(o.slug); }
    catch (e: any) { out.errors.push(`${o.slug}: ${String(e?.message ?? e).slice(0, 120)}`); }
  }
  return out;
}
