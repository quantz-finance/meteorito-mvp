// (82) Productos de ejemplo en Comprar (FEED_DEMO_PRODUCTS): datos ficticios en código (nunca en la base), van DESPUÉS de
//      los reales, filtro y búsqueda funcionan, nunca en Patrocinado, tiendas /t/<demo> con reseñas, fotos en /public
//      (≤120 KB, ~800 px) y el pago es imposible (sin fila en la base, orderBySlug 409, ficha sin PayBox). Sin red.
import type { T } from './setup';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { __setDbForTests, orderBySlug } from '../../api/_lib/db';
import { DEMO_PRODUCTS, DEMO_SELLERS, decodeDemoCursor, demoList, demoPage, demoProduct, demoProfile, isDemoStoreSlug, looksLikeDemoProduct, mergeDemo } from '../../api/_lib/demoProducts';
import { BANNED_COPY, COPY } from '../../lib/copy';
import { fakeDb } from './fakedb';
import store from '../../api/store/index';

const call = async (o: { method?: string; body?: any; query?: any; guest?: string }) => {
  const r: any = { code: 0, body: null, headers: {} }; r.status = (c: number) => { r.code = c; return r; }; r.setHeader = (k: string, v: string) => { r.headers[k.toLowerCase()] = v; return r; }; r.send = (b: string) => { r.body = JSON.parse(b); return r; };
  await store({ method: o.method ?? 'GET', headers: o.guest ? { 'x-guest-key': o.guest } : {}, body: o.body ?? {}, query: o.query ?? {} }, r); return r;
};
const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
/** Ancho y alto de un JPEG (marcador SOF). */
function jpegSize(b: Buffer): { w: number; h: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1]; const len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

export async function run(t: T) {
  // --- Datos ---
  const flag = src('api/_lib/demoFlag.ts');
  t.check('flag en código: FEED_DEMO_PRODUCTS = true (un solo lugar para apagarlo)', /export const FEED_DEMO_PRODUCTS = true;/.test(flag));
  t.check(`${DEMO_PRODUCTS.length} productos (30-40) de ${DEMO_SELLERS.length} vendedores (10-12)`, DEMO_PRODUCTS.length >= 30 && DEMO_PRODUCTS.length <= 40 && DEMO_SELLERS.length >= 10 && DEMO_SELLERS.length <= 12);
  const conf = DEMO_SELLERS.filter((s) => s.verified).length;
  t.check(`identidad confirmada ~mitad (${conf}/${DEMO_SELLERS.length})`, conf >= 4 && DEMO_SELLERS.length - conf >= 4);
  const slugs = DEMO_PRODUCTS.map((x) => x.slug);
  t.check('slugs ej-… únicos (no chocan con los reales de 6 letras)', new Set(slugs).size === slugs.length && slugs.every((s) => looksLikeDemoProduct(s) && s.length > 6));
  t.check('cada producto es de un vendedor de ejemplo; cada vendedor tiene 2+ productos', DEMO_PRODUCTS.every((x) => DEMO_SELLERS.some((s) => s.store_slug === x.seller)) && DEMO_SELLERS.every((s) => DEMO_PRODUCTS.filter((x) => x.seller === s.store_slug).length >= 2));
  t.check('pocas reseñas: 0-25 calificaciones, 0-6 comentarios visibles, promedio 1-5 o null sin calificaciones', DEMO_SELLERS.every((s) => s.rating_count <= 25 && s.reviews.length <= 6 && s.reviews.length <= s.rating_count && (s.rating_count === 0 ? s.rating_avg === null : (s.rating_avg ?? 0) >= 1 && (s.rating_avg ?? 9) <= 5)) && DEMO_SELLERS.some((s) => s.rating_count === 0));
  const price = (slug: string) => DEMO_PRODUCTS.find((x) => x.slug === slug)?.price_crc;
  t.check('precios reales de Marketplace CR: iPhone 13 ₡240.000, PS5 ₡300.000; todos ₡5.000-₡1.000.000', price('ej-iphone-13') === 240000 && price('ej-ps5-lector') === 300000 && DEMO_PRODUCTS.every((x) => x.price_crc >= 5000 && x.price_crc <= 1000000 && x.price_crc % 500 === 0));
  t.check('ubicaciones de Costa Rica', DEMO_SELLERS.every((s) => /San José|Heredia|Alajuela|Cartago|Escazú|Curridabat|Desamparados|Moravia|San Pedro|Tibás|Santo Domingo/.test(s.location)));
  const bad = DEMO_PRODUCTS.filter((x) => { const f = new URL(`../../public${x.photo}`, import.meta.url); if (!existsSync(f)) return true; const b = readFileSync(f); const d = jpegSize(b); return statSync(f).size > 120 * 1024 || !d || d.w < 600 || d.w > 1000; });
  t.check('fotos en /public/demo-feed, JPEG ≤120 KB, ~800 px', bad.length === 0 && DEMO_PRODUCTS.every((x) => /^\/demo-feed\/p-[a-z0-9]+\.jpg$/.test(x.photo)), bad.map((x) => x.photo).join());
  const demoFeedSrc = src('lib/demoFeed.ts');
  const legacy = [...demoFeedSrc.matchAll(/'(\/demo-feed\/[^']+\.jpg)'/g)].map((m) => m[1]);
  t.check('modo demo: las 8 fotos de /demo-feed existen', legacy.length >= 8 && legacy.every((p) => existsSync(new URL(`../../public${p}`, import.meta.url))), legacy.filter((p) => !existsSync(new URL(`../../public${p}`, import.meta.url))).join());
  t.check('fotos servidas desde /public (sin require/import de .jpg en JS)', !/require\([^)]*demo-feed|from '[^']*demo-feed[^']*\.jpg'/.test(src('api/_lib/demoProducts.ts') + demoFeedSrc + src('components/DemoProduct.tsx')));
  const texts = [...DEMO_PRODUCTS.flatMap((x) => [x.title, x.description, x.condition]), ...DEMO_SELLERS.flatMap((s) => [s.display_name, s.bio, ...s.reviews.map((r) => r.comment ?? '')]), ...Object.values(COPY.demoProducts).map(String)];
  t.check('copy sin palabras prohibidas', texts.every((x) => !BANNED_COPY.test(x)), texts.filter((x) => BANNED_COPY.test(x)).join(' | '));
  t.check('copy en tuteo (sin voseo) y sin emojis', texts.every((x) => !/\b(vos|tenés|podés|querés|escribí|tocá|mirá|pagá)\b/i.test(x) && !/\p{Extended_Pictographic}/u.test(x)));
  // Señal SUTIL (pedido del dueño): un iconito discreto que abre un popup, sin etiquetas "Ejemplo" ni avisos grandes.
  const I = COPY.demoProducts.info;
  t.check('copy del popup: título, texto y botón exactos', I.title === 'Producto de ejemplo' && I.body === 'Lo pusimos para mostrarte cómo se ve el feed. No está a la venta.' && I.ok === 'Entendido' && I.iconLabel === 'Producto de ejemplo');
  const banned = /segur|garant[ií]a|verificad|empresa|fintech|banco|billetera|proteg/i;
  const demoCopy = JSON.stringify(COPY.demoProducts, (_k, v) => (typeof v === 'function' ? v('X', 'Y') : v));
  t.check('copy de ejemplos sin palabras prohibidas', !banned.test(demoCopy), demoCopy.match(banned)?.[0]);
  t.check('pago desactivado: motivo corto y claro', /desactivado/i.test(COPY.demoProducts.payDisabled) && COPY.demoProducts.payDisabled.length <= 30 && /no se puede pagar/.test(COPY.demoProducts.productNote) && COPY.demoProducts.productNote.length <= 50);

  // --- Funciones puras: orden, filtro, búsqueda, cursor ---
  const now = Date.UTC(2026, 9, 24, 12);
  const all = demoList({ verified: 'all', asOf: now });
  t.check('demoList all = todos, mismo orden cada vez (determinístico)', all.length === DEMO_PRODUCTS.length && all.map((x) => x.slug).join() === demoList({ verified: 'all', asOf: now }).map((x) => x.slug).join());
  const vt = demoList({ verified: 'true', asOf: now }); const vf = demoList({ verified: 'false', asOf: now });
  t.check(`filtros: confirmada ${vt.length} + sin confirmar ${vf.length} = total, ambos con contenido`, vt.length > 5 && vf.length > 5 && vt.length + vf.length === all.length && vt.every((x) => x.seller.verified) && vf.every((x) => !x.seller.verified));
  const iph = (v: 'all' | 'true' | 'false') => demoList({ q: 'iPhone', verified: v, asOf: now });
  t.check('buscar "iPhone": encuentra iPhones en los dos filtros', iph('true').length >= 2 && iph('false').length >= 2 && iph('all').every((x) => /iphone/i.test(x.title + DEMO_PRODUCTS.find((p) => p.slug === x.slug)!.description)));
  const ps = demoList({ q: 'playstation', verified: 'all', asOf: now });
  t.check('buscar "PlayStation": PS5 con lector y digital', ps.some((x) => x.slug === 'ej-ps5-lector') && ps.some((x) => x.slug === 'ej-ps5-digital'));
  t.check('buscar algo que no existe: 0', demoList({ q: 'zzzqqq', verified: 'all', asOf: now }).length === 0);
  const real = { items: [{ slug: 'aaaaa1' }, { slug: 'aaaaa2' }], next_cursor: null as string | null };
  t.check('mergeDemo: si quedan reales (next_cursor) no toca la página', mergeDemo({ ...real, next_cursor: 'r10_1' }, { verified: 'all', limit: 10, now }).items.length === 2);
  const m = mergeDemo(real, { verified: 'all', limit: 10, now });
  t.check('mergeDemo: reales primero, rellena con ejemplos hasta el límite y sigue con cursor e…', m.items.length === 10 && m.items[0].slug === 'aaaaa1' && m.items[1].slug === 'aaaaa2' && m.items.slice(2).every((i: any) => i.demo === true) && decodeDemoCursor(m.next_cursor)?.offset === 8);
  const seen = m.items.slice(2).map((i: any) => i.slug); let cur = decodeDemoCursor(m.next_cursor); let guard = 0;
  while (cur && guard++ < 20) { const p = demoPage({ verified: 'all', cursor: cur, limit: 10 }); seen.push(...p.items.map((i) => i.slug)); cur = decodeDemoCursor(p.next_cursor); }
  t.check('paginar los ejemplos: todos una sola vez y termina', seen.length === all.length && new Set(seen).size === all.length, `${seen.length}`);

  // --- Handler (feed real + ejemplos), con la base falsa ---
  process.env.FEED_DEMO_PRODUCTS = '1';
  try {
    const db = fakeDb(); __setDbForTests(db as any);
    const at = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
    db.tables.seller_profiles = [
      { sub: 's-v', store_slug: 'vale', display_name: 'Valeria', verified: true, created_at: at(900) },
      { sub: 's-u', store_slug: 'ana', display_name: 'Ana', verified: false, created_at: at(900) },
    ];
    db.tables.public_stores = [];
    const L = (slug: string, seller: string, o: Record<string, unknown> = {}) => ({ id: `id-${slug}`, slug, kind: 'listing', status: 'creado', listing_status: 'activa', listing_slug: null,
      seller_user_id: seller, brand: '', model: `Producto ${slug}`, description: null, price_crc: 25000, photos: [`https://x/${slug}.jpg`], created_at: at(5), ...o });
    db.tables.orders = [L('bici01', 's-v', { model: 'Bici de montaña' }), L('iph001', 's-u', { model: 'iPhone 12 real' })];
    db.tables.sponsored_listings = [{ id: 1, order_slug: 'bici01', seller_user_id: 's-v', starts_at: at(24), ends_at: at(-24), status: 'activa', amount_paid_crc: 5000, notes: null }];

    let r = await call({ query: { feed: '1', order: 'rank', verified: 'all', limit: '10' } });
    const items = r.body?.items ?? [];
    t.check('GET feed: los reales primero y después los ejemplos (demo: true, seller.demo)', r.code === 200 && items.length === 10 && !items[0].demo && !items[1].demo && items.slice(2).every((i: any) => i.demo === true && i.seller?.demo === true), items.map((i: any) => i.slug).join());
    t.check('Patrocinado: solo reales, nunca un ejemplo', (r.body?.sponsored ?? []).length === 1 && (r.body.sponsored as any[]).every((s) => !looksLikeDemoProduct(s.slug)));
    const got = items.map((i: any) => i.slug); let next = r.body?.next_cursor; guard = 0;
    while (next && guard++ < 10) { const p = await call({ query: { feed: '1', order: 'rank', verified: 'all', limit: '10', cursor: next } }); got.push(...p.body.items.map((i: any) => i.slug)); t.check(`página ${guard + 1}: sin Patrocinado`, (p.body.sponsored ?? []).length === 0); next = p.body.next_cursor; }
    t.check('GET feed paginado: 2 reales + todos los ejemplos, sin repetidos', got.length === 2 + DEMO_PRODUCTS.length && new Set(got).size === got.length, `${got.length}`);
    r = await call({ query: { feed: '1', order: 'rank', verified: 'false', limit: '20' } });
    t.check('filtro "Sin confirmar": el real de Ana y ejemplos sin confirmar', r.body.items[0].slug === 'iph001' && r.body.items.slice(1).every((i: any) => i.demo && !i.seller.verified) && r.body.items.length > 5);
    r = await call({ query: { feed: '1', order: 'rank', verified: 'true', q: 'iPhone', limit: '20' } });
    t.check('buscar "iPhone" con identidad confirmada: solo ejemplos confirmados', r.body.items.length >= 2 && r.body.items.every((i: any) => i.seller.verified && /iphone/i.test(i.title)));
    r = await call({ query: { feed: '1', order: 'rank', verified: 'all', q: 'PlayStation', limit: '20' } });
    t.check('buscar "PlayStation": aparecen los PS5 de ejemplo', r.body.items.some((i: any) => i.slug === 'ej-ps5-lector'));
    r = await call({ method: 'POST', guest: 'e'.repeat(64), body: { action: 'feed', verified: 'all', limit: '20' } });
    t.check('POST feed (personalizado) también trae los ejemplos después de los reales', r.code === 200 && !r.body.items[0].demo && r.body.items.some((i: any) => i.demo));
    r = await call({ query: { feed: '1', verified: 'all' } });
    t.check('orden cronológico (sin order=rank): sin ejemplos', r.code === 200 && r.body.items.every((i: any) => !i.demo));

    r = await call({ query: { profile: 'tecno-sabana' } });
    t.check('/t/tecno-sabana: tienda de ejemplo con productos y reseñas', r.code === 200 && r.body.demo === true && r.body.verified === true && r.body.items.length >= 2 && r.body.reviews.length >= 1 && r.body.whatsapp === null);
    r = await call({ query: { profile: 'kevin-mora' } });
    t.check('/t/kevin-mora: sin confirmar', r.code === 200 && r.body.demo === true && r.body.verified === false);
    t.check('slugs de tiendas de ejemplo reservados', isDemoStoreSlug('tecno-sabana') && !isDemoStoreSlug('vale') && /isDemoStoreSlug\(/.test(src('api/store/index.ts')));

    process.env.FEED_DEMO_PRODUCTS = '0';
    r = await call({ query: { feed: '1', order: 'rank', verified: 'all', limit: '20' } });
    t.check('flag apagado: el feed solo tiene reales', r.code === 200 && r.body.items.length === 2 && r.body.items.every((i: any) => !i.demo));
    r = await call({ query: { profile: 'tecno-sabana' } });
    t.check('flag apagado: /t/<ejemplo> = 404', r.code === 404);
  } finally { process.env.FEED_DEMO_PRODUCTS = '0'; }

  // --- Pago imposible ---
  let err: any = null; try { await orderBySlug('ej-iphone-13'); } catch (e) { err = e; }
  t.check('orderBySlug(ej-…) = 409 demo_product (ningún flujo de pago lo encuentra)', err?.status === 409 && err?.code === 'demo_product', String(err?.code ?? err));
  const dp = demoProduct('ej-iphone-13');
  t.check('demoProduct: payable false, demo true, con vendedor y ubicación', dp?.payable === false && dp.demo === true && !!dp.location && dp.seller.store_slug === 'tecno-sabana' && demoProduct('ej-nada') === null);
  t.check('demoProfile de una tienda real = null', demoProfile('vale') === null);
  const page = src('app/p/[slug].tsx'); const ui = src('components/DemoProduct.tsx').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  t.check('/p/ej-…: muestra DemoProductPage antes de cargar la ficha real', /looksLikeDemoProduct\([^)]*\)+\s*return <DemoProductPage/.test(page) && /function LinkDeVentaReal/.test(page));
  t.check('ficha de ejemplo: sin PayBox ni llamadas de pago; botón desactivado', !/PayBox|['"]\/api\/|fetch\(/.test(ui) && /testID="demo-pay-disabled"/.test(ui) && /disabled/.test(ui));
  t.check('ficha de ejemplo carga los datos en diferido (no infla el bundle inicial)', /import\('\.\.\/api\/_lib\/demoProducts'\)/.test(ui) && !/from '\.\.\/api\/_lib\/demoProducts'/.test(ui));
  const feed = src('components/Feed.tsx'); const st = src('app/t/[store].tsx');
  const strip = (x: string) => x.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const info = strip(src('components/DemoInfo.tsx'));
  t.check('DemoInfo: icono chico con accessibilityLabel y popup (Modal) con título, texto y Entendido', /accessibilityLabel=\{[^}]*iconLabel/.test(info) && /testID="demo-info"/.test(info) && /<Modal/.test(info) && /testID="demo-info-popup"/.test(info) && /COPY\.demoProducts\.info\b/.test(info) && /\.title\}/.test(info) && /\.body\}/.test(info) && /\.ok\}/.test(info) && /information-circle-outline/.test(info));
  t.check('DemoInfo: tocar el icono no navega (stopPropagation)', /stopPropagation/.test(info));
  const fe = strip(feed), sto = strip(st), pr = strip(src('components/DemoProduct.tsx'));
  t.check('feed: tarjeta de ejemplo con <DemoInfo>, sin etiqueta "Ejemplo"', /it\.demo \? <DemoInfo/.test(fe) && !/feed-demo-tag|COPY\.demoProducts\.tag|feed-sale-example/.test(fe));
  t.check('tienda de ejemplo: <DemoInfo>, sin etiqueta ni nota grande', /<DemoInfo/.test(sto) && !/store-demo-tag|store-demo-note|COPY\.demoProducts\.tag/.test(sto));
  t.check('ficha de ejemplo: <DemoInfo>, sin aviso grande ni chip "Ejemplo"', /<DemoInfo/.test(pr) && !/demo-product-notice|COPY\.demoProducts\.tag|productNoteTitle/.test(pr));
}
