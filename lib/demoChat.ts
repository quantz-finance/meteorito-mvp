// Chat en MODO DEMO: misma forma de respuesta que /api/store (acciones chat_*), sin red. En sessionStorage, como el
// resto del demo. El comprador y el vendedor del demo comparten el navegador: se cambia de vista con ?role=.
import { blockLock, buyerLabel, chatPreview, cleanChatText, CHAT_BLOCK_LOCKED, CHAT_MAX, isUnread, type ChatRole } from '../api/_lib/chatText'; // pura
import { canShowContact } from '../api/_lib/contact'; // pura

const KEY = 'meteorito:demo:chat:v1';
interface Conv { token: string; store: string; store_name: string; buyer: string; ctx: string; order_slug: string | null; item_slug: string | null; subject: string | null; item_photo: string | null;
  blocked: boolean; last_message_at: string | null; last_sender: ChatRole | null; last_preview: string | null; buyer_read_at: string | null; seller_read_at: string | null }
interface Msg { id: number; sender: ChatRole; body: string; client_id: string | null; created_at: string }
interface St { seq: number; convs: Record<string, Conv>; msgs: Record<string, Msg[]>; reports: string[] }
export interface DemoChatCtx {
  role: 'buyer' | 'seller'; buyer: string; sellerSlug: string; sellerName: string;
  orders: Record<string, { slug: string; brand: string; model: string; photos: string[]; status: string; price_crc: number; buyer?: string | null }>;
  profile: (slug: string) => Promise<{ display_name: string; store_slug: string; avatar_url?: string | null } | null>;
}
const err = (status: number, code: string, msg: string) => Object.assign(new Error(msg), { status, code });
function load(): St { try { const r = window.sessionStorage.getItem(KEY); if (r) return JSON.parse(r); } catch { /* */ } return { seq: 0, convs: {}, msgs: {}, reports: [] }; }
function save(s: St) { try { window.sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* */ } }
export function resetDemoChat() { try { window.sessionStorage.removeItem(KEY); } catch { /* */ } }
const tok = () => { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'; let s = ''; const b = new Uint8Array(32); crypto.getRandomValues(b); for (const x of b) s += a[x % 64]; return s; };
const title = (o: { brand: string; model: string }) => `${o.brand ?? ''} ${o.model ?? ''}`.trim() || 'Artículo';

export async function demoChatApi(body: any, x: DemoChatCtx): Promise<any> {
  const s = load();
  const role: ChatRole = x.role;
  const party = (c: Conv) => (role === 'seller' ? c.store === x.sellerSlug : c.buyer === x.buyer);
  const get = (t: unknown) => { const c = s.convs[String(t)]; if (!c || !party(c)) throw err(404, 'chat_not_found', 'No encontramos esta conversación.'); return c; };
  const now = new Date().toISOString();
  // Pedidos entre ese comprador y el vendedor del demo (todos los pedidos del demo son de ese vendedor).
  const lockOf = (c: Conv) => (c.store === x.sellerSlug ? blockLock(Object.values(x.orders).filter((o) => o.buyer && o.buyer === c.buyer)) : null);
  if (body.action === 'chat_open') {
    let store: string, store_name: string, ctx: string, order_slug: string | null = null, item_slug: string | null = null, subject: string | null = null, item_photo: string | null = null;
    if (body.order_slug) {
      const o = x.orders[String(body.order_slug)];
      if (!o || (role === 'buyer' && o.buyer !== x.buyer)) throw err(404, 'chat_not_found', 'No encontramos esta conversación.');
      store = x.sellerSlug; store_name = x.sellerName; ctx = `order:${o.slug}`; order_slug = o.slug; subject = title(o); item_photo = o.photos[0] ?? null;
    } else {
      const p = await x.profile(String(body.store_slug ?? ''));
      if (!p) throw err(404, 'not_found', 'Este perfil no existe.');
      if (role === 'seller' && p.store_slug === x.sellerSlug) throw err(400, 'self_chat', 'Es tu propia tienda.');
      store = p.store_slug; store_name = p.display_name; ctx = 'store';
      const it = body.item_slug ? x.orders[String(body.item_slug)] : null;
      if (it && store === x.sellerSlug) { item_slug = it.slug; subject = title(it); item_photo = it.photos[0] ?? null; }
    }
    const buyer = order_slug ? (x.orders[order_slug].buyer ?? x.buyer) : x.buyer;
    const found = Object.values(s.convs).find((c) => c.store === store && c.buyer === buyer && c.ctx === ctx);
    if (found) { if (item_slug) Object.assign(found, { item_slug, subject, item_photo }); save(s); return { token: found.token, role }; }
    const c: Conv = { token: tok(), store, store_name, buyer, ctx, order_slug, item_slug, subject, item_photo, blocked: false, last_message_at: null, last_sender: null, last_preview: null, buyer_read_at: null, seller_read_at: null };
    s.convs[c.token] = c; s.msgs[c.token] = []; save(s);
    return { token: c.token, role };
  }
  if (body.action === 'chat_list') {
    const as: ChatRole = body.as === 'seller' ? 'seller' : 'buyer';
    const mine = Object.values(s.convs).filter((c) => c.last_message_at && (as === 'seller' ? c.store === x.sellerSlug : c.buyer === x.buyer))
      .sort((a, b) => String(b.last_message_at).localeCompare(String(a.last_message_at)));
    const unread = mine.filter((c) => isUnread(c, as)).length;
    if (body.summary === true) return { unread, total: mine.length };
    return { unread, conversations: mine.map((c) => ({ token: c.token, role: as, kind: c.order_slug ? 'order' : 'store', order_slug: c.order_slug, subject: c.subject,
      photo: as === 'seller' ? c.item_photo : null, name: as === 'buyer' ? c.store_name : buyerLabel(c.buyer), last_preview: c.last_preview ?? '', last_sender: c.last_sender,
      last_message_at: c.last_message_at, unread: isUnread(c, as), blocked: c.blocked })) };
  }
  const c = get(body.token);
  const other: ChatRole = role === 'buyer' ? 'seller' : 'buyer';
  if (body.action === 'chat_get') {
    const all = s.msgs[c.token] ?? [];
    const after = Number(body.after) || 0;
    const messages = after ? all.filter((m) => m.id > after) : all.slice(-60);
    if (isUnread(c, role)) { c[`${role}_read_at`] = now; save(s); }
    const st = { role, blocked: c.blocked, other_read_at: c[`${other}_read_at`], other_typing: false, has_more: false, messages };
    if (body.full !== true) return st;
    const ref = c.order_slug ?? c.item_slug; const o = ref ? x.orders[ref] : null;
    const p = role === 'buyer' ? await x.profile(c.store) : null;
    return { ...st, can_block: role === 'seller' && !lockOf(c), conversation: { token: c.token, kind: c.order_slug ? 'order' : 'store', subject: c.subject, item_photo: c.item_photo,
      item: o && !c.order_slug ? { slug: o.slug, price_crc: o.price_crc } : null, order: o && c.order_slug ? { slug: o.slug, status: o.status, price_crc: o.price_crc } : null,
      paid: !!(o && c.order_slug && canShowContact(o.status)),
      other: role === 'buyer' ? { name: c.store_name, store_slug: c.store, avatar_url: p?.avatar_url ?? null } : { name: buyerLabel(c.buyer), store_slug: null, avatar_url: null } } };
  }
  if (body.action === 'chat_send') {
    const text = cleanChatText(body.body);
    if (text === 'empty') throw err(400, 'chat_empty', 'Escribe un mensaje.');
    if (text === 'too_long') throw err(400, 'chat_too_long', `El mensaje puede tener hasta ${CHAT_MAX} caracteres.`);
    if (c.blocked) throw err(403, 'chat_blocked', role === 'seller' ? 'Bloqueaste esta conversación. Desbloquéala para escribir.' : 'No puedes enviar mensajes en esta conversación.');
    const list = (s.msgs[c.token] ??= []);
    const dup = body.client_id ? list.find((m) => m.client_id === body.client_id) : null;
    if (dup) return { message: dup };
    await new Promise((r) => setTimeout(r, 250)); // deja ver el estado "enviando"
    const m: Msg = { id: ++s.seq, sender: role, body: text, client_id: body.client_id ?? null, created_at: new Date().toISOString() };
    list.push(m);
    Object.assign(c, { last_message_at: m.created_at, last_sender: role, last_preview: chatPreview(text, 120), [`${role}_read_at`]: m.created_at });
    save(s); return { message: m };
  }
  if (body.action === 'chat_block') {
    if (role !== 'seller') throw err(403, 'not_seller', 'Solo el vendedor puede bloquear la conversación.');
    const want = body.blocked !== false;
    if (want && !c.blocked && lockOf(c)) throw err(409, 'chat_block_locked', CHAT_BLOCK_LOCKED);
    c.blocked = want; save(s); return { blocked: c.blocked };
  }
  if (body.action === 'chat_report') {
    const k = `${c.token}:${role}`; const already = s.reports.includes(k); if (!already) s.reports.push(k); save(s);
    return { reported: true, ...(already ? { already: true } : {}) };
  }
  throw err(400, 'bad_action', 'acción inválida');
}
