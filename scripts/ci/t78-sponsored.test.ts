// (78) Bloque "Patrocinado": solo patrocinios reales activos (023), identificable (Ley 7472: bloque propio + etiqueta en
//      cada tarjeta), respeta filtro y búsqueda, solo en la 1.ª página, rota por hora, sin montos ni notas, sin la tabla
//      no hay bloque; métricas de impresión/clic; "Promocionar este producto" sin cobro. Sin red.
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { __setDbForTests } from '../../api/_lib/db';
import { rotate, SPONSORED_MAX, sponsoredFor } from '../../api/_lib/sponsored';
import { BANNED_COPY, COPY } from '../../lib/copy';
import { fakeDb } from './fakedb';
import store from '../../api/store/index';

const call = async (o: { method?: string; body?: any; query?: any; guest?: string }) => {
  const r: any = { code: 0, body: null, headers: {} }; r.status = (c: number) => { r.code = c; return r; }; r.setHeader = (k: string, v: string) => { r.headers[k.toLowerCase()] = v; return r; }; r.send = (b: string) => { r.body = JSON.parse(b); return r; };
  await store({ method: o.method ?? 'GET', headers: o.guest ? { 'x-guest-key': o.guest } : {}, body: o.body ?? {}, query: o.query ?? {} }, r); return r;
};

export async function run(t: T) {
  const db = fakeDb(); __setDbForTests(db as any);
  const at = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
  db.tables.seller_profiles = [
    { sub: 's-v', store_slug: 'vale', display_name: 'Valeria', verified: true, created_at: at(900) },
    { sub: 's-u', store_slug: 'ana', display_name: 'Ana', verified: false, created_at: at(900) },
    { sub: 's-h', store_slug: 'oculto', display_name: 'Oculto', listed_in_feed: false, created_at: at(900) },
  ];
  db.tables.public_stores = [];
  const L = (slug: string, seller: string, o: Record<string, unknown> = {}) => ({ id: `id-${slug}`, slug, kind: 'listing', status: 'creado', listing_status: 'activa', listing_slug: null,
    seller_user_id: seller, brand: '', model: `Producto ${slug}`, description: null, price_crc: 25000, photos: [`https://x/${slug}.jpg`], created_at: at(5), ...o });
  db.tables.orders = [L('bici01', 's-v', { model: 'Bici de montaña' }), L('cama01', 's-u', { model: 'Cámara Canon' }), L('paus01', 's-v', { listing_status: 'pausada' }),
    L('uno001', 's-v', { kind: 'single' }), L('ocul01', 's-h'), L('otro01', 's-u'), L('vend01', 's-v', { status: 'liberado' })];

  // Sin la migración 023: el feed funciona y no hay bloque.
  let r = await call({ query: { feed: '1', order: 'rank', verified: 'all' } });
  t.check('sin 023 (sin tabla): feed 200 y sponsored = [] (sin bloque)', r.code === 200 && Array.isArray(r.body?.sponsored) && r.body.sponsored.length === 0 && r.body.items.length === 3, JSON.stringify(r.body?.sponsored));

  const S = (id: number, slug: string, seller: string, o: Record<string, unknown> = {}) => ({ id, order_slug: slug, seller_user_id: seller, starts_at: at(24), ends_at: at(-24), status: 'activa', amount_paid_crc: 5113, notes: 'SINPE ref 998877', ...o });
  db.tables.sponsored_listings = [
    S(1, 'bici01', 's-v', { amount_paid_crc: 9137 }), S(2, 'cama01', 's-u'),
    S(3, 'otro01', 's-u', { starts_at: at(-1) }),                // empieza en el futuro
    S(4, 'otro01', 's-u', { ends_at: at(1) }),                   // ya terminó
    S(5, 'otro01', 's-u', { status: 'pausada' }),                // pausado por el admin
    S(6, 'paus01', 's-v'), S(7, 'uno001', 's-v'), S(8, 'ocul01', 's-h'), S(9, 'vend01', 's-v'), // producto no disponible / oculto
    S(10, 'otro01', 's-v'),                                      // el producto es de otro vendedor
  ];
  const now = Date.UTC(2026, 9, 24, 10, 0); // hora par -> sin rotación con 2 activos
  const sp = await sponsoredFor({ verified: 'all', tokens: [] }, now);
  t.check('solo patrocinios activos, vigentes, de productos permanentes disponibles del mismo vendedor', sp.map((x) => x.slug).join() === 'bici01,cama01', sp.map((x) => x.slug).join());
  t.check('orden: lo que más pagó primero; rota cada hora', (await sponsoredFor({ verified: 'all', tokens: [] }, now + 3600e3)).map((x) => x.slug).join() === 'cama01,bici01'
    && rotate([1, 2, 3], 0).join() === '1,2,3' && rotate([1, 2, 3], 3600e3).join() === '2,3,1' && rotate([], 5).length === 0);
  const txt = JSON.stringify(sp);
  t.check('sin montos, notas ni datos privados del vendedor', !/9137|5113|amount|notes|SINPE|s-v|s-u|seller_user_id/.test(txt) && sp[0].seller.store_slug === 'vale' && sp[0].price_crc === 25000, txt);
  t.check('filtro Identidad confirmada: solo verificados', (await sponsoredFor({ verified: 'true', tokens: [] }, now)).map((x) => x.slug).join() === 'bici01');
  t.check('filtro Sin confirmar: solo sin confirmar', (await sponsoredFor({ verified: 'false', tokens: [] }, now)).map((x) => x.slug).join() === 'cama01');
  t.check('búsqueda: "camara" (sin tilde) solo la cámara', (await sponsoredFor({ verified: 'all', tokens: ['camara'] }, now)).map((x) => x.slug).join() === 'cama01');
  db.tables.sponsored_listings.push(...Array.from({ length: 9 }, (_, i) => S(100 + i, `ext00${i}`, 's-u')));
  db.tables.orders.push(...Array.from({ length: 9 }, (_, i) => L(`ext00${i}`, 's-u')));
  t.check(`como mucho ${SPONSORED_MAX} en el bloque`, (await sponsoredFor({ verified: 'all', tokens: [] }, now)).length === SPONSORED_MAX);
  db.tables.sponsored_listings = db.tables.sponsored_listings.filter((x: any) => x.id < 100);
  db.tables.orders = db.tables.orders.filter((x: any) => !x.slug.startsWith('ext'));

  r = await call({ query: { feed: '1', order: 'rank', verified: 'all' } });
  t.check('GET feed (algoritmo): bloque en la 1.ª página', r.body?.sponsored?.length === 2, JSON.stringify(r.body?.sponsored?.map((x: any) => x.slug)));
  r = await call({ query: { feed: '1', order: 'rank', verified: 'all', limit: '1' } });
  r = await call({ query: { feed: '1', order: 'rank', verified: 'all', limit: '1', cursor: r.body.next_cursor } });
  t.check('páginas siguientes: sin bloque', r.code === 200 && r.body?.sponsored === undefined);
  r = await call({ query: { feed: '1', verified: 'true', order: 'rank', q: 'bici' } });
  t.check('GET respeta filtro + búsqueda', r.body?.sponsored?.map((x: any) => x.slug).join() === 'bici01');
  r = await call({ method: 'POST', guest: 'a'.repeat(64), body: { action: 'feed', verified: 'all' } });
  t.check('POST feed (personalizado): también trae el bloque', r.code === 200 && r.body?.sponsored?.length === 2);
  db.tables.sponsored_listings.forEach((x: any) => { x.status = 'terminada'; });
  r = await call({ query: { feed: '1', order: 'rank', verified: 'all' } });
  t.check('sin patrocinios activos: sponsored = [] (la app esconde el bloque; nunca anuncios de relleno)', r.body?.sponsored?.length === 0);

  // UI
  const block = readFileSync(new URL('../../components/SponsoredBlock.tsx', import.meta.url), 'utf8');
  const feed = readFileSync(new URL('../../components/Feed.tsx', import.meta.url), 'utf8');
  const tools = readFileSync(new URL('../../components/OwnerTools.tsx', import.meta.url), 'utf8');
  const demo = readFileSync(new URL('../../lib/demoFeed.ts', import.meta.url), 'utf8');
  t.check('identificable: título "Patrocinado" del bloque + etiqueta en CADA tarjeta + accesibilidad', COPY.sponsored.label === 'Patrocinado'
    && /<Text style=\{s\.title\}>\{COPY\.sponsored\.label\}<\/Text>/.test(block) && /<View style=\{s\.tag\}><Text style=\{s\.tagText\}>\{COPY\.sponsored\.label\}/.test(block) && /COPY\.sponsored\.a11y\(it\.title\)/.test(block));
  t.check('se esconde sin patrocinios', /if \(!items\.length\) return null;/.test(block) && /sponsored\.length \? <SponsoredBlock items=\{sponsored\} filter=\{filter\} \/> : null/.test(feed));
  t.check('métricas en PostHog: sponsored_impression y sponsored_clicked (id del patrocinio, posición, filtro; sin montos)', /track\('sponsored_impression', \{ sponsored_id: it\.id, position: i, filter/.test(block) && /track\('sponsored_clicked', \{ sponsored_id: it\.id, position: i, filter/.test(block) && !/price|amount/.test((block.match(/track\([^)]*\)/g) ?? []).join()));
  t.check('"Promocionar este producto" en Mi tienda: solo una hoja "Pronto podrás…", sin cobro ni llamada al API', /title=\{COPY\.sponsored\.promote\}/.test(tools) && /COPY\.sponsored\.promoteText/.test(tools)
    && /^Pronto podrás promocionar tus productos/.test(COPY.sponsored.promoteText) && !/api\(|guestApi|fetch\(/.test(tools.slice(tools.indexOf('setPromote(true)') - 300, tools.indexOf('setPromote(true)') + 300)));
  t.check('demo: anuncios solo con ?ads=1 (no hay anuncios de relleno por defecto)', /get\('ads'\) === '1'/.test(demo) && /!cur && ads\(\)/.test(demo));
  t.check('íconos, no emojis', !/\p{Extended_Pictographic}/u.test(block + tools));
  const flat = JSON.stringify(Object.values(COPY.sponsored).map((v: any) => typeof v === 'function' ? v('Bici') : v));
  t.check('copy de Patrocinado sin palabras prohibidas', !BANNED_COPY.test(flat) && !/proteg/i.test(flat), flat);
  const mig = readFileSync(new URL('../../supabase/migrations/023_sponsored_listings.sql', import.meta.url), 'utf8');
  t.check('migración 023 idempotente: tabla, índices, RLS sin grants públicos', /create table if not exists public\.sponsored_listings/.test(mig) && /create unique index if not exists/.test(mig)
    && /enable row level security/.test(mig) && /revoke all on public\.sponsored_listings from anon, authenticated/.test(mig)
    && ['order_slug', 'seller_user_id', 'starts_at', 'ends_at', 'status', 'amount_paid_crc', 'notes'].every((c) => mig.includes(c)));
}
