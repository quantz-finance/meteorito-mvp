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
