// Productos permanentes: en este navegador se recuerda el pedido propio de cada producto (/p/<producto> -> /p/<pedido>).
// Solo slugs públicos (sin datos personales).
const KEY = 'meteorito.listing-orders';
function read(): Record<string, string> {
  try { return JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; }
}
export function rememberListingOrder(listing: string, order: string) {
  try { const m = read(); m[listing] = order; globalThis.localStorage?.setItem(KEY, JSON.stringify(m)); } catch { /* storage bloqueado */ }
}
export const myListingOrder = (listing: string): string | null => read()[listing] ?? null;

/** Lo que ve el vendedor: sus productos y cada pedido de comprador por separado. Se omite el pedido hijo que un
 *  comprador abrió pero que todavía no tiene escrow (ruido: no hay nada que hacer con él). */
export const visibleSellerOrders = <O extends { listing_slug?: string | null; status: string }>(os: O[]) => os.filter((o) => !(o.listing_slug && o.status === 'creado'));
