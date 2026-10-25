// (90) Chat con el producto, estilo Messenger: en /p/<slug> siempre hay "Preguntar al vendedor" (también sin cuenta, con
//      la llave; nunca para el dueño), la conversación lleva la tarjeta del producto (foto, título, precio, tocar abre el
//      producto) pegada al primer mensaje, la bandeja del vendedor muestra de qué producto vino la pregunta, y si ya había
//      conversación con esa tienda se reutiliza con una tarjeta nueva para el producto nuevo. Columna nueva
//      chat_messages.item_slug (migración 030); sin ella el chat sigue igual (la tarjeta fija de arriba). Sin red.
import type { T } from './setup';
import { existsSync, readFileSync } from 'node:fs';
import { installTestJwks, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { guestSubFromReq } from '../../api/_lib/guest';
import { __resetChat } from '../../api/_lib/chat';
import { CHAT_BUYER_PER_HOUR, CHAT_OPEN_PER_HOUR, CHAT_SEND_PER_MIN } from '../../api/_lib/chatText';
import { COPY } from '../../lib/copy';
import { fakeDb } from './fakedb';
import store from '../../api/store/index';
import { itemCardRows } from '../../api/_lib/chatText';
import { BANNED_COPY } from '../../lib/copy';

const KEY_A = 'a'.repeat(64), KEY_B = 'b'.repeat(64);
const call = async (o: { body?: any; guest?: string; tok?: string }) => {
  const r: any = { code: 0, body: null, headers: {} as Record<string, string> }; r.status = (c: number) => { r.code = c; return r; }; r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r; }; r.send = (b: string) => { r.body = JSON.parse(b); return r; };
  await store({ method: 'POST', headers: { ...(o.guest ? { 'x-guest-key': o.guest } : {}), ...(o.tok ? { authorization: `Bearer ${o.tok}` } : {}) }, body: o.body ?? {}, query: {} }, r); return r;
};
const read = (f: string) => readFileSync(f, 'utf8');

export async function run(t: T) {
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  delete process.env.VAPID_PUBLIC_KEY;
  const setup = () => {
    __resetChat();
    const db = fakeDb(); __setDbForTests(db as any);
    db.tables.seller_profiles = [{ sub: 'seller1', store_slug: 'valeria', display_name: 'Valeria', avatar_url: null }];
    db.tables.orders = [
      { id: 'o1', slug: 'bici01', kind: 'listing', seller_user_id: 'seller1', buyer_user_id: null, brand: 'Bici', model: 'de montaña', photos: ['https://x/bici.jpg'], status: 'creado', price_crc: 150000 },
      { id: 'o2', slug: 'silla1', kind: 'listing', seller_user_id: 'seller1', buyer_user_id: null, brand: 'Silla', model: 'gamer', photos: ['https://x/silla.jpg'], status: 'creado', price_crc: 90000 },
      { id: 'o3', slug: 'sinper', kind: 'listing', seller_user_id: 'seller9', buyer_user_id: null, brand: 'Mesa', model: '', photos: [], status: 'creado', price_crc: 20000 },
    ];
    return db;
  };
  const tokSeller = await token({ sub: 'seller1' });

  /* ---------- Con la migración 030 ---------- */
  let db = setup();
  // Abrir solo con el producto (la ficha no espera a que cargue el perfil de la tienda).
  let r = await call({ guest: KEY_A, body: { action: 'chat_open', item_slug: 'bici01' } });
  const tk = r.body?.token;
  t.check('chat_open solo con item_slug: la tienda sale del producto, rol buyer, tema = producto', r.code === 200 && r.body?.role === 'buyer'
    && db.tables.chat_conversations?.[0]?.seller_user_id === 'seller1' && db.tables.chat_conversations[0].item_slug === 'bici01' && db.tables.chat_conversations[0].subject === 'Bici de montaña', `${r.code} ${JSON.stringify(r.body)}`);
  r = await call({ guest: KEY_A, body: { action: 'chat_open', item_slug: 'sinper' } });
  t.check('producto de un vendedor sin tienda también abre (sin perfil)', r.code === 200 && r.body?.role === 'buyer', `${r.code} ${JSON.stringify(r.body)}`);
  r = await call({ guest: KEY_A, body: { action: 'chat_open', item_slug: 'nada00' } });
  t.check('producto inexistente -> 404', r.code === 404, `${r.code}`);
  r = await call({ guest: KEY_A, body: { action: 'chat_open', item_slug: '../x' } });
  t.check('item_slug mal formado -> 400', r.code === 400, `${r.code}`);
  r = await call({ tok: tokSeller, body: { action: 'chat_open', item_slug: 'bici01' } });
  t.check('el dueño no puede escribirse por su producto -> 400 self_chat', r.code === 400 && r.body?.code === 'self_chat', `${r.code}`);

  // Primer mensaje desde el producto: lleva la tarjeta (item_slug); el segundo ya no.
  r = await call({ guest: KEY_A, body: { action: 'chat_send', token: tk, body: '¿Sigue disponible?', client_id: 'cli_00000001', item_slug: 'bici01' } });
  t.check('primer mensaje desde el producto -> item_slug guardado', r.code === 200 && r.body?.message?.item_slug === 'bici01' && db.tables.chat_messages.at(-1).item_slug === 'bici01', JSON.stringify(r.body));
  r = await call({ guest: KEY_A, body: { action: 'chat_send', token: tk, body: '¿Haces envíos?', client_id: 'cli_00000002', item_slug: 'bici01' } });
  t.check('segundo mensaje del mismo producto -> sin tarjeta repetida', r.code === 200 && (r.body?.message?.item_slug ?? null) === null, JSON.stringify(r.body));
  r = await call({ guest: KEY_A, body: { action: 'chat_send', token: tk, body: 'otra', client_id: 'cli_00000003', item_slug: 'silla1' } });
  t.check('item_slug distinto al tema de la conversación -> ignorado (solo el producto con el que se abrió)', r.code === 200 && (r.body?.message?.item_slug ?? null) === null);
  r = await call({ guest: KEY_A, body: { action: 'chat_send', token: tk, body: '¿Sigue disponible?', client_id: 'cli_00000001', item_slug: 'bici01' } });
  t.check('reintento del primer mensaje (mismo client_id) devuelve el mismo, con su tarjeta', r.body?.message?.item_slug === 'bici01' && db.tables.chat_messages.length === 3);
  r = await call({ tok: tokSeller, body: { action: 'chat_send', token: tk, body: 'Sí, sigue', client_id: 'cli_00000004', item_slug: 'bici01' } });
  t.check('el vendedor no agrega tarjetas', r.code === 200 && (r.body?.message?.item_slug ?? null) === null);

  // Leer: mensajes con item_slug + datos públicos del producto (foto, título, precio).
  r = await call({ guest: KEY_A, body: { action: 'chat_get', token: tk, full: true } });
  const p1 = r.body?.products?.bici01;
  t.check('chat_get full: products con título, foto y precio del producto de la tarjeta', r.code === 200 && p1?.title === 'Bici de montaña' && p1?.photo === 'https://x/bici.jpg' && p1?.price_crc === 150000
    && r.body.messages[0].item_slug === 'bici01', JSON.stringify(r.body?.products));
  t.check('products solo con datos públicos (sin vendedor, comprador ni ids)', !/seller1|o1|guest:/.test(JSON.stringify(r.body?.products ?? {})));
  const lastId = Math.max(...r.body.messages.map((m: any) => m.id));

  // Misma tienda, otro producto: se reutiliza la conversación y entra una tarjeta nueva.
  r = await call({ guest: KEY_A, body: { action: 'chat_open', store_slug: 'valeria', item_slug: 'silla1' } });
  t.check('otro producto de la misma tienda -> misma conversación, tema = el producto nuevo', r.body?.token === tk && db.tables.chat_conversations.filter((c: any) => c.ctx === 'store' && c.seller_user_id === 'seller1').length === 1
    && db.tables.chat_conversations[0].item_slug === 'silla1' && db.tables.chat_conversations[0].item_photo === 'https://x/silla.jpg');
  r = await call({ guest: KEY_A, body: { action: 'chat_send', token: tk, body: '¿Y la silla?', client_id: 'cli_00000005', item_slug: 'silla1' } });
  t.check('primer mensaje por el producto nuevo -> tarjeta nueva', r.body?.message?.item_slug === 'silla1');
  r = await call({ tok: tokSeller, body: { action: 'chat_get', token: tk, after: lastId } });
  t.check('polling (after): trae la tarjeta nueva con sus datos', r.code === 200 && r.body.messages.length === 1 && r.body.messages[0].item_slug === 'silla1' && r.body.products?.silla1?.title === 'Silla gamer', JSON.stringify(r.body));
  r = await call({ guest: KEY_B, body: { action: 'chat_get', token: tk, full: true } });
  t.check('otra llave sigue sin ver nada (404)', r.code === 404);

  // Bandeja del vendedor: de qué producto vino (foto + título) y el slug para abrirlo.
  r = await call({ tok: tokSeller, body: { action: 'chat_list', as: 'seller' } });
  const row = r.body?.conversations?.[0];
  t.check('bandeja del vendedor: foto y título del producto de la pregunta', r.code === 200 && row?.subject === 'Silla gamer' && row?.photo === 'https://x/silla.jpg' && row?.item_slug === 'silla1', JSON.stringify(row));

  /* ---------- Neo 1: precio ACTUAL en la tarjeta ---------- */
  db.tables.orders.find((o: any) => o.slug === 'bici01').price_crc = 140000;
  r = await call({ guest: KEY_A, body: { action: 'chat_get', token: tk, full: true } });
  t.check('la tarjeta muestra el precio actual del producto (no el del momento del mensaje)', r.body?.products?.bici01?.price_crc === 140000 && r.body?.products?.bici01?.available === true, JSON.stringify(r.body?.products?.bici01));

  /* ---------- Neo 4: producto borrado (archivado, cancelado o sin fila) -> la conversación sigue ---------- */
  db.tables.orders.find((o: any) => o.slug === 'bici01').listing_status = 'archivada';
  db.tables.orders = db.tables.orders.filter((o: any) => o.slug !== 'silla1');
  r = await call({ guest: KEY_A, body: { action: 'chat_get', token: tk, full: true } });
  const gone1 = r.body?.products?.bici01, gone2 = r.body?.products?.silla1;
  t.check('producto archivado o borrado: available:false, sin precio ni foto', r.code === 200 && gone1?.available === false && gone2?.available === false && gone1.price_crc == null && gone2.photo == null, JSON.stringify(r.body?.products));
  t.check('producto borrado: la cabecera no lo enlaza (item null) y se marca no disponible', r.body?.conversation?.item == null && r.body?.conversation?.item_gone === true, JSON.stringify(r.body?.conversation));
  r = await call({ guest: KEY_A, body: { action: 'chat_send', token: tk, body: '¿Lo vas a volver a publicar?', client_id: 'cli_00000006' } });
  t.check('con el producto borrado la conversación sigue (se puede escribir)', r.code === 200);

  /* ---------- Neo 3: límite por llave / cuenta en TODAS sus conversaciones (en la base, entre instancias) ---------- */
  t.check('límites razonables: 12/min por conversación, 20 conversaciones/h, 60 mensajes/h por comprador', CHAT_SEND_PER_MIN === 12 && CHAT_OPEN_PER_HOUR === 20 && CHAT_BUYER_PER_HOUR === 60);
  {
    const db2 = setup();
    db2.tables.seller_profiles.push(...Array.from({ length: 6 }, (_, i) => ({ sub: `s${i}`, store_slug: `tienda-${i}`, display_name: `T${i}` })));
    const toks: string[] = [];
    for (let i = 0; i < 6; i++) { const o = await call({ guest: KEY_B, body: { action: 'chat_open', store_slug: `tienda-${i}` } }); toks.push(o.body.token); }
    // 59 mensajes del comprador en la última hora repartidos en 6 conversaciones (como si vinieran de otras instancias).
    const convs = db2.tables.chat_conversations; const iso = new Date(Date.now() - 20 * 60_000).toISOString();
    for (let i = 0; i < 59; i++) { const c = convs[i % 6]; db2.tables.chat_messages ??= []; db2.tables.chat_messages.push({ id: 10_000 + i, conversation_id: c.id, sender: 'buyer', body: 'x', client_id: null, created_at: iso }); c.last_message_at = iso; }
    __resetChat(); // memoria de la instancia vacía: el límite sale de la base
    let rr = await call({ guest: KEY_B, body: { action: 'chat_send', token: toks[0], body: 'uno más', client_id: 'cli_lim00001' } });
    t.check('mensaje 60 de la hora -> pasa', rr.code === 200, `${rr.code} ${JSON.stringify(rr.body)}`);
    rr = await call({ guest: KEY_B, body: { action: 'chat_send', token: toks[1], body: 'otro', client_id: 'cli_lim00002' } });
    t.check('mensaje 61 en otra conversación -> 429 chat_rate_limited con mensaje amable', rr.code === 429 && rr.body?.code === 'chat_rate_limited' && /Espera un rato/.test(rr.body?.error ?? '') && !BANNED_COPY.test(rr.body?.error ?? '') && !/proteg/i.test(rr.body?.error ?? ''), `${rr.code} ${JSON.stringify(rr.body)}`);
    rr = await call({ tok: await token({ sub: 's1' }), body: { action: 'chat_send', token: toks[1], body: 'Hola', client_id: 'cli_lim00003' } });
    t.check('el vendedor puede responder igual (el límite es del comprador)', rr.code === 200, `${rr.code}`);
    // Conversaciones nuevas por hora, en la base (no solo en memoria).
    const db3 = setup();
    db3.tables.seller_profiles.push(...Array.from({ length: 22 }, (_, i) => ({ sub: `x${i}`, store_slug: `shop-${i}`, display_name: `S${i}` })));
    const guestB = guestSubFromReq({ headers: { 'x-guest-key': KEY_B } })!;
    db3.tables.chat_conversations = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, token: `${'T'.repeat(30)}${String(i).padStart(2, '0')}`, seller_user_id: `x${i}`, buyer_id: guestB, ctx: 'store', created_at: new Date(Date.now() - 10 * 60_000).toISOString(), last_message_at: null }));
    __resetChat();
    rr = await call({ guest: KEY_B, body: { action: 'chat_open', store_slug: 'shop-21' } });
    t.check('conversación 21 de la hora (contada en la base) -> 429', rr.code === 429 && rr.body?.code === 'chat_rate_limited', `${rr.code} ${JSON.stringify(rr.body)}`);
  }

  /* ---------- Neo 2: el chat del invitado sigue las mismas reglas ---------- */
  {
    const db4 = setup();
    const guestA2 = guestSubFromReq({ headers: { 'x-guest-key': KEY_A } })!;
    let rr = await call({ guest: KEY_A, body: { action: 'chat_open', item_slug: 'bici01' } });
    const tg = rr.body.token;
    await call({ guest: KEY_A, body: { action: 'chat_send', token: tg, body: 'hola', client_id: 'cli_g0000001', item_slug: 'bici01' } });
    t.check('invitado: buyer_id = guest:<hash> (nunca la llave cruda)', db4.tables.chat_conversations[0].buyer_id === guestA2 && !JSON.stringify(db4.tables).includes(KEY_A));
    rr = await call({ guest: KEY_A, body: { action: 'chat_report', token: tg, reason: 'spam' } });
    t.check('invitado: puede reportar', rr.code === 200 && rr.body?.reported === true);
    // Regla de bloqueo (#94): con una compra en curso del MISMO invitado con ese vendedor, el vendedor no puede bloquear.
    db4.tables.orders.push({ id: 'o9', slug: 'comp99', kind: 'single', seller_user_id: 'seller1', buyer_user_id: guestA2, brand: 'Bici', model: '', photos: [], status: 'fondeado', price_crc: 150000 });
    rr = await call({ tok: tokSeller, body: { action: 'chat_block', token: tg, blocked: true } });
    t.check('invitado: el vendedor no puede bloquear con una compra en curso (409)', rr.code === 409 && rr.body?.code === 'chat_block_locked', `${rr.code}`);
    db4.tables.orders.find((o: any) => o.slug === 'comp99').status = 'liberado';
    rr = await call({ tok: tokSeller, body: { action: 'chat_block', token: tg, blocked: true } });
    t.check('invitado: sin compra en curso el vendedor sí puede bloquear y el invitado ya no escribe', rr.code === 200 && (await call({ guest: KEY_A, body: { action: 'chat_send', token: tg, body: 'x', client_id: 'cli_g0000002' } })).code === 403);
    const ret = read('supabase/migrations/026_chat_retention_dispute.sql');
    t.check('retención 12 meses en pausa con disputa: misma regla por buyer_id (invitado o cuenta)', /o\.buyer_user_id = c\.buyer_id/.test(ret) && /interval '12 months'/.test(ret) && /not coalesce\(conv\.dispute_open, false\)/.test(ret));
  }

  /* ---------- Sin la migración 030 (sin chat_messages.item_slug) ---------- */
  db = setup();
  const realFrom = db.from;
  const noCol = { code: '42703', message: 'column chat_messages.item_slug does not exist' };
  const noColIns = { code: 'PGRST204', message: "Could not find the 'item_slug' column of 'chat_messages' in the schema cache" };
  (db as any).from = (name: string) => {
    const q = realFrom(name);
    if (name !== 'chat_messages') return q;
    let bad: any = null;
    const wrap: any = new Proxy(q, { get: (o, k) => {
      if (k === 'then') return (res: any, rej: any) => (bad ? Promise.resolve({ data: null, error: bad }).then(res, rej) : o.then(res, rej));
      if (k === 'single' || k === 'maybeSingle') return async () => (bad ? { data: null, error: bad } : o[k]());
      if (k === 'select') return (cols?: string) => { if (String(cols ?? '').includes('item_slug')) bad = noCol; o.select(cols); return wrap; };
      if (k === 'insert') return (p: any) => { if (p && 'item_slug' in p) bad = noColIns; o.insert(p); return wrap; };
      if (k === 'not') return (c: string, ...a: any[]) => { if (c === 'item_slug') bad = noCol; (o as any).not?.(c, ...a); return wrap; };
      const v = (o as any)[k]; return typeof v === 'function' ? (...a: any[]) => { v(...a); return wrap; } : v;
    } });
    return wrap;
  };
  r = await call({ guest: KEY_A, body: { action: 'chat_open', item_slug: 'bici01' } });
  const tk2 = r.body?.token;
  r = await call({ guest: KEY_A, body: { action: 'chat_send', token: tk2, body: '¿Sigue disponible?', client_id: 'cli_00000011', item_slug: 'bici01' } });
  t.check('sin 030: enviar con item_slug funciona (sin tarjeta en el mensaje, sin 503)', r.code === 200 && r.body?.message?.body === '¿Sigue disponible?' && (r.body.message.item_slug ?? null) === null
    && !('item_slug' in db.tables.chat_messages[0]), `${r.code} ${JSON.stringify(r.body)}`);
  r = await call({ guest: KEY_A, body: { action: 'chat_get', token: tk2, full: true } });
  t.check('sin 030: leer funciona; la tarjeta fija de arriba sigue (conversation.subject + item)', r.code === 200 && r.body.messages.length === 1 && r.body.conversation?.subject === 'Bici de montaña' && r.body.conversation?.item?.slug === 'bici01', `${r.code} ${JSON.stringify(r.body)}`);
  r = await call({ tok: tokSeller, body: { action: 'chat_list', as: 'seller' } });
  t.check('sin 030: bandeja del vendedor con foto y título del producto', r.code === 200 && r.body.conversations[0]?.subject === 'Bici de montaña' && r.body.conversations[0]?.photo === 'https://x/bici.jpg');
  (db as any).from = realFrom;

  /* ---------- Tarjetas en el hilo (pura) ---------- */
  const m = (id: number, sender: 'buyer' | 'seller', item_slug: string | null = null) => ({ id, sender, body: 'x', client_id: null, created_at: new Date(2026, 9, 24, 10, id).toISOString(), item_slug });
  const rows = itemCardRows([m(1, 'buyer', 'bici01'), m(2, 'seller'), m(3, 'buyer', 'silla1'), m(4, 'buyer')]);
  t.check('itemCardRows: una tarjeta antes de cada mensaje con producto, del lado de quien preguntó', JSON.stringify(rows.map((x) => x.k === 'item' ? `item:${x.slug}:${x.sender}` : `msg:${x.m.id}`))
    === JSON.stringify(['item:bici01:buyer', 'msg:1', 'msg:2', 'item:silla1:buyer', 'msg:3', 'msg:4']), JSON.stringify(rows));

  /* ---------- App ---------- */
  const chatSrc = read('app/chat.tsx');
  t.check('aviso "paga dentro" siempre visible en la conversación antes de pagar (también con mensajes)', COPY.chat.payInside === 'Para que tu compra quede en custodia, paga dentro de Meteorito.' && /'chat-pay-pinned'/.test(chatSrc) && /!conv\.paid && msgs\.length > 0 \? <PayInside pinned \/>/.test(chatSrc));
  t.check('producto no disponible: texto exacto, sin link', COPY.chat.itemGone === 'Este producto ya no está disponible' && /testID="chat-item-gone"/.test(chatSrc) && /K\.itemGone/.test(chatSrc));

  const ficha = read('app/p/[slug].tsx');
  t.check('/p/<slug>: "Preguntar al vendedor" sin esperar el perfil de la tienda (no depende de seller &&)', /<AskSellerButton storeSlug=\{seller === undefined \? undefined : seller\?\.store_slug \?\? null\} itemSlug=\{order\.slug\}/.test(ficha) && !/seller && \(order\.status === 'creado'/.test(ficha));
  t.check('/p/<slug>: después de pagar, el comprador usa el chat de su compra (no dos botones)', /!\(canShowContact\(order\.status\) && isBuyerDevice\(order\.slug\)\) \? <AskSellerButton/.test(ficha));
  const btn = read('components/ChatButton.tsx');
  t.check('AskSellerButton: oculto para el dueño; abre con el producto y lleva ?p=<slug> al chat', /isOwnerView\(auth, mineSlug, storeSlug\)/.test(btn) && /&p=\$\{/.test(btn) && /item_slug: itemSlug/.test(btn));
  const chat = read('app/chat.tsx');
  t.check('/chat: tarjeta del producto en el hilo (foto, título, precio, abre /p/<slug>)', /testID="chat-item-card"/.test(chat) && /itemCardRows\(/.test(chat) && /pathname: '\/p\/\[slug\]'/.test(chat) && /formatCRC\(/.test(chat));
  t.check('/chat: el primer mensaje desde el producto manda item_slug', /sendChat\(auth, roleRef\.current, String\(token\), m\.body, m\.client_id!, m\.item_slug/.test(chat));
  const inbox = read('app/mensajes.tsx');
  t.check('bandeja del vendedor: miniatura cuadrada del producto + título', /testID="inbox-item-thumb"/.test(inbox) && /'inbox-item-title'/.test(inbox));
  const demo = read('lib/demoChat.ts');
  t.check('modo demo: misma regla de tarjetas (item_slug + products)', /item_slug/.test(demo) && /products/.test(demo) && /chatItemMarker\(/.test(demo));
  const mig = 'supabase/migrations/030_chat_product_context.sql';
  t.check('migración 030: chat_messages.item_slug (nullable, 6 caracteres) idempotente', existsSync(mig) && /alter table public\.chat_messages add column if not exists item_slug text/i.test(read(mig)) && /\^\[a-z0-9\]\{6\}\$/.test(read(mig)));
  const touched = ['app/chat.tsx', 'app/mensajes.tsx', 'components/ChatButton.tsx', mig].map(read).join('\n');
  t.check('sin palabras prohibidas en lo tocado', !BANNED_COPY.test(touched.replace(/verified|Verified/g, '')) && !/\bproteg\w*/i.test(touched.replace(/Protección:/g, '')));
}
