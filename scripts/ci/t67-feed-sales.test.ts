// (67) Feed de Comprar: ventas cerradas. Hoy SOLO ejemplos ficticios (api/_lib/demoSales.ts), con un iconito discreto (i), sin montos,
// solo con "Datos de ejemplo" encendido (el servidor las manda), mezclados 1 de cada 6 tarjetas y respetando el filtro de identidad. Ventas reales: no (falta opt-in).
import { existsSync, readFileSync } from 'node:fs';
import type { T } from './setup';
import { isSale, mixFeed as mix, SALE_EVERY, saleHeadline, saleLabel, saleStars, type SalePost } from '../../lib/feedSales';
import { DEMO_SALES } from '../../api/_lib/demoSales';
import { COPY } from '../../lib/copy';

const BANNED = /segur|garant|verificad|empresa|fintech|banco|billetera|proteg/i;
const VOSEO = /\b(tenés|podés|querés|tocá|mirá|escribí|fijate)\b/i;
/** Con las ventas que manda el servidor cuando "Datos de ejemplo" está encendido. */
const mixFeed = <X>(it: X[], f: any, q: string, sales: SalePost[] = DEMO_SALES) => mix(it, f, q, sales);
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ slug: `p${i}` }));

export async function run(t: T) {
  t.check('sin flag en código: sin ventas del servidor no se mezcla nada (apagado = solo publicaciones)', !/FEED_DEMO_SALES/.test(readFileSync('lib/feedSales.ts', 'utf8')) && mix(items(12), 'true', '').length === 12);
  t.check('todas las ventas son ejemplos ficticios, con confirmados y sin confirmar', DEMO_SALES.length >= 4 && DEMO_SALES.every((s) => s.example === true && s.kind === 'sale')
    && DEMO_SALES.some((s) => s.verified) && DEMO_SALES.some((s) => !s.verified));
  const feedSrc = readFileSync('components/Feed.tsx', 'utf8');
  t.check('iconito discreto (sin etiqueta "Ejemplo" visible) y hoja que lo explica', /testID="feed-sale-info"/.test(feedSrc) && !/COPY\.sales\.example|feed-sale-example/.test(feedSrc)
    && /ejemplo/i.test(COPY.sales.sheetTitle) && /ficticios/.test(COPY.sales.sheetText));
  const p = DEMO_SALES[0];
  t.check('"María R. le vendió a Carlos M." + "ganó 5 estrellas"', saleHeadline(p) === 'María R. le vendió a Carlos M.' && saleStars(5) === 'ganó 5 estrellas' && saleStars(1) === 'ganó 1 estrella');
  const txt = DEMO_SALES.map((s) => `${saleLabel(s)} ${s.product}`).join(' | ');
  t.check('sin montos (ni ₡ ni números de precio)', !/₡|\$|colones|\d{3}/.test(txt), txt);
  t.check('accesible: dice que es un ejemplo', DEMO_SALES.every((s) => saleLabel(s).startsWith('Ejemplo.')));
  t.check('copy en tuteo y sin palabras prohibidas', !BANNED.test(txt + JSON.stringify(COPY.sales)) && !VOSEO.test(txt + JSON.stringify(COPY.sales)));
  t.check('sin emojis', !/\p{Extended_Pictographic}/u.test(readFileSync('lib/feedSales.ts', 'utf8') + readFileSync('api/_lib/demoSales.ts', 'utf8') + JSON.stringify(COPY.sales)));

  // Mezcla: 1 de cada 6 (después de cada 5 publicaciones), respetando el filtro.
  const m = mixFeed(items(12), 'true', '');
  const pos = m.map((x, i) => (isSale(x) ? i : -1)).filter((i) => i >= 0);
  t.check('1 de cada 6 tarjetas: posiciones 5 y 11', SALE_EVERY === 6 && JSON.stringify(pos) === '[5,11]', JSON.stringify(pos));
  t.check('Identidad confirmada: solo ventas de vendedores (ficticios) confirmados', m.filter(isSale).every((s) => (s as SalePost).verified));
  const u = mixFeed(items(12), 'false', '');
  t.check('Sin confirmar: solo ventas de vendedores sin confirmar', u.filter(isSale).length === 2 && u.filter(isSale).every((s) => !(s as SalePost).verified));
  t.check('las publicaciones conservan su orden', m.filter((x) => !isSale(x)).map((x: any) => x.slug).join() === items(12).map((x) => x.slug).join());
  t.check('con búsqueda no se mezclan (no son productos)', mixFeed(items(12), 'true', 'bici').every((x) => !isSale(x)));
  t.check('feed vacío: no se inventa nada (estado vacío)', mixFeed([], 'true', '').length === 0);
  t.check('pocas publicaciones: una venta de ejemplo al final', mixFeed(items(2), 'true', '').length === 3 && isSale(mixFeed(items(2), 'true', '')[2]));
  t.check('Datos de ejemplo apagado (sin ventas) -> solo publicaciones', mixFeed(items(12), 'true', '', []).length === 12);
  t.check('nunca más ventas de las que hay', mixFeed(items(60), 'true', '').filter(isSale).length === DEMO_SALES.filter((s) => s.verified).length);

  // Ventas reales: no se publican sin opt-in del vendedor (TODO en el código, ningún endpoint las expone).
  const src = readFileSync('api/_lib/demoSales.ts', 'utf8');
  t.check('TODO de ventas reales con opt-in (Ley 8968)', /TODO\(ventas reales\)/.test(src) && /opt-in/.test(src) && /8968/.test(src));
  t.check('el feed usa mixFeed, abre la hoja de ejemplo y no navega a nada real', /mixFeed/.test(readFileSync('components/Feed.tsx', 'utf8')) && /COPY\.sales\.sheetTitle/.test(readFileSync('components/Feed.tsx', 'utf8')));

  // Fotos de las ventas de ejemplo: archivos propios en public/demo-feed (JPEG cuadrado ~400 px, ≤ 40 KB) con README.
  const jpegSize = (b: Buffer) => { for (let o = 2; o < b.length - 9;) { if (b[o] !== 0xff) return null; const m = b[o + 1]; const len = b.readUInt16BE(o + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: b.readUInt16BE(o + 5), w: b.readUInt16BE(o + 7) }; o += 2 + len; } return null; };
  const bad: string[] = [];
  for (const sp of DEMO_SALES) {
    const f = `public${sp.photo ?? ''}`;
    if (!sp.photo?.startsWith('/demo-feed/') || !existsSync(f)) { bad.push(`${sp.id}: sin foto (${sp.photo})`); continue; }
    const b = readFileSync(f); const d = jpegSize(b);
    if (b[0] !== 0xff || b[1] !== 0xd8 || !d || d.w !== d.h || d.w < 300 || d.w > 600 || b.length > 40_000) bad.push(`${sp.id}: ${b.length} B ${d?.w}x${d?.h}`);
  }
  t.check('cada venta de ejemplo tiene su foto: JPEG cuadrado ~400 px, ≤ 40 KB, en public/demo-feed', bad.length === 0, bad.join(' | '));
  t.check('fotos distintas y README con su origen', new Set(DEMO_SALES.map((sp) => sp.photo)).size === DEMO_SALES.length && /generadas/.test(readFileSync('public/demo-feed/README.md', 'utf8')));
}
