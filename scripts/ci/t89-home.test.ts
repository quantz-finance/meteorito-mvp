// (89) Home = resumen + "Tus ventas" + "Tus compras" (filas compactas). Sin la UI del proceso (línea de tiempo, pasos,
//      acciones): eso vive en la hoja del pedido. Solo datos reales; lo que te toca primero; sin función nueva.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { T } from './setup';
import { allocateRows, buyNeedsYou, buyPill, HOME_COPY, homeSummary, salePill, saleNeedsYou, sortBuys, sortSales } from '../../lib/home';

const read = (f: string) => readFileSync(f, 'utf8');
const BANNED = /\bsegur[oa]s?\b|garant[ií]a|verificad[oa]|\bempresa\b|fintech|\bbanco\b|billetera|proteg/i;
const VOSEO = /\b(tenés|podés|querés|sabés|pagás|confirmá|tocá|escribí|recordá|mirá|fijate)\b/i;

export async function run(t: T) {
  const s = (slug: string, status: string, extra: any = {}) => ({ slug, status, price_crc: 10000, created_at: `2026-10-${10 + slug.length}T10:00:00Z`, ...extra });
  const b = (slug: string, status: string | null, extra: any = {}) => ({ slug, status, price_crc: 5000, at: `2026-10-${10 + slug.length}T10:00:00Z`, ...extra });

  // Lo que te toca
  t.check('venta pagada (envío) -> te toca: "Envíalo"', saleNeedsYou(s('a', 'fondeado')) && salePill(s('a', 'fondeado')).label === 'Envíalo' && salePill(s('a', 'fondeado')).todo);
  t.check('venta pagada cara a cara -> "Entrégalo"', salePill(s('a', 'fondeado', { delivery_mode: 'cara_a_cara' })).label === 'Entrégalo');
  t.check('venta enviada / publicada / en disputa -> no te toca', ['enviado', 'creado', 'en_disputa', 'liberado'].every((st) => !saleNeedsYou(s('a', st)) && !salePill(s('a', st)).todo));
  t.check('pastilla corta de venta: Disponible, Enviado, Pago liberado', salePill(s('a', 'creado')).label === 'Disponible' && salePill(s('a', 'enviado')).label === 'Enviado' && salePill(s('a', 'liberado')).label === 'Pago liberado');
  t.check('venta resuelta con reembolso: nunca "Pago liberado"', salePill(s('a', 'resuelto', { resolution: { buyerPct: 100 } })).label === 'Reembolsado');
  t.check('compra sin terminar de pagar -> "Termina el pago"', buyPill(b('a', 'escrow_creado')).label === 'Termina el pago' && buyNeedsYou(b('a', 'escrow_creado')));
  t.check('compra enviada -> "Dale tu código" (te toca)', buyPill(b('a', 'enviado')).label === 'Dale tu código' && buyPill(b('a', 'enviado')).todo);
  t.check('compra pagada con envío -> "Pagado" (esperas al vendedor)', buyPill(b('a', 'fondeado')).label === 'Pagado' && !buyNeedsYou(b('a', 'fondeado')));
  t.check('compra pagada cara a cara -> te toca dar tu código', buyNeedsYou(b('a', 'fondeado', { delivery_mode: 'cara_a_cara' })));

  // Orden: lo que te toca primero, luego en curso, luego publicados, luego cerrados
  const sales = [s('liberado1', 'liberado'), s('creado1', 'creado'), s('enviado1', 'enviado'), s('fondeado1', 'fondeado'), s('lst', 'creado', { kind: 'listing' })];
  t.check('ventas: te toca > en curso > publicados > cerradas', sortSales(sales).map((o) => o.slug).join() === 'fondeado1,enviado1,creado1,lst,liberado1', sortSales(sales).map((o) => o.slug).join());
  const buys = [b('liberado1', 'liberado'), b('pagado1', 'fondeado'), b('enviado1', 'enviado'), b('creado1', 'creado'), b('nada', null)];
  t.check('compras: te toca primero; sin pagar ("creado") o sin datos no son compras', sortBuys(buys).map((r) => r.slug).join() === 'enviado1,pagado1,liberado1', sortBuys(buys).map((r) => r.slug).join());

  // Resumen: solo datos reales
  const sum = homeSummary([...sales, s('res', 'resuelto', { resolution: { buyerPct: 50 }, price_crc: 20000 })], buys);
  t.check('resumen: por hacer = ventas por enviar + compras que te tocan', sum.todo === 2, JSON.stringify(sum));
  t.check('resumen: ventas y compras en curso', sum.salesActive === 2 && sum.buysActive === 2, JSON.stringify(sum));
  t.check('resumen: cobrado = liberadas + tu parte de las resueltas', sum.collected === 10000 + 10000, String(sum.collected));
  t.check('resumen sin datos: todo en cero (nada inventado)', JSON.stringify(homeSummary(null, null)) === JSON.stringify({ todo: 0, salesActive: 0, buysActive: 0, collected: 0 }));

  // Reparto de filas sin scroll
  t.check('filas: mitad y mitad', JSON.stringify(allocateRows({ slots: 6, sales: 5, buys: 5 })) === JSON.stringify({ sales: 3, buys: 3, moreSales: true, moreBuys: true }));
  t.check('filas: lo que sobra de una va a la otra', JSON.stringify(allocateRows({ slots: 6, sales: 9, buys: 1 })) === JSON.stringify({ sales: 5, buys: 1, moreSales: true, moreBuys: false }));
  t.check('filas: sin compras, todo para ventas', allocateRows({ slots: 5, sales: 3, buys: 0 }).sales === 3 && !allocateRows({ slots: 5, sales: 3, buys: 0 }).moreSales);
  t.check('filas: cada lista con datos muestra al menos una aunque no quepa', JSON.stringify(allocateRows({ slots: 0, sales: 4, buys: 2 })) === JSON.stringify({ sales: 1, buys: 1, moreSales: true, moreBuys: true }));

  // Copy nuevo: tuteo, sin palabras prohibidas
  const copy = Object.values(HOME_COPY).map((v) => (typeof v === 'function' ? v(3) : v)).join(' | ');
  t.check('copy de Home sin palabras prohibidas ni voseo', !BANNED.test(copy) && !VOSEO.test(copy), copy);

  // Pantalla: sin la UI del proceso en la lista; la hoja del pedido sigue igual
  const home = read('app/(tabs)/pedidos.tsx');
  const list = home.slice(home.indexOf('export default function Pedidos'), home.indexOf('<Sheet visible={!!open}'));
  t.check('Home: la lista no muestra línea de tiempo, pasos ni acciones', !/MoneyTimeline|SellerActions|OrderCard|NEXT_HINT\[/.test(list));
  t.check('Home: la hoja del pedido conserva la línea de tiempo y las acciones', /<MoneyTimeline/.test(home) && /<SellerActions/.test(home));
  t.check('Home: carga compras (lib/myPurchases) y se actualizan solas', /loadMyPurchases\(auth\)/.test(home) && /useOrdersRefresh\(silentBuys,/.test(home));
  t.check('Home: compra -> su seguimiento /p/<pedido>', /pathname: '\/p\/\[slug\]'/.test(read('components/HomeSections.tsx')));
  t.check('Home: acceso a Mi tienda en el encabezado', /label="Mi tienda"/.test(home) && /router\.push\('\/mi-tienda'\)/.test(home));
  t.check('Home: fotos de las ventas por /api/store orders (sin función nueva)', /photos/.test(read('api/store/index.ts').split("b.action === 'orders'")[1].split('return json')[0]));
  const fns = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (n === '_lib' ? [] : fns(p)) : /\.ts$/.test(n) ? [p] : []; });
  t.check('sin funciones nuevas en /api (siguen 12)', fns('api').length === 12, String(fns('api').length));
}
