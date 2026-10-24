// (60) Feed de Comprar + buscador: todos los vendedores con producto activo (salvo ocultos por moderación), filtro
//      Verificados / Sin verificar / Todos, lo más nuevo primero, paginación por cursor, sin datos privados y búsqueda
//      sin mayúsculas ni acentos que respeta el filtro. Sin red.
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { __setDbForTests } from '../../api/_lib/db';
import { decodeCursor, encodeCursor, foldText, matchesTokens, searchTokens } from '../../api/_lib/feed';
import { fakeDb } from './fakedb';
import store from '../../api/store/index';

const get = async (query: Record<string, string>) => {
  const headers: Record<string, string> = {};
  const r: any = { code: 0, body: null, headers };
  r.status = (c: number) => { r.code = c; return r; }; r.setHeader = (k: string, v: string) => { headers[k.toLowerCase()] = v; return r; };
  r.send = (b: string) => { r.body = JSON.parse(b); return r; };
  await store({ method: 'GET', headers: {}, body: {}, query }, r);
  return r;
};
const W = (n: number) => 'G' + String(n).repeat(55).slice(0, 55);
const at = (min: number) => new Date(Date.UTC(2026, 9, 20, 12, min)).toISOString();
const listing = (slug: string, seller: string, min: number, o: Record<string, unknown> = {}) => ({
  id: `id-${slug}`, slug, kind: 'listing', status: 'creado', listing_status: 'activa', listing_slug: null, seller_user_id: seller,
  seller_address: W(1), seller_email: `${seller}@correo.com`, brand: '', model: 'Artículo', description: null, price_crc: 10000,
  photos: [`https://x/${slug}.jpg`], identifier: '1234567890', created_at: at(min), ...o });

export async function run(t: T) {
  // Normalización pura (la misma para el texto del producto y lo que escribe el comprador).
  t.check('foldText: sin acentos ni mayúsculas', foldText('  CÁMARA  Ñandú ') === 'camara nandu', foldText('  CÁMARA  Ñandú '));
  t.check('searchTokens: "PlayStation 5!" -> [playstation, 5]', JSON.stringify(searchTokens('PlayStation 5!')) === '["playstation","5"]');
  t.check('searchTokens: vacío o solo símbolos -> []', searchTokens('').length === 0 && searchTokens(' %_* ').length === 0);
  t.check('matchesTokens: todas las palabras, en cualquier orden', matchesTokens('Consola PlayStation 5 Slim', searchTokens('slim playstation')) && !matchesTokens('Consola Xbox', searchTokens('playstation')));
  t.check('matchesTokens: "camara" encuentra "Cámara" y "CÁMARA" encuentra "camara"', matchesTokens('Cámara Canon', searchTokens('camara')) && matchesTokens('camara canon', searchTokens('CÁMARA')));
  const c = encodeCursor(at(5));
  t.check('cursor: ida y vuelta; basura -> null', decodeCursor(c) === at(5) && decodeCursor('x;drop') === null && decodeCursor(undefined) === null);

  const db = fakeDb(); __setDbForTests(db as any);
  db.tables.seller_profiles = [
    { sub: 's-vale', store_slug: 'valeria', display_name: 'Valeria Mora', avatar_url: 'https://x/v.jpg', contact_phone: '+50688881234', verified: true, verified_at: at(0), created_at: at(0) },
    { sub: 's-jose', store_slug: 'jose-games', display_name: 'José Games', avatar_url: null, created_at: at(0) },
    { sub: 's-nuevo', store_slug: 'nuevo', display_name: 'Ana Nueva', verified: false, created_at: at(0) },
    { sub: 's-hidden', store_slug: 'oculto', display_name: 'Oculto', listed_in_feed: false, created_at: at(0) },
  ];
  db.tables.public_stores = [{ store_slug: 'valeria', display_name: 'Valeria Mora', rating_avg: '4.67', rating_count: 3 }, { store_slug: 'jose-games', display_name: 'José Games', rating_avg: null, rating_count: 0 }];
  db.tables.orders = [
    listing('aaaaa1', 's-vale', 1, { model: 'Cámara Canon EOS', price_crc: 250000 }),
    listing('aaaaa2', 's-jose', 2, { brand: 'Sony', model: 'PlayStation 5 Slim', price_crc: 320000 }),
    listing('aaaaa3', 's-vale', 3, { model: 'Bicicleta aro 29', description: 'Ideal para jugar con la playstation? no: bici' }),
    listing('aaaaa4', 's-jose', 4, { model: 'Control de PLAYSTATION', price_crc: 30000 }),
    listing('aaaaa5', 's-vale', 5, { model: 'Lámpara de escritorio' }),
    listing('ccccc1', 's-nuevo', 6, { model: 'Silla gamer', description: 'Para jugar PlayStation horas' }),
    listing('bbbbb2', 's-hidden', 7, { model: 'PlayStation oculta' }),
    listing('bbbbb3', 's-vale', 8, { model: 'PlayStation pausada', listing_status: 'pausada' }),
    listing('bbbbb4', 's-vale', 9, { model: 'PlayStation un solo uso', kind: 'single' }),
    listing('bbbbb5', 's-vale', 10, { model: 'PlayStation pedido hijo', listing_slug: 'aaaaa2' }),
    listing('bbbbb6', 's-vale', 11, { model: 'PlayStation pagada', status: 'fondeado' }),
    listing('bbbbb7', 's-vale', 12, { model: 'PlayStation archivada', listing_status: 'archivada' }),
  ];

  const ids = (r: any) => (r.body?.items ?? []).map((i: any) => i.slug).join();
  let r = await get({ feed: '1', verified: 'all' });
  t.check('Todos: cualquier vendedor con producto activo (sin ocultos), lo más nuevo primero', r.code === 200 && ids(r) === 'ccccc1,aaaaa5,aaaaa4,aaaaa3,aaaaa2,aaaaa1', `${r.code} ${ids(r)}`);
  r = await get({ feed: '1' });
  t.check('sin filtro = Todos', ids(r) === 'ccccc1,aaaaa5,aaaaa4,aaaaa3,aaaaa2,aaaaa1', ids(r));
  r = await get({ feed: '1', verified: 'true' });
  t.check('Verificados: solo vendedores con verified=true', ids(r) === 'aaaaa5,aaaaa3,aaaaa1' && r.body.items.every((i: any) => i.seller.verified === true), ids(r));
  r = await get({ feed: '1', verified: 'false' });
  t.check('Sin verificar: solo verified=false', ids(r) === 'ccccc1,aaaaa4,aaaaa2' && r.body.items.every((i: any) => i.seller.verified === false), ids(r));
  r = await get({ feed: '1', verified: 'quizas' });
  t.check('filtro inválido -> 400', r.code === 400, `${r.code}`);
  r = await get({ feed: '1', verified: 'all' });
  const it0 = r.body?.items?.[1];
  t.check('tarjeta: vendedor (nombre, usuario, foto, estrellas, verificado), foto, título, precio y fecha', it0?.seller?.display_name === 'Valeria Mora' && it0?.seller?.store_slug === 'valeria'
    && it0?.seller?.avatar_url === 'https://x/v.jpg' && it0?.seller?.rating_avg === 4.67 && it0?.seller?.rating_count === 3 && it0?.seller?.verified === true && it0?.photo === 'https://x/aaaaa5.jpg'
    && it0?.title === 'Lámpara de escritorio' && it0?.price_crc === 10000 && it0?.created_at === at(5), JSON.stringify(it0));
  const txt = JSON.stringify(r.body);
  t.check('feed: sin datos privados (sub, correo, wallet, teléfono, identificador, descripción)', !/s-vale|s-jose|correo\.com|G1111|8888|1234567890|"sub"|seller_user_id|seller_address|contact_phone|description/.test(txt), txt.slice(0, 300));
  t.check('feed: caché corta pública', /public/.test(r.headers['cache-control'] ?? '') && /s-maxage=\d+/.test(r.headers['cache-control'] ?? ''), r.headers['cache-control']);

  r = await get({ feed: '1', verified: 'all', limit: '2' });
  const p1 = r.body?.items?.map((i: any) => i.slug) ?? [];
  const r2 = await get({ feed: '1', verified: 'all', limit: '2', cursor: r.body?.next_cursor ?? '' });
  const p2 = r2.body?.items?.map((i: any) => i.slug) ?? [];
  const r3 = await get({ feed: '1', verified: 'all', limit: '2', cursor: r2.body?.next_cursor ?? '' });
  const p3 = r3.body?.items?.map((i: any) => i.slug) ?? [];
  t.check('cursor: 3 páginas sin repetir ni saltar, la última sin next_cursor', [...p1, ...p2, ...p3].join() === 'ccccc1,aaaaa5,aaaaa4,aaaaa3,aaaaa2,aaaaa1' && !!r.body?.next_cursor && r3.body?.next_cursor === null,
    `${p1}|${p2}|${p3} ${r3.body?.next_cursor}`);
  r = await get({ feed: '1', cursor: 'nope' });
  t.check('cursor inválido -> 400 amable', r.code === 400, `${r.code}`);

  // Buscador: sin mayúsculas ni acentos, título + descripción + nombre del vendedor; respeta el filtro.
  r = await get({ feed: '1', q: 'playstation', verified: 'all' });
  t.check('buscar "playstation" (Todos): título y descripción, solo activos y no ocultos', ids(r) === 'ccccc1,aaaaa4,aaaaa3,aaaaa2', ids(r));
  r = await get({ feed: '1', q: 'PlayStation', verified: 'true' });
  t.check('buscar "PlayStation" en Verificados -> solo de verificados', ids(r) === 'aaaaa3', ids(r));
  r = await get({ feed: '1', q: 'playstation', verified: 'false' });
  t.check('buscar "playstation" en Sin verificar -> solo de no verificados', ids(r) === 'ccccc1,aaaaa4,aaaaa2', ids(r));
  r = await get({ feed: '1', q: 'PLAYSTÁTION slim', verified: 'all' });
  t.check('buscar "PLAYSTÁTION slim" (mayúsculas + acento + 2 palabras) -> PS5 Slim', ids(r) === 'aaaaa2', ids(r));
  r = await get({ feed: '1', q: 'camara', verified: 'all' });
  t.check('buscar "camara" encuentra "Cámara Canon EOS"', ids(r) === 'aaaaa1', ids(r));
  r = await get({ feed: '1', q: 'JOSE', verified: 'all' });
  t.check('buscar por nombre del vendedor ("JOSE" -> José Games)', ids(r) === 'aaaaa4,aaaaa2', ids(r));
  r = await get({ feed: '1', q: 'lampara', verified: 'false' });
  t.check('sin resultados con el filtro -> lista vacía y sin cursor', r.code === 200 && r.body?.items?.length === 0 && r.body?.next_cursor === null, JSON.stringify(r.body));
  r = await get({ feed: '1', q: 'oculta', verified: 'all' });
  t.check('vendedor oculto (listed_in_feed=false) no sale ni buscando', r.code === 200 && r.body?.items?.length === 0 && r.body?.next_cursor === null, JSON.stringify(r.body));
  r = await get({ feed: '1', q: 'x'.repeat(200) });
  t.check('búsqueda larga: se recorta sin romper', r.code === 200, `${r.code}`);

  // Sin la columna listed_in_feed (migración 017 sin aplicar): el feed sigue (todos los autorizados visibles).
  const orig = db.from; const colErr = { code: '42703', message: 'column seller_profiles.listed_in_feed does not exist' };
  (db as any).from = (tb: string) => { const q = orig(tb); const sel = q.select;
    q.select = (cols?: string) => (tb === 'seller_profiles' && /listed_in_feed/.test(String(cols ?? '')) ? Object.assign(q, { then: (ok: any) => Promise.resolve({ data: null, error: colErr }).then(ok) }) : sel(cols)); return q; };
  r = await get({ feed: '1' });
  t.check('sin migración 017: el feed funciona igual', r.code === 200 && (r.body?.items ?? []).length >= 5, `${r.code} ${JSON.stringify(r.body).slice(0, 200)}`);
  (db as any).from = orig;

  // App: debounce, eventos PostHog sin el texto buscado, input >= 16 px.
  const app = readFileSync(new URL('../../app/(tabs)/comprar.tsx', import.meta.url), 'utf8');
  const feed = readFileSync(new URL('../../components/Feed.tsx', import.meta.url), 'utf8');
  const src = app + feed;
  t.check('Comprar mantiene Importar de Facebook, Invitar a un vendedor y Pagar un link arriba', /Importar de Facebook/.test(app) && /Invitar a un vendedor/.test(app) && /Pagar un link/.test(app));
  t.check('eventos feed_viewed, feed_item_clicked y feed_search', ['feed_viewed', 'feed_item_clicked', 'feed_search'].every((e) => src.includes(`'${e}'`)));
  t.check('chips Verificados (por defecto), Sin verificar y Todos', /'Verificados'/.test(src) && /'Sin verificar'/.test(src) && /'Todos'/.test(src) && /useState<VerifiedFilter>\('true'\)/.test(src));
  t.check('feed_search manda el número de resultados y NO el texto', /track\('feed_search', \{[^}]*results/.test(src) && !/track\('feed_search', \{[^}]*\b(q|query|text)\s*[:,}]/.test(src));
  t.check('debounce ~300 ms', /SEARCH_DEBOUNCE_MS = 3\d\d/.test(src));
  t.check('input del buscador con fontSize >= 16', /searchInput: \{[^}]*fontSize: (1[6-9]|2\d)/.test(src));
}
