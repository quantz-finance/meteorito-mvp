// (67) Feed de Comprar: ventas cerradas. Hoy SOLO ejemplos ficticios (lib/feedSales.ts), con etiqueta "Ejemplo", sin montos,
// detrás de FEED_DEMO_SALES, mezclados 1 de cada 6 tarjetas y respetando el filtro de identidad. Ventas reales: no (falta opt-in).
import { readFileSync } from 'node:fs';
import type { T } from './setup';
import { DEMO_SALES, FEED_DEMO_SALES, isSale, mixFeed, SALE_EVERY, saleHeadline, saleLabel, saleStars, type SalePost } from '../../lib/feedSales';
import { COPY } from '../../lib/copy';

const BANNED = /segur|garant|verificad|empresa|fintech|banco|billetera|proteg/i;
const VOSEO = /\b(tenés|podés|querés|tocá|mirá|escribí|fijate)\b/i;
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ slug: `p${i}` }));

export async function run(t: T) {
  t.check('flag FEED_DEMO_SALES encendido y fácil de apagar (constante)', FEED_DEMO_SALES === true && /export const FEED_DEMO_SALES = (true|false);/.test(readFileSync('lib/feedSales.ts', 'utf8')));
  t.check('todas las ventas son ejemplos ficticios, con confirmados y sin confirmar', DEMO_SALES.length >= 4 && DEMO_SALES.every((s) => s.example === true && s.kind === 'sale')
    && DEMO_SALES.some((s) => s.verified) && DEMO_SALES.some((s) => !s.verified));
  t.check('etiqueta "Ejemplo" y hoja que lo explica', COPY.sales.example === 'Ejemplo' && /ejemplo/i.test(COPY.sales.sheetTitle) && /ficticios/.test(COPY.sales.sheetText));
  const p = DEMO_SALES[0];
  t.check('"María R. le vendió a Carlos M." + "ganó 5 estrellas"', saleHeadline(p) === 'María R. le vendió a Carlos M.' && saleStars(5) === 'ganó 5 estrellas' && saleStars(1) === 'ganó 1 estrella');
  const txt = DEMO_SALES.map((s) => `${saleLabel(s)} ${s.product}`).join(' | ');
  t.check('sin montos (ni ₡ ni números de precio)', !/₡|\$|colones|\d{3}/.test(txt), txt);
  t.check('accesible: dice que es un ejemplo', DEMO_SALES.every((s) => saleLabel(s).startsWith('Ejemplo.')));
  t.check('copy en tuteo y sin palabras prohibidas', !BANNED.test(txt + JSON.stringify(COPY.sales)) && !VOSEO.test(txt + JSON.stringify(COPY.sales)));
  t.check('sin emojis', !/\p{Extended_Pictographic}/u.test(readFileSync('lib/feedSales.ts', 'utf8') + JSON.stringify(COPY.sales)));

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
  t.check('FEED_DEMO_SALES apagado (sin ventas) -> solo publicaciones', mixFeed(items(12), 'true', '', []).length === 12);
  t.check('nunca más ventas de las que hay', mixFeed(items(60), 'true', '').filter(isSale).length === DEMO_SALES.filter((s) => s.verified).length);

  // Ventas reales: no se publican sin opt-in del vendedor (TODO en el código, ningún endpoint las expone).
  const src = readFileSync('lib/feedSales.ts', 'utf8');
  t.check('TODO de ventas reales con opt-in (Ley 8968)', /TODO\(ventas reales\)/.test(src) && /opt-in/.test(src) && /8968/.test(src));
  t.check('el feed usa mixFeed, abre la hoja de ejemplo y no navega a nada real', /mixFeed/.test(readFileSync('components/Feed.tsx', 'utf8')) && /COPY\.sales\.sheetTitle/.test(readFileSync('components/Feed.tsx', 'utf8')));
}
