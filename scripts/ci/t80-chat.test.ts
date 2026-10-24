// (80) Chat comprador-vendedor: abrir con la tienda/producto (antes de comprar) o por pedido (dentro de una compra), solo
//      las dos partes leen (token aleatorio + identidad en el servidor; token ajeno o inventado -> 404), texto ≤ 1000,
//      envío idempotente (client_id), límite por minuto, leído/escribiendo con una escritura como máximo, bloquear y
//      reportar, push a la otra parte con enfriamiento y sin molestar si está mirando, bandejas con no leídos, y sin la
//      migración 025 todo responde 503 chat_unavailable / available:false (la app oculta el chat). Sin red.
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { installTestJwks, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { guestSubFromReq } from '../../api/_lib/guest';
import {
  __resetChat, buyerLabel, chatPollDelay, chatPushMessage, chatRateLimited, CHAT_MAX, CHAT_SEND_PER_MIN, cleanChatText, isUnread, sendChat,
  sharesContact, shouldPush, validChatToken,
} from '../../api/_lib/chat';
import { fakeDb } from './fakedb';
import store from '../../api/store/index';
import dispute from '../../api/escrow/dispute';
import { __setChainForTests } from '../../api/_lib/escrow';
import { blockLock, CHAT_BLOCK_LOCKED } from '../../api/_lib/chatText';
import { COPY } from '../../lib/copy';

const KEY_A = 'a'.repeat(64), KEY_B = 'b'.repeat(64), KEY_C = 'c'.repeat(64);
const call = async (o: { method?: string; body?: any; query?: any; guest?: string; tok?: string; ip?: string }) => {
  const r: any = { code: 0, body: null, headers: {} as Record<string, string> }; r.status = (c: number) => { r.code = c; return r; }; r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r; }; r.send = (b: string) => { r.body = JSON.parse(b); return r; };
  await store({ method: o.method ?? 'POST', headers: { ...(o.guest ? { 'x-guest-key': o.guest } : {}), ...(o.tok ? { authorization: `Bearer ${o.tok}` } : {}), ...(o.ip ? { 'x-forwarded-for': o.ip } : {}) }, body: o.body ?? {}, query: o.query ?? {} }, r); return r;
};

export async function run(t: T) {
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  delete process.env.VAPID_PUBLIC_KEY; // sin push real en el API (el push se prueba aparte con deps)
  __resetChat();
  const db = fakeDb(); __setDbForTests(db as any);
  db.tables.seller_profiles = [{ sub: 'seller1', store_slug: 'valeria', display_name: 'Valeria', avatar_url: null }, { sub: 'seller2', store_slug: 'jose-games', display_name: 'José Games' }];
  const guestA = guestSubFromReq({ headers: { 'x-guest-key': KEY_A } })!;
  db.tables.orders = [
    { id: 'o1', slug: 'bici01', kind: 'listing', seller_user_id: 'seller1', buyer_user_id: null, brand: 'Bici', model: 'de montaña', photos: ['https://x/p.jpg'], status: 'creado', price_crc: 150000 },
    { id: 'o2', slug: 'compr1', kind: 'single', seller_user_id: 'seller1', buyer_user_id: guestA, brand: 'Bici', model: 'de montaña', photos: [], status: 'fondeado', price_crc: 150000 },
    { id: 'o3', slug: 'ajeno1', kind: 'single', seller_user_id: 'seller2', buyer_user_id: 'otro', brand: 'PS5', model: '', photos: [], status: 'fondeado', price_crc: 300000 },
  ];
  const tokSeller = await token({ sub: 'seller1' });

  // Sin la migración 025: estado false y cada acción -> 503 claro (la app oculta los botones).
  const realFrom = db.from;
  const missingQ: any = new Proxy({}, { get: (_o, k) => k === 'then' ? (res: any) => res({ data: null, error: { code: '42P01', message: 'relation "chat_conversations" does not exist' } }) : () => missingQ });
  (db as any).from = (t2: string) => (t2.startsWith('chat_') ? missingQ : realFrom(t2));
  let r = await call({ method: 'GET', query: { chat: 'status' } });
  t.check('sin 025: GET ?chat=status -> available:false (caché pública corta)', r.code === 200 && r.body?.available === false && /s-maxage=60/.test(r.headers['Cache-Control'] ?? ''), JSON.stringify(r.body));
  r = await call({ guest: KEY_A, body: { action: 'chat_open', store_slug: 'valeria' } });
  t.check('sin 025: chat_open -> 503 chat_unavailable', r.code === 503 && r.body?.code === 'chat_unavailable', `${r.code} ${JSON.stringify(r.body)}`);
  r = await call({ guest: KEY_A, body: { action: 'chat_list', as: 'buyer', summary: true } });
  t.check('sin 025: chat_list -> 503 chat_unavailable', r.code === 503 && r.body?.code === 'chat_unavailable', `${r.code}`);
  (db as any).from = realFrom; __resetChat();
  r = await call({ method: 'GET', query: { chat: 'status' } });
  t.check('con 025: available:true', r.code === 200 && r.body?.available === true);

  // Abrir antes de comprar (tienda + producto).
  r = await call({ body: { action: 'chat_open', store_slug: 'valeria' } });
  t.check('sin llave ni sesión -> 401', r.code === 401, `${r.code}`);
  r = await call({ guest: KEY_A, body: { action: 'chat_open', store_slug: 'no-existe' } });
  t.check('vendedor inexistente -> 404', r.code === 404, `${r.code}`);
  r = await call({ tok: tokSeller, body: { action: 'chat_open', store_slug: 'valeria' } });
  t.check('no puedes escribirle a tu propia tienda -> 400 self_chat', r.code === 400 && r.body?.code === 'self_chat', `${r.code}`);
  r = await call({ guest: KEY_A, body: { action: 'chat_open', store_slug: 'valeria', item_slug: 'bici01' } });
  const tk = r.body?.token;
  t.check('comprador sin cuenta abre con la llave: token de 32 aleatorio, rol buyer, tema = producto', r.code === 200 && validChatToken(tk) && r.body?.role === 'buyer'
    && db.tables.chat_conversations.length === 1 && db.tables.chat_conversations[0].buyer_id === guestA && db.tables.chat_conversations[0].subject === 'Bici de montaña'
    && !JSON.stringify(db.tables.chat_conversations).includes(KEY_A), JSON.stringify(r.body));
  r = await call({ guest: KEY_A, body: { action: 'chat_open', store_slug: 'valeria' } });
  t.check('abrir otra vez retoma la misma conversación (una por comprador, vendedor y contexto)', r.body?.token === tk && db.tables.chat_conversations.length === 1);
  r = await call({ guest: KEY_A, body: { action: 'chat_open', store_slug: 'valeria', item_slug: 'ajeno1' } });
  t.check('producto de otro vendedor no cambia el tema', r.body?.token === tk && db.tables.chat_conversations[0].item_slug === 'bici01');

  // Privacidad: solo las dos partes.
  r = await call({ guest: KEY_B, body: { action: 'chat_get', token: tk } });
  t.check('otra llave con el token -> 404 (como si no existiera)', r.code === 404 && r.body?.code === 'chat_not_found' && !JSON.stringify(r.body).includes('Bici'), `${r.code}`);
  r = await call({ guest: KEY_A, body: { action: 'chat_get', token: 'A'.repeat(32) } });
  t.check('token inventado -> 404', r.code === 404, `${r.code}`);
  r = await call({ guest: KEY_A, body: { action: 'chat_get', token: '1' } });
  t.check('token mal formado -> 404 (sin consultar)', r.code === 404, `${r.code}`);
  r = await call({ tok: await token({ sub: 'seller2' }), body: { action: 'chat_get', token: tk } });
  t.check('otro vendedor con el token -> 404', r.code === 404, `${r.code}`);

  // Enviar.
  r = await call({ guest: KEY_A, body: { action: 'chat_send', token: tk, body: '   ', client_id: 'cli00001' } });
  t.check('mensaje vacío -> 400', r.code === 400 && r.body?.code === 'chat_empty', `${r.code}`);
  r = await call({ guest: KEY_A, body: { action: 'chat_send', token: tk, body: 'x'.repeat(CHAT_MAX + 1), client_id: 'cli00002' } });
  t.check(`más de ${CHAT_MAX} caracteres -> 400`, r.code === 400 && r.body?.code === 'chat_too_long', `${r.code}`);
  r = await call({ guest: KEY_A, body: { action: 'chat_send', token: tk, body: '¿Sigue disponible?', client_id: 'cli00003' } });
  const m1 = r.body?.message;
  t.check('comprador envía: mensaje con id, rol buyer, hora', r.code === 200 && m1?.sender === 'buyer' && m1?.body === '¿Sigue disponible?' && typeof m1?.id === 'number' && !!m1?.created_at, JSON.stringify(r.body));
  r = await call({ guest: KEY_A, body: { action: 'chat_send', token: tk, body: '¿Sigue disponible?', client_id: 'cli00003' } });
  t.check('reintento con el mismo client_id no duplica (envío optimista idempotente)', r.code === 200 && r.body?.message?.id === m1?.id && db.tables.chat_messages.length === 1);
  r = await call({ guest: KEY_B, body: { action: 'chat_send', token: tk, body: 'hola', client_id: 'cli00004' } });
  t.check('otra llave no puede escribir -> 404', r.code === 404 && db.tables.chat_messages.length === 1, `${r.code}`);

  // Bandejas.
  r = await call({ tok: tokSeller, body: { action: 'chat_list', as: 'seller' } });
  const sc = r.body?.conversations?.[0];
  t.check('bandeja del vendedor: 1 sin leer, etiqueta de comprador sin datos personales, vista previa', r.code === 200 && r.body?.unread === 1 && sc?.unread === true && /^Comprador · [0-9A-F]{4}$/.test(sc?.name)
    && sc?.last_preview === '¿Sigue disponible?' && sc?.token === tk && !JSON.stringify(r.body).includes(guestA), JSON.stringify(r.body));
  r = await call({ guest: KEY_A, body: { action: 'chat_list', as: 'seller' } });
  t.check('bandeja de vendedor sin sesión -> 401', r.code === 401, `${r.code}`);
  r = await call({ tok: tokSeller, body: { action: 'chat_list', as: 'seller', summary: true } });
  t.check('insignia (summary): solo los números (sin leer y total)', r.code === 200 && JSON.stringify(r.body) === '{"unread":1,"total":1}', JSON.stringify(r.body));
  r = await call({ guest: KEY_A, body: { action: 'chat_list', as: 'buyer' } });
  t.check('bandeja del comprador: nombre de la tienda, nada sin leer (el último es suyo)', r.code === 200 && r.body?.unread === 0 && r.body?.conversations?.[0]?.name === 'Valeria', JSON.stringify(r.body));
  r = await call({ guest: KEY_C, body: { action: 'chat_list', as: 'buyer' } });
  t.check('otra llave: bandeja vacía', r.code === 200 && r.body?.conversations?.length === 0);

  // Leer: el vendedor lo abre -> leído; el comprador ve "leído" y la cabecera.
  r = await call({ tok: tokSeller, body: { action: 'chat_get', token: tk, full: true } });
  t.check('vendedor lee: rol seller, mensajes, cabecera con el comprador anónimo y el producto', r.code === 200 && r.body?.role === 'seller' && r.body?.messages?.length === 1
    && /^Comprador · /.test(r.body?.conversation?.other?.name) && r.body?.conversation?.item?.slug === 'bici01' && r.body?.conversation?.paid === false, JSON.stringify(r.body).slice(0, 300));
  t.check('al leer se marca leído (seller_read_at) y presente', !!db.tables.chat_conversations[0].seller_read_at && !!db.tables.chat_conversations[0].seller_seen_at);
  r = await call({ guest: KEY_A, body: { action: 'chat_get', token: tk, after: m1.id, typing: true } });
  t.check('polling (after): solo lo nuevo, other_read_at para el doble check', r.code === 200 && r.body?.messages?.length === 0 && !!r.body?.other_read_at && r.body?.conversation === undefined, JSON.stringify(r.body));
  r = await call({ tok: tokSeller, body: { action: 'chat_get', token: tk, after: m1.id } });
  t.check('"escribiendo…" del comprador visible para el vendedor', r.body?.other_typing === true, JSON.stringify(r.body));
  r = await call({ tok: tokSeller, body: { action: 'chat_send', token: tk, body: 'Sí, sigue disponible.', client_id: 'sel00001' } });
  t.check('vendedor responde', r.code === 200 && r.body?.message?.sender === 'seller', JSON.stringify(r.body));
  r = await call({ guest: KEY_A, body: { action: 'chat_list', as: 'buyer', summary: true } });
  t.check('comprador: 1 sin leer', r.body?.unread === 1, JSON.stringify(r.body));
  const writes = { n: 0 }; const f0 = db.from; (db as any).from = (t2: string) => { const q = f0(t2); if (t2 === 'chat_conversations') { const u0 = q.update; q.update = (p: any) => { writes.n++; return u0(p); }; } return q; };
  await call({ guest: KEY_A, body: { action: 'chat_get', token: tk } });
  await call({ guest: KEY_A, body: { action: 'chat_get', token: tk, after: 99 } });
  (db as any).from = f0;
  t.check('polling sin novedades: como mucho 1 escritura (leído + presente) y luego 0', writes.n === 1, `${writes.n}`);

  // Dentro de una compra (por pedido).
  r = await call({ guest: KEY_A, body: { action: 'chat_open', order_slug: 'compr1' } });
  const tkO = r.body?.token;
  t.check('comprador del pedido abre el chat del pedido (otra conversación)', r.code === 200 && validChatToken(tkO) && tkO !== tk && r.body?.role === 'buyer');
  r = await call({ tok: tokSeller, body: { action: 'chat_open', order_slug: 'compr1' } });
  t.check('el vendedor del pedido llega a la MISMA conversación', r.code === 200 && r.body?.token === tkO && r.body?.role === 'seller');
  r = await call({ guest: KEY_B, body: { action: 'chat_open', order_slug: 'compr1' } });
  t.check('alguien que no es parte del pedido -> 404', r.code === 404, `${r.code}`);
  r = await call({ guest: KEY_A, body: { action: 'chat_open', order_slug: 'ajeno1' } });
  t.check('pedido ajeno -> 404', r.code === 404, `${r.code}`);
  r = await call({ guest: KEY_A, body: { action: 'chat_get', token: tkO, full: true } });
  t.check('cabecera del pedido: kind order, pagado (sin aviso de "paga dentro")', r.body?.conversation?.kind === 'order' && r.body?.conversation?.paid === true && r.body?.conversation?.order?.status === 'fondeado', JSON.stringify(r.body?.conversation));

  // Bloquear: no con una compra en curso o una disputa abierta entre los dos (cualquier pedido del par, aquí compr1 fondeado).
  const conv0 = () => db.tables.chat_conversations.find((c: any) => c.token === tk);
  const o2 = db.tables.orders.find((o: any) => o.slug === 'compr1');
  r = await call({ guest: KEY_A, body: { action: 'chat_block', token: tk, blocked: true } });
  t.check('el comprador no puede bloquear -> 403', r.code === 403 && r.body?.code === 'not_seller', `${r.code}`);
  r = await call({ tok: tokSeller, body: { action: 'chat_get', token: tk, full: true } });
  t.check('compra en curso (fondeado): la cabecera dice can_block:false al vendedor', r.code === 200 && r.body?.can_block === false, JSON.stringify(r.body?.can_block));
  r = await call({ tok: tokSeller, body: { action: 'chat_block', token: tk, blocked: true } });
  t.check('compra en curso: el servidor rechaza el bloqueo (409 chat_block_locked, texto de COPY.chat.blockLocked)', r.code === 409 && r.body?.code === 'chat_block_locked'
    && r.body?.error === CHAT_BLOCK_LOCKED && CHAT_BLOCK_LOCKED === COPY.chat.blockLocked && !conv0().blocked_at, `${r.code} ${JSON.stringify(r.body)}`);
  t.check('regla pura: disputa abierta / compra en curso / solo pedidos terminados', blockLock([{ status: 'liberado' }, { status: 'en_disputa' }]) === 'dispute'
    && blockLock([{ status: 'liberado', dispute_state: 'open' }]) === 'dispute' && blockLock([{ status: 'enviado' }]) === 'order' && blockLock([{ status: 'creado' }]) === 'order'
    && blockLock([{ status: 'liberado' }, { status: 'resuelto' }, { status: 'cancelado' }]) === null && blockLock([]) === null);
  o2.status = 'liberado'; // la compra terminó
  r = await call({ tok: tokSeller, body: { action: 'chat_get', token: tk, full: true } });
  t.check('compra terminada: can_block:true', r.body?.can_block === true, JSON.stringify(r.body?.can_block));
  r = await call({ guest: KEY_A, body: { action: 'chat_get', token: tk, full: true } });
  t.check('el comprador nunca recibe can_block:true', r.body?.can_block === false, JSON.stringify(r.body?.can_block));
  r = await call({ tok: tokSeller, body: { action: 'chat_block', token: tk, blocked: true } });
  t.check('sin compra en curso ni disputa: el vendedor bloquea', r.code === 200 && r.body?.blocked === true && !!conv0().blocked_at);
  r = await call({ guest: KEY_A, body: { action: 'chat_send', token: tk, body: 'hola?', client_id: 'cli00005' } });
  t.check('bloqueada: el comprador no puede escribir -> 403 chat_blocked', r.code === 403 && r.body?.code === 'chat_blocked', `${r.code}`);

  // Con la conversación bloqueada, el comprador SIEMPRE puede abrir la disputa de su compra: el flujo no pasa por el chat.
  o2.status = 'entregado'; o2.contract_id = 'CNOTUSED'; o2.released_tx = null;
  __setChainForTests({ releaseGuard: async () => ({ disputed: true, released: false, resolved: false }) as any });
  const dr: any = { code: 0, body: null }; dr.status = (c: number) => { dr.code = c; return dr; }; dr.setHeader = () => dr; dr.send = (b: string) => { dr.body = JSON.parse(b); return dr; };
  try { await dispute({ method: 'POST', headers: { 'x-guest-key': KEY_A }, body: { slug: 'compr1', reason: 'no_llego' } }, dr); } finally { __setChainForTests(null); }
  t.check('chat bloqueado: el comprador sin cuenta abre su disputa igual (200, pedido en_disputa, disputa open)', dr.code === 200 && o2.status === 'en_disputa'
    && db.tables.disputes.some((d: any) => d.order_id === 'o2' && d.state === 'open') && !!conv0().blocked_at, `${dr.code} ${JSON.stringify(dr.body)} ${o2.status}`);
  const disputeSrc = readFileSync(new URL('../../api/escrow/dispute.ts', import.meta.url), 'utf8') + readFileSync(new URL('../../components/DisputeSheet.tsx', import.meta.url), 'utf8');
  const pay = readFileSync(new URL('../../components/PayBox.tsx', import.meta.url), 'utf8');
  t.check('la disputa no depende del chat (API, hoja y botón "Tengo un problema" sin chat ni bloqueo)', !/chat|blocked/i.test(disputeSrc.replace(/chatbubble-ellipses-outline/g, ''))
    && /const canDispute = buyerHere && \['fondeado', 'enviado', 'entregado'\]\.includes\(order\.status\) && !order\.released_tx;/.test(pay));
  r = await call({ tok: tokSeller, body: { action: 'chat_block', token: tk, blocked: false } });
  t.check('desbloquear siempre se puede (también con disputa abierta)', r.code === 200 && r.body?.blocked === false && conv0().blocked_at === null);
  r = await call({ tok: tokSeller, body: { action: 'chat_block', token: tk, blocked: true } });
  t.check('disputa abierta: no se puede volver a bloquear (409)', r.code === 409 && r.body?.code === 'chat_block_locked' && conv0().blocked_at === null, `${r.code}`);
  r = await call({ tok: tokSeller, body: { action: 'chat_get', token: tkO, full: true } });
  t.check('disputa abierta: tampoco en la conversación de la compra (can_block:false)', r.body?.can_block === false, JSON.stringify(r.body?.can_block));

  // Reportar: la otra parte no recibe aviso ni ve ningún cambio (ni push, ni bloqueo, ni campo nuevo en su vista).
  const before = JSON.stringify(conv0());
  const sellerView0 = (await call({ tok: tokSeller, body: { action: 'chat_get', token: tk } })).body;
  r = await call({ guest: KEY_A, body: { action: 'chat_report', token: tk, reason: 'spam', detail: 'Me manda links raros' } });
  t.check('reportar: queda registrado (motivo + detalle corto)', r.code === 200 && r.body?.reported === true && db.tables.chat_reports.length === 1 && db.tables.chat_reports[0].reason === 'spam' && db.tables.chat_reports[0].reporter_role === 'buyer');
  const sellerView1 = (await call({ tok: tokSeller, body: { action: 'chat_get', token: tk } })).body;
  const strip = (v: any) => JSON.stringify({ ...v, other_read_at: null });
  t.check('reportar no cambia la conversación ni lo que ve la otra parte (sin aviso, sin bloqueo)', JSON.stringify(conv0()).replace(/"seller_(read|seen)_at":"[^"]*"/g, '') === before.replace(/"seller_(read|seen)_at":"[^"]*"/g, '')
    && strip(sellerView0) === strip(sellerView1) && sellerView1?.blocked === false && !('reported' in (sellerView1 ?? {})), `${before} | ${JSON.stringify(conv0())}`);
  const chatSrc = readFileSync(new URL('../../api/_lib/chat.ts', import.meta.url), 'utf8');
  const repFn = chatSrc.slice(chatSrc.indexOf('export async function reportChat'));
  t.check('reportChat solo inserta en chat_reports (sin push ni cambios en la conversación)', !/notify|push|update\(|blocked_at/.test(repFn) && /from\(REP\)\.insert/.test(repFn));
  r = await call({ guest: KEY_A, body: { action: 'chat_report', token: tk, reason: 'spam' } });
  t.check('reportar dos veces no duplica', r.code === 200 && r.body?.already === true && db.tables.chat_reports.length === 1);
  r = await call({ guest: KEY_B, body: { action: 'chat_report', token: tk, reason: 'spam' } });
  t.check('reportar una conversación ajena -> 404', r.code === 404, `${r.code}`);

  // Límite por minuto (en memoria y en la base).
  __resetChat();
  let last: any = null;
  for (let i = 0; i <= CHAT_SEND_PER_MIN; i++) last = await call({ guest: KEY_A, body: { action: 'chat_send', token: tkO, body: `m${i}`, client_id: `burst${String(i).padStart(4, '0')}` } });
  t.check(`ráfaga: ${CHAT_SEND_PER_MIN} por minuto, el siguiente -> 429 chat_rate_limited`, last.code === 429 && last.body?.code === 'chat_rate_limited', `${last.code}`);
  t.check('límite en memoria se libera al minuto', (() => { __resetChat(); for (let i = 0; i < 3; i++) chatRateLimited('z', 3, 60_000, 1000); return chatRateLimited('z', 3, 60_000, 1000) && !chatRateLimited('z', 3, 60_000, 62_000); })());
  __resetChat();
  r = await call({ guest: KEY_A, body: { action: 'chat_send', token: tkO, body: 'otro', client_id: 'after0001' } });
  t.check('límite en la base (entre instancias): sigue en 429 aunque la memoria se reinicie', r.code === 429, `${r.code}`);

  // Push: a la otra parte, no si está mirando, con enfriamiento mientras no lea.
  const now = Date.parse('2026-10-24T12:00:00Z');
  const c0: any = { token: 'T'.repeat(32), seller_user_id: 'seller1', buyer_id: guestA, subject: 'Bici de montaña' };
  t.check('push: primera vez sí', shouldPush({ ...c0 }, 'seller', now));
  t.check('push: no si la otra parte tiene el chat abierto (visto hace < 25 s)', !shouldPush({ ...c0, seller_seen_at: new Date(now - 10_000).toISOString() }, 'seller', now));
  t.check('push: enfriamiento de 10 min mientras no lea', !shouldPush({ ...c0, seller_pushed_at: new Date(now - 60_000).toISOString() }, 'seller', now)
    && shouldPush({ ...c0, seller_pushed_at: new Date(now - 11 * 60_000).toISOString() }, 'seller', now));
  t.check('push: si leyó desde el último aviso, el siguiente mensaje avisa', shouldPush({ ...c0, seller_pushed_at: new Date(now - 60_000).toISOString(), seller_read_at: new Date(now - 30_000).toISOString() }, 'seller', now));
  const pm = chatPushMessage(c0, 'buyer', '¿Sigue disponible?');
  const pb = chatPushMessage(c0, 'seller', 'Sí, sigue', 'Valeria');
  t.check('push: textos en tuteo, link al chat (token en el query, rol), agrupa por conversación',
    pm.to === 'seller1' && pm.title === 'Mensaje sobre Bici de montaña' && pm.body === '¿Sigue disponible?' && pm.url === `/chat?c=${c0.token}&r=s&src=push` && pm.tag.startsWith('chat:')
    && pb.to === guestA && pb.title === 'Mensaje de Valeria' && pb.url.endsWith('&r=b&src=push'), JSON.stringify([pm, pb]));
  // Envío real con deps de push: se manda una vez y la segunda (sin leer) no.
  __resetChat();
  db.tables.chat_messages = []; const conv = db.tables.chat_conversations.find((c: any) => c.token === tk); conv.seller_seen_at = null; conv.seller_pushed_at = null; conv.seller_read_at = null;
  const sent: string[] = [];
  const deps = { enabled: () => true, load: async (ids: string[]) => ids.map((id) => ({ endpoint: `https://push/${id}`, user_id: id, p256dh: 'p', auth: 'a' })), send: async (s: any) => { sent.push(s.user_id); return 201; } };
  const who = { ids: [guestA], guest: guestA, cavos: null };
  await sendChat(who, { token: tk, body: 'Hola', client_id: 'push0001' }, { push: deps, now });
  await sendChat(who, { token: tk, body: '¿Sigue?', client_id: 'push0002' }, { push: deps, now: now + 5_000 });
  t.check('push al vendedor: 1 aviso por 2 mensajes seguidos sin leer', sent.length === 1 && sent[0] === 'seller1', JSON.stringify(sent));

  // Reglas puras.
  t.check('texto: limpia controles y líneas vacías de más', cleanChatText('  hola\u0000\n\n\n\nmundo \u200B ') === 'hola\n\nmundo' && cleanChatText(5) === 'empty');
  t.check('aviso de contacto: teléfono, link o correo (no precios)', sharesContact('mi número es 8888 1234') && sharesContact('+506 8888-1234') && sharesContact('mira www.otro.com') && sharesContact('wa.me/50688881234')
    && sharesContact('escríbeme a ana@correo.com') && !sharesContact('¿Precio final? ₡150 000') && !sharesContact('¿Sigue disponible?'));
  t.check('etiqueta de comprador estable y anónima', buyerLabel(guestA) === buyerLabel(guestA) && buyerLabel(guestA) !== buyerLabel('otro') && !buyerLabel(guestA).includes(guestA.slice(6, 12)));
  t.check('no leído: solo si el último es de la otra parte y llegó después de leer', isUnread({ last_message_at: '2026-10-24T10:00:00Z', last_sender: 'buyer', seller_read_at: null }, 'seller')
    && !isUnread({ last_message_at: '2026-10-24T10:00:00Z', last_sender: 'buyer', seller_read_at: '2026-10-24T10:00:01Z' }, 'seller') && !isUnread({ last_message_at: '2026-10-24T10:00:00Z', last_sender: 'seller' }, 'seller'));
  t.check('polling inteligente: 2,5 s activo, más lento sin actividad, nada con la pestaña oculta', chatPollDelay({ visible: true, idleMs: 0 }) === 2500 && chatPollDelay({ visible: true, idleMs: 60_000 }) === 6000
    && chatPollDelay({ visible: true, idleMs: 600_000 }) === 15_000 && chatPollDelay({ visible: false, idleMs: 0 }) === null);

  // Migración y funciones de Vercel.
  const mig = readFileSync(new URL('../../supabase/migrations/025_chat.sql', import.meta.url), 'utf8');
  t.check('migración 025 idempotente, índices, RLS sin grants públicos, notify pgrst, retención 12 meses', /create table if not exists public\.chat_conversations/.test(mig) && /create table if not exists public\.chat_messages/.test(mig)
    && /create unique index if not exists chat_conversations_pair_uidx/.test(mig) && (mig.match(/enable row level security/g) ?? []).length === 3
    && /revoke all on public\.chat_messages from anon, authenticated/.test(mig) && !/grant (select|insert|all)/i.test(mig) && /notify pgrst/.test(mig) && /interval '12 months'/.test(mig) && /char_length\(body\) between 1 and 1000/.test(mig));
  const m26 = readFileSync(new URL('../../supabase/migrations/026_chat_retention_dispute.sql', import.meta.url), 'utf8');
  const sql26 = m26.replace(/--[^\n]*/g, '');
  t.check('migración 026: idempotente (solo create or replace de chat_purge_old), pausa con disputa abierta y cuenta desde la resolución', /create or replace function public\.chat_purge_old\(\) returns bigint/.test(sql26)
    && !/create table|alter table|drop |cron\.schedule|cron\.unschedule/i.test(sql26) && /order_status = 'en_disputa' or dispute_state in \('pending', 'open'\)/.test(sql26)
    && /not coalesce\(conv\.dispute_open, false\)/.test(sql26) && /greatest\(max\(last_at\), max\(resolved_at\)\)/.test(sql26) && /interval '12 months'/.test(sql26)
    && /c\.order_slug is not null and o\.slug = c\.order_slug/.test(sql26) && /c\.order_slug is null and o\.buyer_user_id = c\.buyer_id and o\.seller_user_id = c\.seller_user_id/.test(sql26)
    && /revoke all on function public\.chat_purge_old\(\) from public, anon, authenticated/.test(sql26));
  const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  t.check('sin función nueva: el chat vive en /api/store', !JSON.stringify(vercel).includes('/api/chat') && /chat_send/.test(readFileSync(new URL('../../api/store/index.ts', import.meta.url), 'utf8')));
}
