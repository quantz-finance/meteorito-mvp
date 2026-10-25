// Publicaciones de "venta cerrada" en el feed de Comprar ("María R. le vendió a Carlos M. · ganó 5 estrellas").
// HOY SOLO HAY EJEMPLOS (api/_lib/demoSales.ts), con un iconito (i) discreto y una hoja que lo explica al tocarlo.
// Nunca se presentan como reales. Sin montos. Llegan del servidor (FeedPage.sales) SOLO en el modo "Datos de ejemplo"
// (lib/demoPref.ts -> ?ejemplos=1); sin ellas no se mezcla nada.
import type { VerifiedFilter } from '../api/_lib/feedText';
import type { SalePost } from '../api/_lib/demoSales';

export type { SalePost };
/** 1 de cada 6 tarjetas es una venta cerrada (después de cada 5 publicaciones). */
export const SALE_EVERY = 6;

export const saleHeadline = (p: Pick<SalePost, 'seller_name' | 'buyer_name'>) => `${p.seller_name} le vendió a ${p.buyer_name}`;
export const saleStars = (n: number) => `ganó ${n} estrella${n === 1 ? '' : 's'}`;
/** Texto accesible de la tarjeta (sin montos). */
export const saleLabel = (p: SalePost) => `Ejemplo. ${saleHeadline(p)}, ${p.product}, ${saleStars(p.stars)}${p.comment ? `: ${p.comment}` : ''}`;

/**
 * Mezcla las ventas cerradas con las publicaciones: una después de cada 5 (1 de cada 6 tarjetas), respetando el filtro de
 * identidad. Con búsqueda o sin publicaciones no se mezcla nada (no son productos). Si hay menos de 5 publicaciones, una
 * al final para que el feed tenga variedad.
 */
export function mixFeed<T>(items: T[], filter: VerifiedFilter, q: string, sales: SalePost[] = []): (T | SalePost)[] {
  if (q.trim() || !items.length || !sales.length) return items;
  const pool = sales.filter((s) => filter === 'all' || String(s.verified) === filter);
  if (!pool.length) return items;
  const out: (T | SalePost)[] = []; let k = 0;
  items.forEach((it, i) => { out.push(it); if ((i + 1) % (SALE_EVERY - 1) === 0 && k < pool.length) out.push(pool[k++]); });
  if (k === 0) out.push(pool[0]);
  return out;
}
export const isSale = (x: unknown): x is SalePost => !!x && (x as SalePost).kind === 'sale';
