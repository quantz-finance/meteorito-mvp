// Home (pestaña /pedidos): resumen + "Tus ventas" + "Tus compras". Puro (sin red ni React Native): lo usan la pantalla y
// los tests. Home NO muestra el proceso de cada pedido (línea de tiempo, pasos, acciones): eso vive en la hoja del pedido
// (ventas) y en su seguimiento /p/<pedido> (compras). Aquí solo: foto, título, precio y una pastilla corta de estado.
// Solo datos reales: pedidos del vendedor (/api/store 'orders'), compras (lib/myPurchases) y la tienda ('me').
import { STATUS_LABEL } from './labels';
import { resolvedLabel } from './status';
import { collectedOf } from './sellerTools';

/** Textos nuevos de Home (tuteo). */
export const HOME_COPY = {
  todo: 'Por hacer',
  salesActive: 'Vendiendo',
  buysActive: 'Comprando',
  sales: 'Tus ventas',
  buys: 'Tus compras',
  seeAll: (n: number) => `Ver todas · ${n}`,
  collected: 'cobrado en la beta (sin dinero real)', // beta en testnet: nunca parece un saldo real (revisión legal)
  salesEmpty: 'Todavía no vendes nada.',
  shipIt: 'Envíalo',
  handIt: 'Entrégalo',
  finishPay: 'Termina el pago',
  giveCode: 'Al recibir, dale tu código',
} as const;

export type PillTone = 'lilac' | 'success' | 'warn' | 'muted';
export interface Pill { label: string; tone: PillTone; todo: boolean }

export interface HomeSale { slug: string; status: string; price_crc: number; created_at: string; delivery_mode?: string | null; kind?: string | null; resolution?: { buyerPct?: number | null } | null; released_at?: string | null; resolved_at?: string | null }
export interface HomeBuy { slug: string; status: string | null; price_crc: number; at: string | null; delivery_mode?: string | null; resolution?: { buyerPct?: number | null } | null }

const ACTIVE = ['escrow_creado', 'fondeado', 'enviado', 'en_disputa'];
const DONE = ['entregado', 'liberado', 'resuelto', 'cancelado'];
const f2f = (o: { delivery_mode?: string | null }) => o.delivery_mode === 'cara_a_cara';

/** El vendedor tiene que hacer algo: el dinero ya está apartado y le toca enviarlo (o entregarlo en persona). */
export const saleNeedsYou = (o: Pick<HomeSale, 'status'>) => o.status === 'fondeado';
/** El comprador tiene que hacer algo: terminar el pago, o dar su código al recibir (enviado o cara a cara ya pagado). */
export const buyNeedsYou = (r: Pick<HomeBuy, 'status' | 'delivery_mode'>) => r.status === 'escrow_creado' || r.status === 'enviado' || (r.status === 'fondeado' && f2f(r));
export const isActiveSale = (o: Pick<HomeSale, 'status'>) => ACTIVE.includes(o.status);
export const isActiveBuy = (r: Pick<HomeBuy, 'status'>) => !!r.status && ACTIVE.includes(r.status);
/** Compra real (no un pago que no siguió ni un link sin datos). */
export const isBuy = (r: Pick<HomeBuy, 'status'>) => !!r.status && (ACTIVE.includes(r.status) || DONE.includes(r.status));

const tone = (s: string | null): PillTone => s === 'liberado' || s === 'entregado' ? 'success' : s === 'en_disputa' ? 'warn' : s === 'cancelado' || s === 'resuelto' ? 'muted' : 'lilac';

export function salePill(o: Pick<HomeSale, 'status' | 'delivery_mode' | 'resolution'>): Pill {
  if (saleNeedsYou(o)) return { label: f2f(o) ? HOME_COPY.handIt : HOME_COPY.shipIt, tone: 'warn', todo: true };
  if (o.status === 'resuelto') return { label: resolvedLabel(o), tone: 'muted', todo: false };
  return { label: STATUS_LABEL[o.status] ?? o.status, tone: tone(o.status), todo: false };
}
export function buyPill(r: Pick<HomeBuy, 'status' | 'delivery_mode' | 'resolution'>): Pill {
  if (r.status === 'escrow_creado') return { label: HOME_COPY.finishPay, tone: 'warn', todo: true };
  if (buyNeedsYou(r)) return { label: HOME_COPY.giveCode, tone: 'warn', todo: true };
  if (r.status === 'fondeado') return { label: 'Pagado', tone: 'lilac', todo: false };
  if (r.status === 'resuelto' || r.status === 'liberado' || r.status === 'entregado') return { label: resolvedLabel({ status: r.status, resolution: r.resolution }), tone: tone(r.status), todo: false };
  return { label: (r.status && STATUS_LABEL[r.status]) || 'Sin datos', tone: tone(r.status), todo: false };
}

/** Rango para ordenar: lo que te toca primero, luego en curso, luego publicados (sin pagar) y al final lo cerrado. */
const rank = (status: string | null, todo: boolean) => todo ? 0 : status && ACTIVE.includes(status) ? 1 : status === 'creado' ? 2 : 3;
const ms = (s: string | null | undefined) => Date.parse(s ?? '') || 0;
export function sortSales<O extends HomeSale>(os: O[]): O[] {
  return [...os].filter((o) => o.kind !== 'listing' || o.status === 'creado')
    .sort((a, b) => rank(a.status, saleNeedsYou(a)) - rank(b.status, saleNeedsYou(b)) || ms(b.created_at) - ms(a.created_at));
}
export function sortBuys<R extends HomeBuy>(rs: R[]): R[] {
  return rs.filter(isBuy).sort((a, b) => rank(a.status, buyNeedsYou(a)) - rank(b.status, buyNeedsYou(b)) || ms(b.at) - ms(a.at));
}

export interface HomeSummary { todo: number; salesActive: number; buysActive: number; collected: number }
/** Resumen con datos reales: nada inventado (sin pedidos -> ceros; la pantalla muestra el vacío amable). */
export function homeSummary(sales: HomeSale[] | null, buys: HomeBuy[] | null): HomeSummary {
  const s = sales ?? [], b = (buys ?? []).filter(isBuy);
  return {
    todo: s.filter(saleNeedsYou).length + b.filter(buyNeedsYou).length,
    salesActive: s.filter(isActiveSale).length,
    buysActive: b.filter(isActiveBuy).length,
    collected: s.reduce((n, o) => n + collectedOf(o), 0),
  };
}

/** Cuántas filas caben de cada lista en el alto disponible (Home no hace scroll). Cada lista con datos muestra al menos
 *  una fila; reparte mitad y mitad y lo que sobra a la otra. Si no caben todas, el encabezado ofrece "Ver todas · N". */
export function allocateRows(o: { slots: number; sales: number; buys: number }): { sales: number; buys: number; moreSales: boolean; moreBuys: boolean } {
  const slots = Math.max((o.sales ? 1 : 0) + (o.buys ? 1 : 0), Math.floor(o.slots));
  let a = Math.min(o.sales, o.buys ? Math.ceil(slots / 2) : slots);
  const b = Math.min(o.buys, slots - a);
  a = Math.min(o.sales, slots - b);
  return { sales: a, buys: b, moreSales: o.sales > a, moreBuys: o.buys > b };
}
