// (87) Comprar › Siguiendo: una vista del feed con SOLO las publicaciones de las tiendas que sigue esta persona (la misma
//      identidad que el botón Seguir: cuenta y/o llave del dispositivo). Buscador y filtro de identidad aplican igual; sin
//      productos de ejemplo (ej-…) ni Patrocinado; sin seguir a nadie, estado vacío. Para ti (por defecto) no cambia. Sin red.
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { installTestJwks, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { guestSubFromReq } from '../../api/_lib/guest';
import { BANNED_COPY, COPY } from '../../lib/copy';
import { fakeDb } from './fakedb';
import store from '../../api/store/index';

const call = async (o: { method?: string; body?: any; query?: any; guest?: string; tok?: string }) => {
  const headers: Record<string, string> = {};
  const r: any = { code: 0, body: null, headers }; r.status = (c: number) => { r.code = c; return r; }; r.setHeader = (k: string, v: string) => { headers[k.toLowerCase()] = v; return r; }; r.send = (b: string) => { r.body = JSON.parse(b); return r; };
  await store({ method: o.method ?? 'POST', headers: { ...(o.guest ? { 'x-guest-key': o.guest } : {}), ...(o.tok ? { authorization: `Bearer ${o.tok}` } : {}) }, body: o.body ?? {}, query: o.query ?? {} }, r); return r;
};

export async function run(t: T) {
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  const prevDemo = process.env.FEED_DEMO_PRODUCTS; process.env.FEED_DEMO_PRODUCTS = '1'; // con ejemplos encendidos (como prod)
  const db = fakeDb(); __setDbForTests(db as any);
  const at = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
  db.tables.seller_profiles = [
    { sub: 's-conf', store_slug: 'confirmada', display_name: 'Tienda Confirmada', verified: true, created_at: at(900) },
    { sub: 's-sin', store_slug: 'sinconfirmar', display_name: 'Tienda Sin', verified: false, created_at: at(900) },
    { sub: 's-otra', store_slug: 'otra', display_name: 'Otra Tienda', verified: true, created_at: at(900) },
    { sub: 's-otra2', store_slug: 'otra2', display_name: 'Otra Dos', verified: false, created_at: at(900) },
  ];
  db.tables.public_stores = [];
  const L = (slug: string, seller: string, h: number, model = `Producto ${slug}`) => ({ id: `id-${slug}`, slug, kind: 'listing', status: 'creado', listing_status: 'activa', listing_slug: null,
    seller_user_id: seller, brand: '', model, description: 'Descripción completa del producto en buen estado', price_crc: 10000, photos: ['https://x/1.jpg'], created_at: at(h) });
  db.tables.orders = [L('conf01', 's-conf', 1, 'Bici de montaña'), L('conf02', 's-conf', 3), L('sin001', 's-sin', 2, 'Consola PlayStation'), L('otra01', 's-otra', 1, 'Bici playera'), L('otra02', 's-otra2', 1),
    L('ej-bici-x', 's-conf', 0, 'Bici de ejemplo')]; // un "ej-" en la base nunca sale en Siguiendo
  db.tables.sponsored_listings = [{ id: 1, order_slug: 'otra01', seller_user_id: 's-otra', amount_paid_crc: 0, starts_at: at(10), ends_at: new Date(Date.now() + 864e5).toISOString(), status: 'activo' }];
  const KEY = 'c'.repeat(64);
  const slugs = (r: any) => (r.body?.items ?? []).map((i: any) => i.slug).sort().join();

  // Sin seguir a nadie: vacío (sin productos de ejemplo de relleno).
  let r = await call({ guest: KEY, body: { action: 'feed', view: 'following', verified: 'all', limit: '20' } });
  t.check('sin seguir a nadie: Siguiendo vacío, sin ejemplos ni Patrocinado', r.code === 200 && r.body.items.length === 0 && r.body.next_cursor === null && Array.isArray(r.body.sponsored) && !r.body.sponsored.length, JSON.stringify(r.body).slice(0, 200));

  // Sigue a dos tiendas (con la llave del dispositivo, igual que el botón Seguir).
  for (const s of ['confirmada', 'sinconfirmar']) await call({ guest: KEY, body: { action: 'follow', store_slug: s } });
  r = await call({ guest: KEY, body: { action: 'feed', view: 'following', verified: 'all', limit: '20' } });
  t.check('Siguiendo: solo las tiendas que sigues (todas)', r.code === 200 && slugs(r) === 'conf01,conf02,sin001', slugs(r));
  t.check('Siguiendo: sin productos de ejemplo ej-… ni Patrocinado', !(r.body.items ?? []).some((i: any) => i.slug.startsWith('ej-') || i.demo || i.seller?.demo) && r.body.sponsored.length === 0, JSON.stringify(r.body.sponsored));
  t.check('Siguiendo: sin caché pública', /private/.test(r.headers['cache-control'] ?? '') && /no-store/.test(r.headers['cache-control'] ?? ''));
  r = await call({ guest: KEY, body: { action: 'feed', view: 'following', verified: 'true', limit: '20' } });
  t.check('Siguiendo + Identidad confirmada: solo las confirmadas que sigues', slugs(r) === 'conf01,conf02', slugs(r));
  r = await call({ guest: KEY, body: { action: 'feed', view: 'following', verified: 'false', limit: '20' } });
  t.check('Siguiendo + Sin confirmar: solo las sin confirmar que sigues', slugs(r) === 'sin001', slugs(r));
  r = await call({ guest: KEY, body: { action: 'feed', view: 'following', verified: 'all', q: 'bici', limit: '20' } });
  t.check('Siguiendo + búsqueda: solo lo que coincide de tus tiendas (no la bici de otra)', slugs(r) === 'conf01', slugs(r));
  const pages: string[] = []; let cursor: string | null = null; let guard = 0;
  do { r = await call({ guest: KEY, body: { action: 'feed', view: 'following', verified: 'all', limit: '1', ...(cursor ? { cursor } : {}) } }); pages.push(...r.body.items.map((i: any) => i.slug)); cursor = r.body.next_cursor; } while (cursor && ++guard < 8);
  t.check('Siguiendo: paginación sin repetir ni colar otras tiendas', pages.slice().sort().join() === 'conf01,conf02,sin001' && new Set(pages).size === 3, pages.join());

  // Para ti (por defecto) no cambia: todas las tiendas.
  r = await call({ guest: KEY, body: { action: 'feed', verified: 'all', limit: '20' } });
  t.check('Para ti (sin view) sigue mostrando todas las tiendas', ['conf01', 'sin001', 'otra01', 'otra02'].every((s) => slugs(r).includes(s)), slugs(r));
  r = await call({ guest: KEY, body: { action: 'feed', view: 'for_you', verified: 'all', limit: '20' } });
  t.check('view for_you = Para ti', ['otra01', 'otra02'].every((s) => slugs(r).includes(s)), slugs(r));
  r = await call({ guest: KEY, body: { action: 'feed', view: 'todo', verified: 'all' } });
  t.check('vista desconocida -> 400 bad_view', r.code === 400 && r.body?.code === 'bad_view', `${r.code}`);
  r = await call({ body: { action: 'feed', view: 'following', verified: 'all' } });
  t.check('Siguiendo sin llave ni sesión -> 401', r.code === 401, `${r.code}`);

  // Con cuenta: lo que sigue la cuenta (en cualquier dispositivo).
  const tok = await token({ sub: 'buyer-con-cuenta' });
  await call({ tok, guest: 'd'.repeat(64), body: { action: 'follow', store_slug: 'otra' } });
  r = await call({ tok, guest: 'e'.repeat(64), body: { action: 'feed', view: 'following', verified: 'all', limit: '20' } });
  t.check('con cuenta: Siguiendo muestra lo que sigue la cuenta, desde otro dispositivo', slugs(r) === 'otra01', slugs(r));
  t.check('Siguiendo: nadie ve quién sigue (sin subs ni ids de seguidores)', !/buyer-con-cuenta|follower|seller_user_id|s-otra/.test(JSON.stringify(r.body)) && !JSON.stringify(r.body).includes(guestSubFromReq({ headers: { 'x-guest-key': KEY } })!));
  if (prevDemo == null) delete process.env.FEED_DEMO_PRODUCTS; else process.env.FEED_DEMO_PRODUCTS = prevDemo;

  // App: pestañas Para ti / Siguiendo delgadas, 16 px, iconos (sin emojis); filtro y buscador se quedan; vacío en tuteo.
  const feed = readFileSync(new URL('../../components/Feed.tsx', import.meta.url), 'utf8');
  const lib = readFileSync(new URL('../../lib/store.ts', import.meta.url), 'utf8');
  t.check('copy: Para ti / Siguiendo y el vacío pedido', COPY.feed.forYou === 'Para ti' && COPY.feed.following === 'Siguiendo'
    && `${COPY.feed.followingEmptyTitle}. ${COPY.feed.followingEmptyText}` === 'Aún no sigues tiendas. Cuando sigas una, sus publicaciones aparecen aquí.');
  const flat = JSON.stringify([COPY.feed.forYou, COPY.feed.following, COPY.feed.viewsLabel, COPY.feed.followingEmptyTitle, COPY.feed.followingEmptyText, COPY.feed.followingNoneTitle, COPY.feed.followingNoneText('Sin confirmar'), COPY.feed.seeForYou]);
  t.check('copy de Siguiendo: tuteo, sin palabras prohibidas', !BANNED_COPY.test(flat) && !/\b(vos|tenés|podés|seguís|querés)\b/i.test(flat), flat);
  t.check('feed: pestañas Para ti / Siguiendo arriba (tablist), con iconos y sin emojis', /testID="feed-view"/.test(feed) && /accessibilityRole="tablist" accessibilityLabel=\{COPY\.feed\.viewsLabel\}/.test(feed)
    && /icon: 'sparkles-outline'/.test(feed) && /icon: 'people-outline'/.test(feed) && !/\p{Extended_Pictographic}/u.test(feed)
    && feed.indexOf('testID="feed-view"') < feed.indexOf('testID="feed-filter"'));
  t.check('feed: pestañas delgadas (sin caja), texto de 16 px y área táctil de 44', /viewText: \{[^}]*fontSize: 16/.test(feed) && /viewBtn: \{[^}]*minHeight: TOUCH/.test(feed) && !/views: \{[^}]*backgroundColor/.test(feed));
  t.check('feed: Siguiendo con buscador y filtro, sin Patrocinado ni ventas de ejemplo', /\{phase === 'ready' && !following && sponsored\.length \?/.test(feed) && /following \? items : mixFeed/.test(feed)
    && /getFeed\(\{ q, verified: filter, cursor: c, limit: PAGE, personal: auth, view: 'following' \}\)/.test(feed) && /items: page\.items\.filter\(real\)/.test(feed));
  t.check('feed: sin seguir a nadie, estado vacío sin pedir nada', /if \(!followsSome\(\)\) \{ setFollowsNone\(true\)/.test(feed) && /following && followsNone/.test(feed));
  t.check('app: Siguiendo se pide por POST con la identidad de seguir', /view === 'following' \? \{ view: 'following' \}/.test(lib));
}
