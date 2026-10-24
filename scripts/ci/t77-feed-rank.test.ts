// (77) Algoritmo del feed: puntaje determinístico (novedad, seguidos, reputación bayesiana, identidad, ventas, calidad,
//      actividad), pesos documentados que suman 1, diversidad (máx. 2 seguidas del mismo vendedor), cursor estable,
//      filtro y búsqueda respetan el orden, personalizado solo por POST (nunca en la caché pública). Sin red.
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { __setDbForTests } from '../../api/_lib/db';
import { guestSubFromReq } from '../../api/_lib/guest';
import { decodeRankCursor, diversify, encodeRankCursor, FEED_RANK, FEED_WEIGHTS, rankFeed, score, signals, type RankItem, type RankSeller } from '../../api/_lib/feedRank';
import { fakeDb } from './fakedb';
import store from '../../api/store/index';

const NOW = Date.UTC(2026, 9, 24, 12, 0);
const hAgo = (h: number) => new Date(NOW - h * 3600e3).toISOString();
const base = (o: Omit<Partial<RankItem>, 'seller'> & { seller?: Partial<RankSeller> } = {}): RankItem => ({
  slug: o.slug ?? 'x', created_at: o.created_at ?? hAgo(1), seller_key: o.seller_key ?? 's', photos: o.photos ?? 1, title: o.title ?? 'Artículo bueno', description: o.description ?? null,
  seller: { verified: false, rating_avg: null, rating_count: 0, sales_completed: 0, followed: false, last_seen_at: null, ...(o.seller ?? {}) } });
const call = async (o: { method?: string; body?: any; query?: any; guest?: string }) => {
  const headers: Record<string, string> = {};
  const r: any = { code: 0, body: null, headers }; r.status = (c: number) => { r.code = c; return r; }; r.setHeader = (k: string, v: string) => { headers[k.toLowerCase()] = v; return r; }; r.send = (b: string) => { r.body = JSON.parse(b); return r; };
  await store({ method: o.method ?? 'GET', headers: o.guest ? { 'x-guest-key': o.guest } : {}, body: o.body ?? {}, query: o.query ?? {} }, r); return r;
};

export async function run(t: T) {
  const sum = Object.values(FEED_WEIGHTS).reduce((a, b) => a + b, 0);
  t.check('pesos documentados en una constante y suman 1', Math.abs(sum - 1) < 1e-9 && Object.keys(FEED_WEIGHTS).join() === 'followed,recency,reputation,identity,quality,sales,activity', `${sum}`);
  const sg = signals(base({ seller: { verified: true, rating_avg: 5, rating_count: 99, sales_completed: 999, followed: true, last_seen_at: hAgo(0) }, photos: 9, description: 'x'.repeat(300) }), NOW);
  t.check('cada señal entre 0 y 1; todo al máximo -> puntaje ≈ 1', Object.values(sg).every((v) => v >= 0 && v <= 1) && score(base({ created_at: hAgo(0), seller: { verified: true, rating_avg: 5, rating_count: 1e6, sales_completed: 1e6, followed: true, last_seen_at: hAgo(0) }, photos: 4, description: 'x'.repeat(60), title: 'x'.repeat(12) }), NOW) > 0.99, JSON.stringify(sg));

  t.check(`novedad: a las ${FEED_RANK.recencyHalfLifeH} h vale la mitad; más nuevo > más viejo`, Math.abs(signals(base({ created_at: hAgo(FEED_RANK.recencyHalfLifeH) }), NOW).recency - 0.5) < 1e-9
    && score(base({ created_at: hAgo(1) }), NOW) > score(base({ created_at: hAgo(5) }), NOW));
  const fresh = base({ slug: 'fresh', created_at: hAgo(0) });
  t.check('seguidos: algo de ayer de alguien que sigues va antes que algo nuevo de otro', score(base({ created_at: hAgo(24), seller: { followed: true } }), NOW) > score(fresh, NOW));
  t.check(`seguidos: el impulso se apaga a la mitad a las ${FEED_RANK.followedHalfLifeH} h`, Math.abs(signals(base({ created_at: hAgo(FEED_RANK.followedHalfLifeH), seller: { followed: true } }), NOW).followed - 0.5) < 1e-9);
  t.check('seguidos: algo de hace una semana NO tapa lo nuevo de los demás', score(base({ created_at: hAgo(24 * 7), seller: { followed: true } }), NOW) < score(fresh, NOW));
  const rep = (avg: number | null, n: number) => signals(base({ seller: { rating_avg: avg, rating_count: n } }), NOW).reputation;
  t.check('reputación bayesiana: 4.8★ con 30 reseñas > 5★ con 1; sin reseñas = neutro; 1★ con 10 < sin reseñas',
    rep(4.8, 30) > rep(5, 1) && Math.abs(rep(null, 0) - (FEED_RANK.ratingPrior - 1) / 4) < 1e-9 && rep(1, 10) < rep(null, 0), `${rep(4.8, 30)} ${rep(5, 1)} ${rep(null, 0)} ${rep(1, 10)}`);
  t.check('identidad confirmada suma FEED_WEIGHTS.identity', Math.abs(score(base({ seller: { verified: true } }), NOW) - score(base(), NOW) - FEED_WEIGHTS.identity) < 1e-9);
  const sales = (n: number) => signals(base({ seller: { sales_completed: n } }), NOW).sales;
  t.check(`ventas: escala logarítmica, 0 -> 0, ${FEED_RANK.salesSaturation}+ -> 1`, sales(0) === 0 && sales(5) > sales(1) && sales(FEED_RANK.salesSaturation) === 1 && sales(500) === 1);
  const act = (v: string | null | 'hidden') => signals(base({ seller: { last_seen_at: v } }), NOW).activity;
  t.check('actividad: en línea ≈ 1, a las 24 h 0.5, sin dato 0, oculta 0.5 (neutro)', act(hAgo(0)) === 1 && Math.abs(act(hAgo(24)) - 0.5) < 1e-9 && act(null) === 0 && act('hidden') === 0.5);
  t.check('calidad: 4 fotos + descripción > 1 foto sin descripción', signals(base({ photos: 4, description: 'Bici en buen estado, con casco y luces incluidas. Poco uso.' }), NOW).quality > signals(base({ photos: 1, title: 'Bici' }), NOW).quality);

  // Diversidad.
  const many = [...'aaaaab'].map((s, i) => base({ slug: `${s}${i}`, seller_key: s, created_at: hAgo(i), seller: { verified: s === 'a' } }));
  const ranked = rankFeed(many, NOW).map((x) => x.seller_key).join('');
  t.check('diversidad: nunca 3 seguidas del mismo vendedor si hay otro', !/(.)\1\1/.test(ranked.slice(0, 4)) && ranked.startsWith('aab'), ranked);
  t.check('diversidad: si solo queda un vendedor, se muestran todas igual', diversify([1, 2, 3, 4].map((i) => ({ seller_key: 'z', i }))).length === 4);
  const alt = diversify(['a', 'a', 'a', 'b', 'b', 'b', 'c'].map((k, i) => ({ seller_key: k, i }))).map((x) => x.seller_key).join('');
  t.check('diversidad: máx. FEED_RANK.maxRun (2) seguidas', FEED_RANK.maxRun === 2 && !/(.)\1\1/.test(alt), alt);

  // Determinístico: mismo resultado sin importar el orden de entrada; empates por fecha y slug.
  const pool = Array.from({ length: 30 }, (_, i) => base({ slug: `p${String(i).padStart(2, '0')}`, seller_key: `s${i % 5}`, created_at: hAgo(i % 7), photos: i % 4, seller: { verified: i % 3 === 0, rating_avg: i % 2 ? 4.5 : null, rating_count: i % 2 ? i : 0, sales_completed: i, followed: i % 5 === 2 } }));
  const a1 = rankFeed(pool, NOW).map((x) => x.slug).join();
  const a2 = rankFeed([...pool].reverse(), NOW).map((x) => x.slug).join();
  const a3 = rankFeed([...pool].sort((x, y) => (x.photos - y.photos) || x.slug.localeCompare(y.slug)), NOW).map((x) => x.slug).join();
  t.check('determinístico: mismo orden con la entrada en cualquier orden', a1 === a2 && a2 === a3, `${a1.slice(0, 40)} | ${a2.slice(0, 40)}`);
  t.check('cursor del algoritmo: ida y vuelta; basura -> null', JSON.stringify(decodeRankCursor(encodeRankCursor(20, NOW))) === JSON.stringify({ offset: 20, asOf: NOW }) && decodeRankCursor('r1_x') === null && decodeRankCursor('2026-10-20T12:00:00Z') === null);

  // API: GET ?order=rank (igual para todos, caché pública) y POST action 'feed' (con quién sigues, sin caché).
  const db = fakeDb(); __setDbForTests(db as any);
  const at = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
  db.tables.seller_profiles = [
    { sub: 's-top', store_slug: 'top', display_name: 'Top Store', verified: true, created_at: at(900), last_seen_at: at(0) },
    { sub: 's-new', store_slug: 'nuevo', display_name: 'Ana Nueva', verified: false, created_at: at(900) },
    { sub: 's-fav', store_slug: 'favorito', display_name: 'Carlos Fav', verified: false, created_at: at(900) },
  ];
  db.tables.public_stores = [{ store_slug: 'top', display_name: 'Top Store', rating_avg: '4.90', rating_count: 40 }];
  const L = (slug: string, seller: string, h: number, o: Record<string, unknown> = {}) => ({ id: `id-${slug}`, slug, kind: 'listing', status: 'creado', listing_status: 'activa', listing_slug: null,
    seller_user_id: seller, brand: '', model: `Producto ${slug}`, description: 'Descripción completa del producto en buen estado', price_crc: 10000, photos: ['https://x/1.jpg', 'https://x/2.jpg'], created_at: at(h), ...o });
  db.tables.orders = [
    L('top001', 's-top', 30), L('top002', 's-top', 31), L('top003', 's-top', 32), L('top004', 's-top', 33),
    L('new001', 's-new', 2, { photos: ['https://x/n.jpg'], description: null }), L('new002', 's-new', 40, { model: 'Bici playera' }),
    L('fav001', 's-fav', 20, { model: 'Bici de montaña' }), L('fav002', 's-fav', 60),
    ...Array.from({ length: 30 }, (_, i) => ({ id: `v${i}`, slug: `vend${String(i).padStart(2, '0')}`, status: 'liberado', seller_user_id: 's-top', kind: 'single', created_at: at(500) })),
  ];
  const ids = (r: any) => (r.body?.items ?? []).map((i: any) => i.slug);
  let r = await call({ query: { feed: '1', order: 'rank', verified: 'all', limit: '20' } });
  const g = ids(r);
  t.check('GET order=rank: todas las publicaciones activas, una vez', r.code === 200 && g.length === 8 && new Set(g).size === 8, g.join());
  t.check('GET order=rank: reputación + identidad + ventas suben a Top Store sobre lo un poco más nuevo', g.indexOf('top001') < g.indexOf('fav001'), g.join());
  const run3 = g.map((s: string) => s.slice(0, 3)).join(',');
  t.check('GET order=rank: máx. 2 seguidas del mismo vendedor', !/(top|new|fav),\1,\1/.test(run3), run3);
  t.check('GET order=rank: caché pública corta (no personalizado)', /public/.test(r.headers['cache-control'] ?? ''));
  r = await call({ query: { feed: '1', verified: 'all', limit: '20' } });
  t.check('GET sin order (clientes viejos): lo más nuevo primero, como antes', ids(r).join() === 'new001,fav001,top001,top002,top003,top004,new002,fav002', ids(r).join());

  // Paginación estable con el cursor del algoritmo: mismas tarjetas, mismo orden, sin repetir.
  const pages: string[] = []; let cursor: string | null = null; let guard = 0;
  do { const q: any = { feed: '1', order: 'rank', verified: 'all', limit: '3' }; if (cursor) q.cursor = cursor; r = await call({ query: q }); pages.push(...ids(r)); cursor = r.body?.next_cursor ?? null; } while (cursor && ++guard < 10);
  t.check('paginación por cursor del algoritmo: igual al orden completo, sin repetir', pages.join() === g.join(), `${pages.join()} vs ${g.join()}`);
  t.check('cursor del algoritmo con forma r<pos>_<ms>', /^r3_\d{13}$/.test(String((await call({ query: { feed: '1', order: 'rank', verified: 'all', limit: '3' } })).body?.next_cursor)));

  // Filtro y búsqueda respetan el algoritmo.
  r = await call({ query: { feed: '1', order: 'rank', verified: 'true', limit: '20' } });
  t.check('filtro Identidad confirmada + algoritmo: solo verificados', ids(r).length === 4 && ids(r).every((s: string) => s.startsWith('top')), ids(r).join());
  r = await call({ query: { feed: '1', order: 'rank', verified: 'false', limit: '20' } });
  t.check('filtro Sin confirmar + algoritmo: solo sin confirmar, ordenados por puntaje', ids(r).length === 4 && ids(r).every((s: string) => !s.startsWith('top')), ids(r).join());
  r = await call({ query: { feed: '1', order: 'rank', verified: 'all', q: 'bici', limit: '20' } });
  t.check('búsqueda + algoritmo: solo lo que coincide', ids(r).sort().join() === 'fav001,new002', ids(r).join());

  // Personalizado: POST action 'feed' con la llave del dispositivo; sigue a Carlos Fav -> sus productos suben.
  const KEY = 'e'.repeat(64);
  db.tables.seller_follows = [{ id: 1, follower_id: guestSubFromReq({ headers: { 'x-guest-key': KEY } }), seller_user_id: 's-fav', created_at: at(1) }];
  r = await call({ method: 'POST', guest: KEY, body: { action: 'feed', verified: 'all', limit: '20' } });
  const pz = ids(r);
  t.check('POST feed: el vendedor que sigues sube (fav001 primero)', r.code === 200 && pz[0] === 'fav001' && pz.length === 8, pz.join());
  t.check('POST feed: sin caché pública (private, no-store)', /no-store/.test(r.headers['cache-control'] ?? '') && /private/.test(r.headers['cache-control'] ?? ''));
  r = await call({ method: 'POST', guest: 'f'.repeat(64), body: { action: 'feed', verified: 'all', limit: '20' } });
  t.check('POST feed de alguien que no sigue a nadie = el GET para todos', ids(r).join() === g.join(), ids(r).join());
  t.check('feed: sin datos privados (sub, seguidores, última conexión, puntaje)', !/s-top|s-fav|follower|last_seen|"score"|seller_user_id/.test(JSON.stringify(r.body)));
  delete (db.tables as any).seller_follows;
  db.tables.seller_profiles.forEach((p: any) => { delete p.last_seen_at; });
  r = await call({ query: { feed: '1', order: 'rank', verified: 'all', limit: '20' } });
  t.check('sin migraciones 021/022 el algoritmo funciona igual (sin señales de actividad ni seguidos)', r.code === 200 && ids(r).length === 8);

  const feed = readFileSync(new URL('../../components/Feed.tsx', import.meta.url), 'utf8');
  const lib = readFileSync(new URL('../../lib/store.ts', import.meta.url), 'utf8');
  t.check('app: pide el feed con el algoritmo (order=rank) y personalizado solo si sigues a alguien', /order: 'rank'/.test(lib) && /action: 'feed'/.test(lib) && /followsSome\(\) \? auth : null/.test(feed));
}
