// (63) "Importar de un link" (Facebook, Mercado Libre, Encuentra24, Amazon, AliExpress, Walmart y fallback genérico):
//  - proveedor por dominio (todos los de Mercado Libre, links cortos) y rechazo de links internos;
//  - SSRF estricto con red SIMULADA: IP privada / link-local / metadata / IPv6 mapeada, redirección a host interno,
//    DNS con una sola IP interna, demasiadas redirecciones, tamaño, content-type, tiempo; la conexión usa la IP validada;
//  - parsers con HTML REAL guardado por proveedor (scripts/ci/fixtures/import, 2026-10-24) + sintéticos para JSON-LD/OG/microdata;
//  - precio sugerido en colones, endpoint /api/store import_listing (identidad, 400, límite) y source_url en el producto;
//  - UX: textos visibles sin palabras prohibidas, eventos import_started/succeeded/failed con provider. Sin red.
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { checkListingUrl, providerForHost, listingSource, IMPORT_FAILED, PROVIDERS, SUPPORTED } from '../../api/_lib/importers/providers';
import { checkUrl, isPublicIp, safeGet, ImportNetError, type NetDeps, type RawResponse } from '../../api/_lib/importers/net';
import { parseFor, suggestCrc, cutDescription, DESC_MAX } from '../../api/_lib/importers/parse';
import { importListing, __setImportNetForTests, isImageBytes } from '../../api/_lib/importers';
import { importNotice, importProps, supportedLabel, detectProvider } from '../../lib/listingImport';
import { installTestJwks, res, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { fakeDb } from './fakedb';
import { listingPhotoOk } from '../../api/_lib/capture';
import store from '../../api/store/index';

const fx = (f: string) => readFileSync(new URL(`./fixtures/import/${f}`, import.meta.url), 'utf8');
const read = (f: string) => readFileSync(f, 'utf8');
const AVIF = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypavif'), Buffer.alloc(24)]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
type Route = { status?: number; body?: string | Buffer; type?: string; location?: string; length?: number; hang?: boolean; chunks?: number };

/** Red simulada: DNS (host -> IPs) y respuestas por URL. Registra cada conexión con la IP usada. */
function fakeNet(dns: Record<string, string[]>, routes: Record<string, Route>) {
  const conns: { url: string; ip: string; ua: string }[] = [];
  const net: NetDeps = {
    resolve: async (h) => { if (!dns[h]) throw new Error('NXDOMAIN'); return dns[h]; },
    request: async (url, ip, headers, signal): Promise<RawResponse> => {
      conns.push({ url: url.toString(), ip, ua: headers['User-Agent'] });
      const r = routes[url.toString()] ?? { status: 404, body: 'nope', type: 'text/plain' };
      if (r.hang) await new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted'))));
      const body = typeof r.body === 'string' ? Buffer.from(r.body) : r.body ?? Buffer.alloc(0);
      const headers2: Record<string, string> = { 'content-type': r.type ?? 'text/html; charset=utf-8' };
      if (r.location) headers2.location = r.location;
      if (r.length) headers2['content-length'] = String(r.length);
      return { status: r.status ?? (r.location ? 302 : 200), headers: headers2, destroy: () => {},
        body: (async function* () { for (let i = 0; i < (r.chunks ?? 1); i++) yield body; })() };
    },
  };
  return { net, conns };
}
const PUB = ['151.101.1.1'];
const H = { kind: 'html' as const, ua: 'test', maxBytes: 64 * 1024, timeoutMs: 1500 };
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return e instanceof ImportNetError ? e.code : 'other:' + (e as Error).message; } };

export async function run(t: T) {
  // --- Proveedor por dominio
  const prov = (u: string) => { const c = checkListingUrl(u); return c.ok ? c.provider.id : 'invalid'; };
  const meli = ['com.mx', 'com.ar', 'com.co', 'cl', 'com.pe', 'com.uy', 'com.ec', 'com.ve'].map((tld) => `https://articulo.mercadolibre.${tld}/MLX-123-x-_JM`);
  t.check('Mercado Libre: todos los dominios + articulo.* + .com.br (mercadolivre) + meli.la', [...meli, 'https://produto.mercadolivre.com.br/MLB-1-x', 'https://www.mercadolibre.com.mx/p/MLM1', 'https://meli.la/2AbCd'].every((u) => prov(u) === 'mercadolibre'));
  t.check('Encuentra24 (CR y Centroamérica)', ['https://www.encuentra24.com/costa-rica-es/x/1', 'https://www.encuentra24.com/panama-es/x/2', 'https://encuentra24.com/guatemala-es/x/3'].every((u) => prov(u) === 'encuentra24'));
  t.check('Amazon: .com, .com.mx, .com.br, a.co y amzn.to', ['https://www.amazon.com/dp/B0', 'https://www.amazon.com.mx/x/dp/B0', 'https://www.amazon.com.br/dp/B0', 'https://a.co/d/abc', 'https://amzn.to/3x'].every((u) => prov(u) === 'amazon'));
  t.check('AliExpress, Walmart (cr, mx), Facebook', prov('https://es.aliexpress.com/item/1.html') === 'aliexpress' && prov('https://www.walmart.co.cr/x/p') === 'walmart' && prov('https://super.walmart.com.mx/ip/x/1') === 'walmart' && prov('https://www.facebook.com/marketplace/item/1/') === 'facebook');
  t.check('Shopee, OLX, Falabella y Temu: detectados pero marcados "blocked" (documentado)', ['shopee', 'olx', 'falabella', 'temu'].every((id) => PROVIDERS.find((p) => p.id === id)?.status === 'blocked') && providerForHost('shopee.com.br')?.id === 'shopee');
  t.check('otro sitio https -> fallback genérico "web"; texto alrededor y sin https:// se acepta', prov('https://tienda.example.cr/p/1') === 'web' && prov('Mira esto: encuentra24.com/costa-rica-es/x/1 ¿te sirve?') === 'encuentra24');
  const rejected = ['http://localhost/x', 'https://127.0.0.1/', 'https://10.0.0.1/admin', 'https://[::1]/', 'javascript:alert(1)', 'ftp://x.com/a', 'https://user:pw@tienda.com/', 'https://tienda.com:8080/', 'https://router.local/', 'https://metadata.google.internal/', 'hola', ''];
  t.check('links internos, IPs, otros esquemas, credenciales y puertos: rechazados', rejected.every((u) => !checkListingUrl(u).ok), rejected.filter((u) => checkListingUrl(u).ok).join(' '));
  t.check('detectProvider (cliente) muestra el nombre mientras carga', detectProvider('https://articulo.mercadolibre.com.co/MCO-1')?.name === 'Mercado Libre' && detectProvider('https://tienda.example.cr/x')?.name === 'tienda.example.cr' && detectProvider('nada') === null);

  // --- SSRF: IPs
  const priv = ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.5.4', '192.168.1.1', '100.64.0.1', '0.0.0.0', '198.18.0.1', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd00:ec2::254', '::ffff:10.0.0.1', '::ffff:169.254.169.254', '64:ff9b::a9fe:a9fe', '2002:a9fe:a9fe::1'];
  t.check('isPublicIp: privadas, loopback, link-local, metadata (v4 y v6), CGNAT, mapeadas, NAT64, 6to4 -> NO públicas', priv.every((ip) => !isPublicIp(ip)), priv.filter(isPublicIp).join(' '));
  t.check('isPublicIp: públicas sí', ['8.8.8.8', '151.101.1.1', '2606:4700::6810:1', '2a03:2880:f10c::1'].every(isPublicIp));
  t.check('checkUrl: http, puerto, credenciales y nombres internos -> error', ['http://a.com/', 'https://a.com:444/', 'https://u:p@a.com/', 'https://localhost/', 'https://x.internal/', 'https://metadata/'].every((u) => { try { checkUrl(u); return false; } catch { return true; } }));

  // --- SSRF: red simulada
  let n = fakeNet({ 'shop.example': ['10.0.0.5'] }, {});
  t.check('host que resuelve a IP privada -> private_ip, sin conectar', (await code(safeGet('https://shop.example/p', H, n.net))) === 'private_ip' && n.conns.length === 0);
  n = fakeNet({ 'shop.example': ['151.101.1.1', '127.0.0.1'] }, {});
  t.check('DNS con UNA sola IP interna entre públicas -> rechazado', (await code(safeGet('https://shop.example/p', H, n.net))) === 'private_ip' && n.conns.length === 0);
  const redirs: [string, string][] = [['http://169.254.169.254/latest/meta-data/', 'bad_url'], ['https://169.254.169.254/latest/meta-data/', 'private_ip'], ['https://[fd00:ec2::254]/', 'private_ip'],
    ['https://metadata.google.internal/computeMetadata/v1/', 'blocked_host'], ['https://intranet.shop.example/', 'private_ip'], ['https://shop.example:8443/', 'bad_url']];
  let allRedir = true;
  for (const [to, want] of redirs) {
    n = fakeNet({ 'shop.example': PUB, 'intranet.shop.example': ['192.168.0.10'] }, { 'https://shop.example/p': { location: to } });
    const got = await code(safeGet('https://shop.example/p', H, n.net));
    if (got !== want || n.conns.length !== 1) { allRedir = false; t.check(`redirección a ${to}`, false, `${got} conns=${n.conns.length}`); }
  }
  t.check('redirección a host interno / metadata / http / otro puerto: bloqueada antes de conectar', allRedir);
  n = fakeNet({ 'shop.example': PUB }, { 'https://shop.example/p': { location: '/p' } });
  t.check('redirecciones infinitas -> too_many_redirects', (await code(safeGet('https://shop.example/p', H, n.net))) === 'too_many_redirects' && n.conns.length === 6);
  n = fakeNet({ 'shop.example': PUB }, { 'https://shop.example/p': { body: 'x'.repeat(40 * 1024), chunks: 3 } });
  t.check('cuerpo más grande que el máximo (sin content-length) -> too_large', (await code(safeGet('https://shop.example/p', H, n.net))) === 'too_large');
  n = fakeNet({ 'shop.example': PUB }, { 'https://shop.example/p': { body: 'x', length: 10 * 1024 * 1024 } });
  t.check('content-length más grande que el máximo -> too_large', (await code(safeGet('https://shop.example/p', H, n.net))) === 'too_large');
  n = fakeNet({ 'shop.example': PUB }, { 'https://shop.example/p': { body: '{}', type: 'application/json' }, 'https://shop.example/i.jpg': { body: '<html>', type: 'text/html' } });
  t.check('content-type: página no-html y "foto" html -> bad_type', (await code(safeGet('https://shop.example/p', H, n.net))) === 'bad_type' && (await code(safeGet('https://shop.example/i.jpg', { ...H, kind: 'image' }, n.net))) === 'bad_type');
  n = fakeNet({ 'shop.example': PUB }, { 'https://shop.example/p': { hang: true } });
  const t0 = Date.now(); const to = await code(safeGet('https://shop.example/p', { ...H, timeoutMs: 300 }, n.net));
  t.check('servidor que no responde -> timeout a tiempo', to === 'timeout' && Date.now() - t0 < 1500, `${to} ${Date.now() - t0}ms`);
  n = fakeNet({ 'shop.example': PUB, 'cdn.example': ['151.101.2.2'] }, { 'https://shop.example/p': { location: 'https://cdn.example/q' }, 'https://cdn.example/q': { body: '<html></html>' } });
  const okr = await safeGet('https://shop.example/p', H, n.net);
  t.check('redirección pública válida se sigue y cada conexión usa la IP validada de SU host (DNS fijado)', okr.url === 'https://cdn.example/q' && n.conns[0].ip === '151.101.1.1' && n.conns[1].ip === '151.101.2.2');

  // --- Parsers con HTML real (y sintéticos)
  const e24 = parseFor('encuentra24', fx('encuentra24-giant-talon.html'), 'https://www.encuentra24.com/costa-rica-es/anuncios-clasificados-deportes-y-ocio-bicicletas/giant-talon-0/32518390');
  t.check('Encuentra24 (real): título sin el lugar, ₡300 000, descripción del vendedor y 6 fotos del anuncio', e24.title === 'Giant Talon 0' && e24.price?.amount === 300000 && e24.price.currency === 'CRC'
    && /Shimano Deore 12 V/.test(e24.description ?? '') && e24.images.length === 6 && e24.images.every((u) => u.includes('/32518390_') && u.includes('/t_or_fh_l/v1/') && !u.includes('f_auto')), JSON.stringify({ ...e24, images: e24.images.length }));
  const e24b = parseFor('encuentra24', fx('encuentra24-trek-emonda.html'), 'https://www.encuentra24.com/costa-rica-es/anuncios-clasificados-deportes-y-ocio-bicicletas/trek-emonda-sl-5-talla-54-excelente-estado/32852926');
  t.check('Encuentra24 (real, 2): ₡850 000 y descripción sin escapes (\\r, \\n)', e24b.price?.amount === 850000 && !/\\[rn]/.test(e24b.description ?? '') && (e24b.description ?? '').length <= DESC_MAX, (e24b.description ?? '').slice(0, 60));
  const amz = parseFor('amazon', fx('amazon-mx-kubor.html'), 'https://www.amazon.com.mx/KUBOR/dp/B0BDMYQ3DH');
  t.check('Amazon MX (real): título, MXN 7 238.99, viñetas como descripción y fotos grandes', /^KUBOR Bicicleta de Montaña Calipso 3/.test(amz.title ?? '') && amz.price?.amount === 7238.99 && amz.price.currency === 'MXN'
    && !!amz.description && amz.images.length >= 4 && amz.images.every((u) => u.startsWith('https://m.media-amazon.com/images/I/')), JSON.stringify({ ...amz, images: amz.images.length }));
  const ali = parseFor('aliexpress', fx('aliexpress-wheeltop.html'), 'https://es.aliexpress.com/item/1005009077761136.html');
  t.check('AliExpress (real): título y foto por Open Graph; sin precio (no lo publica sin JS) y sin la descripción genérica', /^Wheeltop GEX OX2\.0/.test(ali.title ?? '') && ali.images.length === 1 && !ali.price && !ali.description);
  const wcr = parseFor('walmart', fx('walmart-cr-vino.html'), 'https://www.walmart.co.cr/vino-bicicleta-cono-sur-merlot-750ml/p');
  t.check('Walmart CR (real): JSON-LD Product con AggregateOffer en CRC', /^Vino tinto Bicicleta merlot/.test(wcr.title ?? '') && wcr.price?.amount === 8500 && wcr.price.currency === 'CRC' && wcr.images.length === 1);
  const ml = parseFor('mercadolibre', fx('mercadolibre-producto-sintetico.html'), 'https://articulo.mercadolibre.com.mx/MLM-1770588108-x-_JM');
  t.check('Mercado Libre (JSON-LD): título, MXN 11 515.85 y fotos del JSON-LD primero', ml.title === 'Bicicleta Gravel Andes Mtb De Montaña R29 24v Shimano Altus' && ml.price?.amount === 11515.85 && ml.images[0].includes('111111'));
  const og = parseFor('web', fx('web-og-solo.html'), 'https://tienda.example.cr/p/silla');
  t.check('fallback genérico Open Graph: entidades decodificadas, product:price, foto relativa -> absoluta', og.title === 'Silla de oficina ergonómica & reclinable' && og.price?.amount === 45000 && og.images[0] === 'https://tienda.example.cr/img/silla.jpg');
  const md = parseFor('web', fx('web-microdata.html'), 'https://tienda.example/guitarra');
  t.check('fallback genérico microdata: itemprop price/priceCurrency', md.title === 'Guitarra acústica Yamaha F310' && md.price?.amount === 120.5 && md.price.currency === 'USD');
  t.check('descripción recortada a 500 con elipsis', (cutDescription('palabra '.repeat(200)) ?? '').length <= DESC_MAX && /…$/.test(cutDescription('palabra '.repeat(200)) ?? ''));

  // --- Precio sugerido
  t.check('precio: CRC tal cual; USD y MXN a colones (sugerencia, ₡100); moneda volátil (ARS) -> null', suggestCrc({ amount: 300000, currency: 'CRC' }, 505) === 300000
    && suggestCrc({ amount: 100, currency: 'USD' }, 505) === 50500 && suggestCrc({ amount: 7238.99, currency: 'MXN' }, 505) === 197400 && suggestCrc({ amount: 100000, currency: 'ARS' }, 505) === null);

  // --- importListing de punta a punta (red simulada)
  const E24 = 'https://www.encuentra24.com/costa-rica-es/anuncios-clasificados-deportes-y-ocio-bicicletas/giant-talon-0/32518390';
  const photoRoutes = Object.fromEntries(e24.images.map((u) => [u, { body: JPEG, type: 'image/jpeg' }]));
  n = fakeNet({ 'www.encuentra24.com': PUB, 'photos.encuentra24.com': ['151.101.9.9'] }, { [E24 + '?utm_source=whatsapp']: { body: fx('encuentra24-giant-talon.html') }, ...photoRoutes });
  let r = await importListing(E24 + '?utm_source=whatsapp#fotos', { rate: 505, net: n.net });
  t.check('Encuentra24 completo: success, 4 fotos JPEG (sin f_auto, que sirve AVIF) -> data URL, source_url sin query', r.result === 'success' && r.provider === 'encuentra24' && r.photos.length === 4 && r.photos.every((p) => p.startsWith('data:image/jpeg;base64,'))
    && r.source_url === E24 && r.price_crc === 300000 && !r.converted, JSON.stringify({ ...r, photos: r.photos.length }));
  t.check('bytes de imagen verificados (no basta el content-type)', !isImageBytes(AVIF) && isImageBytes(JPEG) && !isImageBytes(Buffer.from('<html>hola</html>')));
  n = fakeNet({ 'a.co': PUB, 'www.amazon.com.mx': ['151.101.3.3'], 'm.media-amazon.com': ['151.101.4.4'] }, { 'https://a.co/d/xyz': { status: 301, location: 'https://www.amazon.com.mx/KUBOR/dp/B0BDMYQ3DH?ref=x' },
    'https://www.amazon.com.mx/KUBOR/dp/B0BDMYQ3DH?ref=x': { body: fx('amazon-mx-kubor.html') }, ...Object.fromEntries(amz.images.map((u) => [u, { body: JPEG, type: 'image/jpeg' }])) });
  r = await importListing('https://a.co/d/xyz', { rate: 505, net: n.net });
  t.check('link corto a.co -> redirección validada a Amazon MX; precio MXN convertido como sugerencia', r.provider === 'amazon' && r.source_url === 'https://www.amazon.com.mx/KUBOR/dp/B0BDMYQ3DH' && r.converted && r.price_crc === 197400 && r.photos.length === 4);
  n = fakeNet({ 'articulo.mercadolibre.com.mx': PUB, 'www.mercadolibre.com.mx': PUB }, { 'https://articulo.mercadolibre.com.mx/MLM-1-x-_JM': { location: 'https://www.mercadolibre.com.mx/gz/account-verification?go=x' },
    'https://www.mercadolibre.com.mx/gz/account-verification?go=x': { body: fx('mercadolibre-verificacion.html') } });
  r = await importListing('https://articulo.mercadolibre.com.mx/MLM-1-x-_JM', { rate: 505, net: n.net });
  t.check('Mercado Libre con muro de verificación (lo que ve un servidor) -> failed "wall" y mensaje amable', r.result === 'failed' && r.code === 'wall' && r.message === IMPORT_FAILED && r.provider === 'mercadolibre');
  n = fakeNet({}, {});
  r = await importListing('https://sp.olx.com.br/sao-paulo/ciclismo/bici-123', { rate: 505, net: n.net });
  t.check('proveedor bloqueado (OLX) -> failed sin tocar la red', r.result === 'failed' && r.code === 'provider_blocked' && n.conns.length === 0);
  n = fakeNet({ 'evil.example': ['169.254.169.254'] }, {});
  r = await importListing('https://evil.example/latest/meta-data/', { rate: 505, net: n.net });
  t.check('fallback genérico hacia metadata (DNS a 169.254.169.254) -> failed private_ip, sin conectar', r.result === 'failed' && r.code === 'private_ip' && n.conns.length === 0);
  n = fakeNet({ 'tienda.example.cr': PUB }, { 'https://tienda.example.cr/p/silla': { body: fx('web-og-solo.html') }, 'https://tienda.example.cr/img/silla.jpg': { location: 'https://10.0.0.8/silla.jpg' } });
  r = await importListing('https://tienda.example.cr/p/silla', { rate: 505, net: n.net });
  t.check('foto que redirige a una IP interna: se descarta (los datos sí llegan, partial)', r.result === 'partial' && r.missing.join() === 'photos' && r.title === 'Silla de oficina ergonómica & reclinable' && !n.conns.some((c) => c.url.includes('10.0.0.8')));

  // --- Endpoint /api/store import_listing
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  __setDbForTests(fakeDb() as any);
  n = fakeNet({ 'www.encuentra24.com': PUB, 'photos.encuentra24.com': ['151.101.9.9'] }, { [E24]: { body: fx('encuentra24-giant-talon.html') }, ...photoRoutes });
  __setImportNetForTests(n.net);
  const call = async (body: any, o: { guest?: string; tok?: string; ip?: string } = {}) => { const rr = res(); await (store as any)({ method: 'POST', headers: { ...(o.guest ? { 'x-guest-key': o.guest } : {}), ...(o.tok ? { authorization: `Bearer ${o.tok}` } : {}), 'x-forwarded-for': o.ip ?? '203.0.113.50' }, body, query: {} }, rr); return rr as any; };
  try {
    let e = await call({ action: 'import_listing', url: E24 });
    t.check('import_listing sin sesión ni llave -> 401', e.code === 401, `${e.code}`);
    const tok = await token({ sub: 'seller-imp-63' });
    e = await call({ action: 'import_listing', url: 'http://169.254.169.254/latest/meta-data/' }, { tok });
    t.check('import_listing con link interno -> 400 import_url_invalid', e.code === 400 && e.body?.code === 'import_url_invalid', JSON.stringify(e.body));
    e = await call({ action: 'import_listing', url: E24 }, { tok });
    t.check('import_listing vendedor -> 200 con provider, source_url y fotos', e.code === 200 && e.body.provider === 'encuentra24' && e.body.photos.length === 4 && e.body.source_url === E24);
    const pu: (string | null)[] = e.body.photo_urls ?? [];
    t.check('fotos guardadas por el servidor (#68): photo_urls en orden, válidas solo con ese source_url y ese vendedor', pu.length === 4 && pu.every((u) => !!u && listingPhotoOk(u, 'seller-imp-63', e.body.source_url))
      && !listingPhotoOk(pu[0], 'seller-imp-63', 'https://www.encuentra24.com/otro') && !listingPhotoOk(pu[0], 'otro-vendedor', e.body.source_url), JSON.stringify(pu));
    let last = 0; for (let i = 0; i < 9; i++) last = (await call({ action: 'import_listing', url: E24 }, { tok })).code;
    t.check('límite compartido con Facebook (8/min por identidad) -> 429', last === 429, `${last}`);
  } finally { __setImportNetForTests(null); }

  // --- Origen en el producto + cliente + UX
  t.check('listingSource: link https válido + proveedor; interno o largo -> nada', listingSource(E24, 'encuentra24').source_provider === 'encuentra24' && !listingSource('https://10.0.0.1/x', 'web').source_url && !listingSource('https://a.com/' + 'x'.repeat(1200), 'web').source_url);
  const create = read('api/orders/create.ts');
  t.check('orders/create guarda source_url/source_provider y reintenta sin columnas (migración 019)', /listingSource\(b\.source_url, b\.source_provider\)/.test(create) && /missingColumn\(error\) && Object\.keys\(source\)\.length/.test(create)
    && /source_url text/.test(read('supabase/migrations/019_listing_source.sql')) && /source_provider text/.test(read('supabase/migrations/019_listing_source.sql')));
  t.check('pantalla: "Facebook, Mercado Libre, Encuentra24 y más" sale de los proveedores que funcionan', supportedLabel() === `${SUPPORTED.slice(0, 3).map((p) => p.name).join(', ')} y más` && SUPPORTED.every((p) => p.status === 'ok'));
  const props = importProps({ provider: 'amazon', result: 'success', title: 'X secreto', price_crc: 1, photos: ['a'], description: 'd', converted: true });
  t.check('analítica: provider y banderas, nunca URL, título ni precio', props.provider === 'amazon' && !JSON.stringify(props).includes('secreto') && !('url' in props) && !('price_crc' in props));
  const ven = read('app/(tabs)/vender.tsx');
  t.check('Vender: un solo campo "Pega el link de tu anuncio", proveedor detectado, skeleton y error amable', /placeholder="Pega el link de tu anuncio"/.test(ven) && /testID="import-provider"/.test(ven) && /testID="import-skeleton"/.test(ven) && /setFbErr\(IMPORT_FAILED\)/.test(ven));
  t.check('eventos import_started / import_succeeded / import_failed con provider', /track\('import_started', \{ provider \}\)/.test(ven) && /track\('import_succeeded', importProps\(r\)\)/.test(ven) && (ven.match(/track\('import_failed', \{ provider/g) ?? []).length === 2
    && ['import_started', 'import_succeeded', 'import_failed'].every((e) => read('docs/tracking-plan.md').includes('`' + e + '`')));
  // Textos visibles nuevos: sin las palabras prohibidas.
  const sheet = ven.slice(ven.indexOf('title="Importar de un link"'), ven.indexOf('</Sheet>', ven.indexOf('title="Importar de un link"')));
  const visible = [sheet, IMPORT_FAILED, supportedLabel(), JSON.stringify(importNotice({ result: 'partial', provider: 'amazon', provider_name: 'Amazon', source_url: null, title: null, price_crc: 1, price_source: { amount: 1, currency: 'USD' }, converted: true, description: null, photos: [], missing: ['title'] })),
    JSON.stringify(importNotice({ result: 'success', provider: 'encuentra24', provider_name: 'Encuentra24', source_url: null, title: 'a', price_crc: 1, price_source: null, converted: false, description: null, photos: ['x'], missing: [] }))].join(' ');
  const banned = visible.match(/\b(segur[oa]s?|garant[ií]as?|empresas?|fintech|bancos?|billeteras?)\b/gi);
  t.check('copy sin "seguro", "garantía", "empresa", "fintech", "banco" ni "billetera"', !banned, String(banned));
  t.check('Vender sin emojis en el import', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(sheet));
}
