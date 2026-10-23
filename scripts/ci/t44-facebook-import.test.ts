// (44) Importar de Facebook Marketplace: validación del link (SSRF), parser de OG con HTML real guardado
// (scripts/ci/fixtures/facebook, capturado el 2026-10-23), precio a colones y endpoint con fetch simulado. Sin red.
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { checkFacebookUrl, isAllowedImageHost, isAllowedPageHost, parseFbPrice, parseListingHtml, toCrc, FB_IMPORT_FAILED } from '../../api/_lib/fbparse';
import { importFacebookListing, type FetchLike } from '../../api/_lib/fbimport';

const fx = (f: string) => readFileSync(new URL(`./fixtures/facebook/${f}`, import.meta.url), 'utf8');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

/** fetch simulado: tabla url -> respuesta. Registra cada URL pedida (para verificar que nunca sale de FB). */
function fakeFetch(routes: Record<string, { status?: number; html?: string; body?: Buffer; type?: string; location?: string } | ((ua: string) => any)>) {
  const seen: string[] = [];
  const f: FetchLike = async (url, init) => {
    seen.push(url);
    const ua = String((init?.headers as any)?.['User-Agent'] ?? '');
    let r: any = routes[url];
    if (typeof r === 'function') r = r(ua);
    if (!r) return new Response('nope', { status: 404 });
    const headers: Record<string, string> = { 'content-type': r.type ?? (r.body ? 'image/jpeg' : 'text/html; charset=utf-8') };
    if (r.location) headers.location = r.location;
    return new Response(r.body ?? r.html ?? '', { status: r.status ?? (r.location ? 302 : 200), headers });
  };
  return { f, seen };
}
const IMG_CRC = 'https://scontent-sea5-1.xx.fbcdn.net/v/t45.5328-4/450226989_800967815584744_8740307984735815972_n.jpg?stp=dst-jpg_tt6&_nc_cat=1&oh=00_FIXTURE&oe=6AE0B3E3';

export async function run(t: T) {
  // --- Validación del link (SSRF): solo https facebook.com / fb.me
  const ok = (u: string) => checkFacebookUrl(u).ok;
  t.check('acepta /marketplace/item/<id>/', ok('https://www.facebook.com/marketplace/item/443277198670299/'));
  t.check('acepta /share/<code>/ con query', ok('https://www.facebook.com/share/18HroUrSak/?mibextid=wwXIfr'));
  t.check('acepta m.facebook.com y fb.me', ok('https://m.facebook.com/marketplace/item/1/') && ok('https://fb.me/abc123'));
  t.check('acepta el link pegado sin https:// y con texto alrededor', checkFacebookUrl('Mira esto facebook.com/marketplace/item/443277198670299/ ').url === 'https://facebook.com/marketplace/item/443277198670299/');
  t.check('rechaza otros dominios y trucos', ['https://facebook.com.evil.com/marketplace/item/1/', 'https://evil.com/?u=facebook.com', 'https://user@facebook.com/marketplace/item/1/',
    'http://169.254.169.254/latest/meta-data/', 'https://www.facebook.com:8443/marketplace/item/1/', 'file:///etc/passwd', 'https://notfacebook.com/marketplace/item/1/', 'https://localhost/marketplace/item/1/'].every((u) => !ok(u)));
  t.check('rechaza perfiles/páginas de facebook (no es un anuncio)', !ok('https://www.facebook.com/zuck') && !ok('https://www.facebook.com/groups/123'));
  t.check('rechaza http (sin TLS)', !ok('http://www.facebook.com/marketplace/item/1/'));
  t.check('hosts de página: facebook.com y subdominios, fb.me', isAllowedPageHost('www.facebook.com') && isAllowedPageHost('m.facebook.com') && isAllowedPageHost('fb.me') && !isAllowedPageHost('facebook.com.evil.com') && !isAllowedPageHost('evilfacebook.com'));
  t.check('hosts de imagen: solo CDN de FB', isAllowedImageHost('scontent-sea5-1.xx.fbcdn.net') && isAllowedImageHost('lookaside.fbsbx.com') && !isAllowedImageHost('fbcdn.net.evil.com') && !isAllowedImageHost('www.facebook.com'));

  // --- Precio
  const p = (s: string) => JSON.stringify(parseFbPrice(s));
  t.check('₡25.000 (punto de miles) -> 25000 CRC', p('₡25.000') === JSON.stringify({ amount: 25000, currency: 'CRC' }));
  t.check('₡18000 -> 18000 CRC', p('₡18000') === JSON.stringify({ amount: 18000, currency: 'CRC' }));
  t.check('₡1 250 000 y CRC 25,000', parseFbPrice('₡1 250 000')?.amount === 1250000 && parseFbPrice('CRC 25,000')?.amount === 25000);
  t.check('$12600 -> 12600 USD', p('$12600') === JSON.stringify({ amount: 12600, currency: 'USD' }));
  t.check('US$1,250.50 -> 1250.5 USD', p('US$1,250.50') === JSON.stringify({ amount: 1250.5, currency: 'USD' }));
  t.check('Gratis / Free / texto sin precio -> null', parseFbPrice('Gratis') === null && parseFbPrice('Free') === null && parseFbPrice('hola') === null);
  t.check('toCrc: colones enteros', toCrc({ amount: 25000, currency: 'CRC' }, 510) === 25000);
  t.check('toCrc: USD al tipo de cambio, redondeado a ₡100', toCrc({ amount: 45, currency: 'USD' }, 510) === 23000 && toCrc({ amount: 12600, currency: 'USD' }, 510) === 6426000);
  t.check('toCrc: otra moneda -> null', toCrc({ amount: 10, currency: 'EUR' }, 510) === null);

  // --- Parser con HTML real
  const crc = parseListingHtml(fx('og-crc-mobile.html'));
  t.check('OG (móvil, CR): título decodificado y recortado a 80 sin cortar palabras', crc.title === 'Grutov 800 piezas Clips de retención de empuje de coche Tornillos automotrices', crc.title ?? '');
  t.check('OG (móvil, CR): precio ₡18000 del resumen de og:description', crc.price?.amount === 18000 && crc.price?.currency === 'CRC', JSON.stringify(crc.price));
  t.check('OG (móvil, CR): una foto del CDN, &amp; decodificado', crc.images.length === 1 && crc.images[0] === IMG_CRC, crc.images[0]);
  t.check('OG (móvil): el resumen "Título - ₡…, in …" NO se toma como descripción', crc.description === null);
  t.check('OG: es un anuncio (og:url de marketplace), no muro de login', crc.isListing && !crc.loginWall);
  const dots = parseListingHtml(fx('og-crc-dots-mobile.html'));
  t.check('precio ₡25.000 dentro del og:description', dots.price?.amount === 25000 && dots.price.currency === 'CRC');
  const usd = parseListingHtml(fx('og-usd-mobile.html'));
  t.check('OG (móvil, USD): $12600', usd.price?.amount === 12600 && usd.price?.currency === 'USD' && usd.title === '2018 Honda Accord · EX Sedan 4D');
  const crawler = parseListingHtml(fx('og-usd-crawler.html'));
  t.check('OG (crawler): descripción del vendedor, multilínea', !!crawler.description && crawler.description.startsWith('Honda accord 2018') && crawler.description.includes('\n'), JSON.stringify(crawler.description));
  t.check('OG (crawler): sin precio en el resumen -> no adivina con el texto libre ($126,00)', crawler.price === null);
  const login = parseListingHtml(fx('login-wall.html'));
  t.check('muro de login: sin anuncio, sin título usable', login.loginWall && !login.isListing && login.title === null);
  const none = parseListingHtml(fx('no-listing.html'));
  t.check('página genérica "Facebook" (anuncio borrado): sin anuncio', !none.isListing && none.title === null && none.images.length === 0);
  const ld = parseListingHtml('<html><head><meta property="og:url" content="https://www.facebook.com/marketplace/item/9/"><meta property="og:title" content="Silla"><meta property="product:price:amount" content="35000"><meta property="product:price:currency" content="CRC"><script type="application/ld+json">{"@type":"Product","name":"Silla","image":["https://scontent.xx.fbcdn.net/a.jpg"],"offers":{"price":"35000","priceCurrency":"CRC"}}</script></head></html>');
  t.check('product:price:amount/currency y JSON-LD si algún día vienen', ld.price?.amount === 35000 && ld.images.includes('https://scontent.xx.fbcdn.net/a.jpg'));
  const evilImg = parseListingHtml('<head><meta property="og:url" content="https://www.facebook.com/marketplace/item/9/"><meta property="og:title" content="X"><meta property="og:image" content="http://169.254.169.254/x.jpg"></head>');
  t.check('imágenes fuera del CDN de FB se descartan', evilImg.images.length === 0);

  // --- Flujo completo con fetch simulado (redirecciones, dos user agents, foto)
  const SHARE = 'https://www.facebook.com/share/18HroUrSak/?mibextid=wwXIfr';
  const ITEM = 'https://www.facebook.com/marketplace/item/2089540198183457/';
  const IMG = 'https://scontent-sea5-1.xx.fbcdn.net/v/t39.30808-6/647343863_2359692264551760_6008189063860415395_n.jpg?stp=dst-jpg_tt6&_nc_cat=1&oh=00_FIXTURE&oe=6AE0B3E3';
  const full = fakeFetch({
    [SHARE]: (ua: string) => ({ location: ua.includes('facebookexternalhit') ? ITEM : 'https://m.facebook.com/share/18HroUrSak/' }),
    'https://m.facebook.com/share/18HroUrSak/': { html: fx('og-usd-mobile.html') },
    [ITEM]: { html: fx('og-usd-crawler.html') },
    [IMG]: { body: JPEG },
  });
  const r = await importFacebookListing(SHARE, { fetch: full.f, rate: 510 });
  t.check('share link: success con título, precio en colones, descripción y foto', r.result === 'success' && r.title === '2018 Honda Accord · EX Sedan 4D' && r.price_crc === 6426000 && !!r.description && r.photos.length === 1, JSON.stringify({ ...r, photos: r.photos.length }));
  t.check('precio original y aviso de conversión desde USD', r.price_source?.currency === 'USD' && r.price_source.amount === 12600 && r.converted === true);
  t.check('foto como data URL JPEG (se comprime y sube por la vía normal)', r.photos[0]?.startsWith('data:image/jpeg;base64,'));
  t.check('nunca pide nada fuera de facebook.com / CDN de FB', full.seen.every((u) => /^https:\/\/([a-z0-9-]+\.)*(facebook\.com|fbcdn\.net)\//.test(u)), full.seen.join(' '));
  t.check('la respuesta no incluye el link de Facebook', !JSON.stringify(r).includes('facebook.com'));

  const crcOnly = fakeFetch({ 'https://www.facebook.com/marketplace/item/443277198670299/': { html: fx('og-crc-mobile.html') }, [IMG_CRC]: { status: 403, html: 'URL signature expired' } });
  const r2 = await importFacebookListing('https://www.facebook.com/marketplace/item/443277198670299/', { fetch: crcOnly.f, rate: 510 });
  t.check('foto que no baja -> partial (título y precio igual)', r2.result === 'partial' && r2.price_crc === 18000 && r2.photos.length === 0 && r2.missing.includes('photos'), JSON.stringify(r2));
  t.check('CRC no se marca como convertido', r2.converted === false);

  const wall = fakeFetch({ 'https://www.facebook.com/marketplace/item/1/': { location: 'https://www.facebook.com/login/?next=x' }, 'https://www.facebook.com/login/?next=x': { html: fx('login-wall.html') } });
  const r3 = await importFacebookListing('https://www.facebook.com/marketplace/item/1/', { fetch: wall.f, rate: 510 });
  t.check('muro de login -> failed con mensaje amable en tuteo', r3.result === 'failed' && r3.message === FB_IMPORT_FAILED && r3.title === null && r3.photos.length === 0, JSON.stringify(r3));
  t.check('mensaje: "No pudimos leer ese anuncio, completa los datos"', FB_IMPORT_FAILED.startsWith('No pudimos leer ese anuncio') && /completa los datos/.test(FB_IMPORT_FAILED));

  const evil = fakeFetch({ 'https://www.facebook.com/marketplace/item/2/': { location: 'http://169.254.169.254/latest/meta-data/' } });
  const r4 = await importFacebookListing('https://www.facebook.com/marketplace/item/2/', { fetch: evil.f, rate: 510 });
  t.check('redirección fuera de facebook (SSRF) -> no se sigue', r4.result === 'failed' && !evil.seen.some((u) => u.includes('169.254')), evil.seen.join(' '));

  const huge = fakeFetch({ 'https://www.facebook.com/marketplace/item/3/': { html: '<html><head>' + 'x'.repeat(3_000_000) } });
  const t0 = Date.now(); const r5 = await importFacebookListing('https://www.facebook.com/marketplace/item/3/', { fetch: huge.f, rate: 510 });
  t.check('página enorme: se corta por tamaño y falla limpio', r5.result === 'failed' && Date.now() - t0 < 5000);

  const slow: FetchLike = (_u, init) => new Promise((_, rej) => { init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
  const t1 = Date.now(); const r6 = await importFacebookListing('https://www.facebook.com/marketplace/item/4/', { fetch: slow, rate: 510, timeoutMs: 300 });
  t.check('timeout: FB no responde -> failed en el tiempo límite', r6.result === 'failed' && Date.now() - t1 < 2000);

  const bigImg = fakeFetch({ 'https://www.facebook.com/marketplace/item/443277198670299/': { html: fx('og-crc-mobile.html') }, [IMG_CRC]: { body: Buffer.alloc(6_000_000, 1) } });
  const r7 = await importFacebookListing('https://www.facebook.com/marketplace/item/443277198670299/', { fetch: bigImg.f, rate: 510 });
  t.check('imagen demasiado grande se descarta', r7.photos.length === 0 && r7.result === 'partial');
  const notImg = fakeFetch({ 'https://www.facebook.com/marketplace/item/443277198670299/': { html: fx('og-crc-mobile.html') }, [IMG_CRC]: { html: '<html>', type: 'text/html' } });
  t.check('respuesta no-imagen se descarta', (await importFacebookListing('https://www.facebook.com/marketplace/item/443277198670299/', { fetch: notImg.f, rate: 510 })).photos.length === 0);
}
