// Chat comprador-vendedor (migración 025: chat_conversations, chat_messages, chat_reports). Todo pasa por /api/store
// (acciones chat_*): sin función nueva en Vercel, y cada lectura/escritura se valida en el servidor.
// Privacidad: una conversación se abre con su token (32 caracteres aleatorios, nunca un id secuencial) Y solo si quien
// pide es una de las dos partes (vendedor = sub de Cavos; comprador = 'guest:<hash>' de la llave del dispositivo y/o su
// cuenta). Con un token ajeno o inventado la respuesta es 404, igual que si no existiera.
// Sin la migración: chat_* responde 503 'chat_unavailable' y GET ?chat=status dice { available:false } (la app oculta
// los botones). Nada más se rompe. Tiempo real: polling inteligente desde la app (ver docs/chat.md).
import { randomBytes } from 'node:crypto';
import { db } from './db';
import { HttpError } from './auth';
import type { BuyerIdentity } from './guest';
import { isMissingTable, notifyOrder, vapid, type PushDeps, type PushMsg } from './push';
import { canShowContact } from './contact';
import {
  blockLock, buyerLabel, chatPreview, CHAT_BLOCK_LOCKED, CHAT_MAX, CHAT_OPEN_PER_HOUR, CHAT_PRESENT_MS, CHAT_PUSH_COOLDOWN_MIN, CHAT_SEND_PER_MIN, CHAT_TYPING_MS,
  cleanChatText, isUnread, validChatToken, validClientId, type ChatRole,
} from './chatText';

export * from './chatText';

const CONV = 'chat_conversations', MSG = 'chat_messages', REP = 'chat_reports';
const CONV_COLS = 'id, token, seller_user_id, buyer_id, ctx, order_slug, item_slug, subject, item_photo, blocked_at, created_at, last_message_at, last_sender, last_preview, buyer_read_at, seller_read_at, buyer_seen_at, seller_seen_at, buyer_typing_at, seller_typing_at, buyer_pushed_at, seller_pushed_at';
const MSG_COLS = 'id, sender, body, client_id, created_at';
export const CHAT_PAGE = 60;
export const CHAT_LIST_MAX = 100;
export const REPORT_REASONS = ['spam', 'abuso', 'fraude', 'otro'] as const;

export const unavailable = () => Object.assign(new HttpError(503, 'El chat todavía no está disponible. Intenta más tarde.'), { code: 'chat_unavailable' });
const notFound = () => Object.assign(new HttpError(404, 'No encontramos esta conversación.'), { code: 'chat_not_found' });
const dbErr = (e: any): never => { if (isMissingTable(e)) throw unavailable(); throw e; };
export const newChatToken = () => randomBytes(24).toString('base64url');

/** ¿Existe la tabla? Se recuerda 60 s por instancia (la app lo pide con caché pública: GET ?chat=status). */
let avail: { v: boolean; at: number } | null = null;
export async function chatAvailable(now = Date.now()): Promise<boolean> {
  if (avail && now - avail.at < 60_000) return avail.v;
  let v = false;
  try { const { error } = await db().from(CONV).select('id').limit(1); v = !error; } catch { v = false; }
  avail = { v, at: now };
  return v;
}
export const __resetChat = () => { avail = null; hits.clear(); };

/** Límite por minuto/hora en memoria (por instancia) — además del límite en la base por conversación. */
const hits = new Map<string, number[]>();
export function chatRateLimited(key: string, max: number, windowMs = 60_000, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { hits.set(key, recent); return true; }
  recent.push(now); hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}
const tooFast = () => Object.assign(new HttpError(429, 'Vas muy rápido. Espera un momento antes de enviar otro mensaje.'), { code: 'chat_rate_limited' });

/** Rol de quien pide en esta conversación, o null si no es parte (-> 404). El vendedor siempre es una cuenta Cavos. */
export function roleIn(c: { seller_user_id: string; buyer_id: string }, who: Pick<BuyerIdentity, 'ids'>): ChatRole | null {
  if (who.ids.includes(c.seller_user_id)) return 'seller';
  if (who.ids.includes(c.buyer_id)) return 'buyer';
  return null;
}
const other = (r: ChatRole): ChatRole => (r === 'buyer' ? 'seller' : 'buyer');

async function convByToken(token: unknown): Promise<any> {
  if (!validChatToken(token)) throw notFound();
  const { data, error } = await db().from(CONV).select(CONV_COLS).eq('token', token).maybeSingle();
  if (error) dbErr(error);
  if (!data) throw notFound();
  return data;
}
/** Conversación + rol; 404 si quien pide no es parte (no se revela si el token existe). */
export async function requireParty(token: unknown, who: Pick<BuyerIdentity, 'ids'>): Promise<{ c: any; role: ChatRole }> {
  const c = await convByToken(token);
  const role = roleIn(c, who);
  if (!role) throw notFound();
  return { c, role };
}

const titleOf = (o: any) => `${o?.brand ?? ''} ${o?.model ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Artículo';

/** Abrir (o retomar) una conversación. Antes de comprar: con un vendedor (por su usuario) y opcionalmente un producto.
 *  Dentro de una compra: por el pedido; la abre el comprador de ese pedido o su vendedor. Devuelve { token, role }. */
export async function openChat(who: BuyerIdentity, b: { store_slug?: unknown; item_slug?: unknown; order_slug?: unknown }, ip: string | null = null): Promise<{ token: string; role: ChatRole }> {
  let seller: string, buyer: string, ctx: string, order_slug: string | null = null, item_slug: string | null = null, subject: string | null = null, item_photo: string | null = null;
  if (b.order_slug != null) {
    if (typeof b.order_slug !== 'string' || !/^[a-z0-9]{6}$/.test(b.order_slug)) throw new HttpError(400, 'Pedido inválido.');
    const { data: o, error } = await db().from('orders').select('slug, seller_user_id, buyer_user_id, brand, model, photos, status').eq('slug', b.order_slug).maybeSingle();
    if (error) throw error;
    // Solo las dos partes del pedido; para cualquier otro, "no existe".
    if (!o || !o.seller_user_id || !o.buyer_user_id || !(who.ids.includes(o.seller_user_id) || who.ids.includes(o.buyer_user_id))) throw notFound();
    if (o.seller_user_id === o.buyer_user_id) throw Object.assign(new HttpError(400, 'No puedes escribirte a ti mismo.'), { code: 'self_chat' });
    seller = o.seller_user_id; buyer = o.buyer_user_id; ctx = `order:${o.slug}`; order_slug = o.slug;
    subject = titleOf(o); item_photo = Array.isArray(o.photos) ? o.photos[0] ?? null : null;
  } else {
    const slug = String(b.store_slug ?? '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(slug)) throw new HttpError(400, 'Usuario inválido.');
    const { data: sp, error } = await db().from('seller_profiles').select('sub, store_slug').eq('store_slug', slug).maybeSingle();
    if (error) throw error;
    if (!sp) throw Object.assign(new HttpError(404, 'Este perfil no existe.'), { code: 'not_found' });
    if (who.ids.includes(sp.sub)) throw Object.assign(new HttpError(400, 'Es tu propia tienda.'), { code: 'self_chat' });
    seller = sp.sub; buyer = who.cavos?.sub ?? who.guest!; ctx = 'store';
    if (b.item_slug != null) {
      if (typeof b.item_slug !== 'string' || !/^[a-z0-9]{6}$/.test(b.item_slug)) throw new HttpError(400, 'Producto inválido.');
      const { data: it } = await db().from('orders').select('slug, seller_user_id, brand, model, photos').eq('slug', b.item_slug).maybeSingle();
      if (it && it.seller_user_id === seller) { item_slug = it.slug; subject = titleOf(it); item_photo = Array.isArray(it.photos) ? it.photos[0] ?? null : null; }
    }
  }
  const role: ChatRole = who.ids.includes(seller) ? 'seller' : 'buyer';
  const find = async () => {
    const q = db().from(CONV).select('id, token, item_slug').eq('buyer_id', buyer).eq('seller_user_id', seller).eq('ctx', ctx).limit(1);
    const { data, error } = await q;
    if (error) dbErr(error);
    return (data ?? [])[0] ?? null;
  };
  const found = await find();
  if (found) {
    // Retomar desde otro producto: el tema de la conversación pasa a ser ese producto.
    if (item_slug && found.item_slug !== item_slug) await db().from(CONV).update({ item_slug, subject, item_photo }).eq('id', found.id);
    return { token: found.token, role };
  }
  // Anti-spam: conversaciones nuevas por hora (identidad y, sin cuenta, IP).
  if (chatRateLimited(`o:${who.ids[0]}`, CHAT_OPEN_PER_HOUR, 3600e3) || (ip && !who.cavos && chatRateLimited(`oip:${ip}`, CHAT_OPEN_PER_HOUR * 2, 3600e3)))
    throw Object.assign(new HttpError(429, 'Abriste muchas conversaciones seguidas. Espera un rato e intenta de nuevo.'), { code: 'chat_rate_limited' });
  const row = { token: newChatToken(), seller_user_id: seller, buyer_id: buyer, ctx, order_slug, item_slug, subject, item_photo, created_at: new Date().toISOString() };
  const { error } = await db().from(CONV).insert(row);
  if (error?.code === '23505') { const again = await find(); if (again) return { token: again.token, role }; } // carrera: otra pestaña la creó
  if (error) dbErr(error);
  return { token: row.token, role };
}

export interface ChatMessageView { id: number; sender: ChatRole; body: string; client_id: string | null; created_at: string }
const view = (m: any): ChatMessageView => ({ id: Number(m.id), sender: m.sender, body: String(m.body ?? ''), client_id: m.client_id ?? null, created_at: m.created_at });

/** Nombre y foto de la otra parte (para la cabecera y la bandeja). El comprador nunca sale con datos personales. */
async function sellerCards(subs: string[]): Promise<Record<string, { name: string; store_slug: string | null; avatar_url: string | null }>> {
  if (!subs.length) return {};
  let { data, error } = await db().from('seller_profiles').select('sub, store_slug, display_name, avatar_url').in('sub', subs);
  if (error) ({ data } = await db().from('seller_profiles').select('sub, store_slug, display_name').in('sub', subs)); // sin 014
  return Object.fromEntries((data ?? []).map((r: any) => [r.sub, { name: r.display_name || r.store_slug || 'Vendedor', store_slug: r.store_slug ?? null, avatar_url: r.avatar_url ?? null }]));
}

/** Leer: la primera vez la cabecera + los últimos CHAT_PAGE mensajes; después (after=<id>) solo lo nuevo, para el polling.
 *  Marca como leído y "presente" (para no mandarle push mientras mira), con UNA escritura condicionada como máximo. */
export async function readChat(who: BuyerIdentity, b: { token?: unknown; after?: unknown; before?: unknown; typing?: unknown; full?: unknown }, now = Date.now()) {
  const { c, role } = await requireParty(b.token, who);
  const after = Number.isInteger(Number(b.after)) && Number(b.after) > 0 ? Number(b.after) : null;
  const before = Number.isInteger(Number(b.before)) && Number(b.before) > 0 ? Number(b.before) : null;
  let q = db().from(MSG).select(MSG_COLS).eq('conversation_id', c.id);
  if (after) q = q.gt('id', after).order('id', { ascending: true }).limit(100);
  else if (before) q = q.lt('id', before).order('id', { ascending: false }).limit(CHAT_PAGE);
  else q = q.order('id', { ascending: false }).limit(CHAT_PAGE);
  const { data, error } = await q;
  if (error) dbErr(error);
  const rows = (data ?? []).map(view);
  const messages = after ? rows : rows.reverse();
  // Una sola escritura: leído (si hay algo de la otra parte sin leer), presente (cada 15 s) y "escribiendo" (cada 3 s).
  const me = role, iso = new Date(now).toISOString(), patch: Record<string, string> = {};
  if (!before && isUnread(c, me)) patch[`${me}_read_at`] = iso;
  const seen = c[`${me}_seen_at`];
  if (!before && (!seen || now - Date.parse(seen) > 15_000)) patch[`${me}_seen_at`] = iso;
  const typed = c[`${me}_typing_at`];
  if (b.typing === true && (!typed || now - Date.parse(typed) > 3_000)) patch[`${me}_typing_at`] = iso;
  if (Object.keys(patch).length) { const { error: e2 } = await db().from(CONV).update(patch).eq('id', c.id); if (e2) console.warn('[chat] marca leído falló', e2.message); }
  const otherTyping = c[`${other(me)}_typing_at`];
  const lastOther = c.last_sender === other(me) ? c.last_message_at : null;
  const state = {
    role, blocked: !!c.blocked_at,
    other_read_at: c[`${other(me)}_read_at`] ?? null,
    other_typing: !!otherTyping && now - Date.parse(otherTyping) < CHAT_TYPING_MS && (!lastOther || Date.parse(otherTyping) > Date.parse(lastOther)),
    has_more: !after && rows.length === CHAT_PAGE,
  };
  if (b.full !== true) return { ...state, messages };
  // Vendedor: ¿puede bloquear? (la app oculta o deshabilita la opción; el servidor lo vuelve a comprobar en chat_block).
  let can_block = false;
  if (role === 'seller') { try { can_block = !(await pairLock(c)); } catch { can_block = true; } }
  // Cabecera: la otra parte, el tema (producto o pedido) y si ya se pagó (el aviso de "paga dentro" es solo antes de pagar).
  const cards = await sellerCards([c.seller_user_id]);
  const s = cards[c.seller_user_id];
  let order: { slug: string; status: string; price_crc: number | null } | null = null, item: { slug: string; price_crc: number | null } | null = null;
  const ref = c.order_slug ?? c.item_slug;
  if (ref) {
    const { data: o } = await db().from('orders').select('slug, status, price_crc').eq('slug', ref).maybeSingle();
    if (o && c.order_slug) order = { slug: o.slug, status: o.status, price_crc: o.price_crc == null ? null : Number(o.price_crc) };
    else if (o) item = { slug: o.slug, price_crc: o.price_crc == null ? null : Number(o.price_crc) };
  }
  return {
    ...state, messages, can_block,
    conversation: {
      token: c.token, kind: c.order_slug ? 'order' as const : 'store' as const, subject: c.subject ?? null, item_photo: c.item_photo ?? null, item, order,
      paid: !!order && canShowContact(order.status),
      other: role === 'buyer' ? { name: s?.name ?? 'Vendedor', store_slug: s?.store_slug ?? null, avatar_url: s?.avatar_url ?? null } : { name: buyerLabel(c.buyer_id), store_slug: null, avatar_url: null },
    },
  };
}

/** Enviar un mensaje (texto). Idempotente por client_id (reintento del envío optimista). Avisa por push a la otra parte
 *  si no tiene la conversación abierta, como mucho una vez cada CHAT_PUSH_COOLDOWN_MIN mientras no lea. */
export async function sendChat(who: BuyerIdentity, b: { token?: unknown; body?: unknown; client_id?: unknown }, o: { ip?: string | null; now?: number; push?: PushDeps } = {}) {
  const now = o.now ?? Date.now();
  const text = cleanChatText(b.body);
  if (text === 'empty') throw Object.assign(new HttpError(400, 'Escribe un mensaje.'), { code: 'chat_empty' });
  if (text === 'too_long') throw Object.assign(new HttpError(400, `El mensaje puede tener hasta ${CHAT_MAX} caracteres.`), { code: 'chat_too_long' });
  const client_id = validClientId(b.client_id) ? b.client_id : null;
  const { c, role } = await requireParty(b.token, who);
  if (c.blocked_at) throw Object.assign(new HttpError(403, role === 'seller' ? 'Bloqueaste esta conversación. Desbloquéala para escribir.' : 'No puedes enviar mensajes en esta conversación.'), { code: 'chat_blocked' });
  if (client_id) { // reintento del mismo mensaje: devolver el que ya quedó
    const { data: dup } = await db().from(MSG).select(MSG_COLS).eq('conversation_id', c.id).eq('client_id', client_id).limit(1);
    if (dup?.[0]) return { message: view(dup[0]) };
  }
  const sender = role === 'seller' ? c.seller_user_id : c.buyer_id;
  if (chatRateLimited(`s:${sender}`, CHAT_SEND_PER_MIN) || (o.ip && role === 'buyer' && !who.cavos && chatRateLimited(`sip:${o.ip}`, CHAT_SEND_PER_MIN * 2.5))) throw tooFast();
  // Límite también en la base (sirve entre instancias): mensajes de este lado en esta conversación en el último minuto.
  const since = new Date(now - 60_000).toISOString();
  const { data: recent, error: eR } = await db().from(MSG).select('id').eq('conversation_id', c.id).eq('sender', role).gt('created_at', since).limit(CHAT_SEND_PER_MIN + 1);
  if (eR) dbErr(eR);
  if ((recent ?? []).length >= CHAT_SEND_PER_MIN) throw tooFast();
  const iso = new Date(now).toISOString();
  const row = { conversation_id: c.id, sender: role, body: text, client_id, created_at: iso };
  const { data: ins, error } = await db().from(MSG).insert(row).select(MSG_COLS).single();
  if (error?.code === '23505' && client_id) { const { data: dup } = await db().from(MSG).select(MSG_COLS).eq('conversation_id', c.id).eq('client_id', client_id).limit(1); if (dup?.[0]) return { message: view(dup[0]) }; }
  if (error) dbErr(error);
  const message = view(ins ?? row);
  const to = other(role);
  const patch: Record<string, unknown> = { last_message_at: iso, last_sender: role, last_preview: chatPreview(text, 120), [`${role}_read_at`]: iso, [`${role}_seen_at`]: iso, [`${role}_typing_at`]: null };
  const pushNow = shouldPush(c, to, now);
  if (pushNow) patch[`${to}_pushed_at`] = iso;
  const { error: eU } = await db().from(CONV).update(patch).eq('id', c.id);
  if (eU) console.warn('[chat] cabecera falló', eU.message);
  if (pushNow) await notifyChat(c, role, text, o.push);
  return { message };
}

/** ¿Mandar push a `to`? No si está mirando la conversación; si no, la primera vez y luego como mucho cada N min mientras no lea. */
export function shouldPush(c: any, to: ChatRole, now = Date.now()): boolean {
  const seen = c[`${to}_seen_at`];
  if (seen && now - Date.parse(seen) < CHAT_PRESENT_MS) return false;
  const pushed = c[`${to}_pushed_at`], read = c[`${to}_read_at`];
  if (!pushed) return true;
  if (read && Date.parse(read) >= Date.parse(pushed)) return true; // leyó desde el último aviso
  return now - Date.parse(pushed) >= CHAT_PUSH_COOLDOWN_MIN * 60_000;
}

/** Textos del push de chat. Pura: se prueba sin red. */
export function chatPushMessage(c: { token: string; seller_user_id: string; buyer_id: string; subject?: string | null }, from: ChatRole, text: string, sellerName = 'El vendedor'): PushMsg {
  const to = from === 'buyer' ? c.seller_user_id : c.buyer_id;
  const name = String(sellerName).replace(/\s+/g, ' ').trim().slice(0, 40) || 'El vendedor';
  const title = from === 'buyer' ? (c.subject ? `Mensaje sobre ${String(c.subject).slice(0, 40)}` : 'Nuevo mensaje de un comprador') : `Mensaje de ${name}`;
  return { to, role: from === 'buyer' ? 'seller' : 'buyer', title, body: chatPreview(text, 110), url: `/chat?c=${c.token}&r=${from === 'buyer' ? 's' : 'b'}&src=push`, tag: `chat:${c.token.slice(0, 10)}` };
}
async function notifyChat(c: any, from: ChatRole, text: string, deps: PushDeps = {}) {
  try {
    if (!(deps.enabled ?? (() => !!vapid()))()) return 0;
    const name = from === 'seller' ? (await sellerCards([c.seller_user_id]))[c.seller_user_id]?.name : undefined;
    return await notifyOrder({ slug: c.order_slug ?? 'chat00', status: 'chat' }, deps, [chatPushMessage(c, from, text, name)]);
  } catch (e: any) { console.warn('[chat] push falló', e?.message); return 0; }
}

/** Bandeja de un lado. Vendedor: sus conversaciones (cuenta). Comprador: las de esta llave y/o cuenta. Con summary: solo el número. */
export async function listChats(who: Pick<BuyerIdentity, 'ids'>, as: ChatRole, sellerSub: string | null, summary = false) {
  const cols = summary ? 'last_message_at, last_sender, buyer_read_at, seller_read_at' : 'token, seller_user_id, buyer_id, ctx, order_slug, item_slug, subject, item_photo, blocked_at, created_at, last_message_at, last_sender, last_preview, buyer_read_at, seller_read_at';
  let q = db().from(CONV).select(cols);
  q = as === 'seller' ? q.eq('seller_user_id', sellerSub) : q.in('buyer_id', who.ids);
  const { data, error } = await q.order('last_message_at', { ascending: false, nullsFirst: false }).limit(CHAT_LIST_MAX);
  if (error) dbErr(error);
  // Conversaciones abiertas sin ningún mensaje no se listan (alguien tocó "Enviar mensaje" y no escribió).
  const rows = (data ?? []).filter((r: any) => r.last_message_at);
  const unread = rows.filter((r: any) => isUnread(r, as)).length;
  if (summary) return { unread, total: rows.length };
  const cards = as === 'buyer' ? await sellerCards([...new Set<string>(rows.map((r: any) => r.seller_user_id))]) : {};
  return {
    unread,
    conversations: rows.map((r: any) => ({
      token: r.token, role: as, kind: r.order_slug ? 'order' : 'store', order_slug: r.order_slug ?? null, subject: r.subject ?? null,
      photo: as === 'buyer' ? (cards[r.seller_user_id]?.avatar_url ?? null) : (r.item_photo ?? null),
      name: as === 'buyer' ? (cards[r.seller_user_id]?.name ?? 'Vendedor') : buyerLabel(r.buyer_id),
      last_preview: r.last_preview ?? '', last_sender: r.last_sender ?? null, last_message_at: r.last_message_at, unread: isUnread(r, as), blocked: !!r.blocked_at,
    })),
  };
}

/** ¿Hay una compra en curso o una disputa abierta entre ESTE comprador y ESTE vendedor (cualquier pedido del par, no solo el
 *  de esta conversación)? Mientras la haya, el vendedor no puede bloquear. El comprador abre su disputa desde el pedido
 *  (/api/escrow/dispute), que no depende del chat. */
export async function pairLock(c: { seller_user_id: string; buyer_id: string }): Promise<'dispute' | 'order' | null> {
  const { data, error } = await db().from('orders').select('id, status').eq('seller_user_id', c.seller_user_id).eq('buyer_user_id', c.buyer_id).limit(200);
  if (error) throw error;
  const orders: { id: string; status: string; dispute_state?: string | null }[] = (data ?? []) as any[];
  if (orders.length) { // estado de la disputa (005); sin la tabla basta el status del pedido
    const { data: ds } = await db().from('disputes').select('order_id, state').in('order_id', orders.map((o) => o.id));
    const st = new Map<string, string>((ds ?? []).map((d: any) => [String(d.order_id), String(d.state)]));
    orders.forEach((o) => { o.dispute_state = st.get(o.id) ?? null; });
  }
  return blockLock(orders);
}

/** El vendedor bloquea (o desbloquea) la conversación: nadie puede escribir mientras está bloqueada. No se puede bloquear
 *  con una compra en curso o una disputa abierta entre los dos (409 chat_block_locked); desbloquear siempre se puede. */
export async function blockChat(who: BuyerIdentity, b: { token?: unknown; blocked?: unknown }) {
  const { c, role } = await requireParty(b.token, who);
  if (role !== 'seller') throw Object.assign(new HttpError(403, 'Solo el vendedor puede bloquear la conversación.'), { code: 'not_seller' });
  const blocked = b.blocked !== false;
  if (blocked && !c.blocked_at) {
    const lock = await pairLock(c);
    if (lock) throw Object.assign(new HttpError(409, CHAT_BLOCK_LOCKED), { code: 'chat_block_locked', lock });
  }
  const { error } = await db().from(CONV).update({ blocked_at: blocked ? new Date().toISOString() : null }).eq('id', c.id);
  if (error) dbErr(error);
  return { blocked };
}

/** Reportar una conversación (cualquiera de las dos partes, una vez por lado). El equipo la revisa. */
export async function reportChat(who: BuyerIdentity, b: { token?: unknown; reason?: unknown; detail?: unknown }) {
  const { c, role } = await requireParty(b.token, who);
  const reason = (REPORT_REASONS as readonly string[]).includes(String(b.reason)) ? String(b.reason) : 'otro';
  const detail = typeof b.detail === 'string' ? chatPreview(b.detail, 280) || null : null;
  const { error } = await db().from(REP).insert({ conversation_id: c.id, reporter_role: role, reason, detail, created_at: new Date().toISOString() });
  if (error?.code === '23505') return { reported: true, already: true };
  if (error) dbErr(error);
  console.warn('[chat] reporte', { reason, role, conv: String(c.id).slice(0, 8) }); // sin texto ni identidades
  return { reported: true };
}
