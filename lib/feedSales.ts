// Publicaciones de "venta cerrada" en el feed de Comprar ("María R. le vendió a Carlos M. · ganó 5 estrellas").
// HOY SOLO HAY EJEMPLOS: usuarios y productos FICTICIOS, definidos aquí (no en la base de datos), cada uno con la
// etiqueta "Ejemplo" y una hoja que lo explica al tocarlo. Nunca se presentan como reales. Sin montos.
// Apagarlos: FEED_DEMO_SALES = false.
// TODO(ventas reales): mostrar ventas cerradas reales SOLO si el vendedor lo autoriza (opt-in explícito, Ley 8968, plan F
// de Gary). Ese opt-in todavía no existe: no se publica ninguna venta real.
import type { VerifiedFilter } from '../api/_lib/feedText';

export const FEED_DEMO_SALES = true;
/** 1 de cada 6 tarjetas es una venta cerrada (después de cada 5 publicaciones). */
export const SALE_EVERY = 6;

export interface SalePost {
  kind: 'sale'; id: string; example: true;
  seller_name: string; buyer_name: string; /** el vendedor (ficticio) tiene identidad confirmada: sale en ese filtro */ verified: boolean;
  stars: 1 | 2 | 3 | 4 | 5; comment: string | null; product: string; /** Ionicons */ icon: string; photo: string | null;
}
const sale = (id: string, seller_name: string, buyer_name: string, verified: boolean, stars: SalePost['stars'], product: string, icon: string, comment: string | null, photo: string | null = null): SalePost =>
  ({ kind: 'sale', id, example: true, seller_name, buyer_name, verified, stars, comment, product, icon, photo });

/** Ficticios: nombres inventados, productos genéricos. */
export const DEMO_SALES: SalePost[] = [
  sale('ej-1', 'María R.', 'Carlos M.', true, 5, 'Bicicleta de montaña', 'bicycle', 'Llegó igual que en las fotos.', '/demo-fb-import.jpg'),
  sale('ej-2', 'Pablo J.', 'Natalia S.', false, 5, 'Control de consola', 'game-controller', 'Muy amable, entregó el mismo día.'),
  sale('ej-3', 'Laura G.', 'Andrés P.', true, 5, 'Audífonos inalámbricos', 'headset', 'Todo bien, recomendada.'),
  sale('ej-4', 'Andrea L.', 'Felipe R.', false, 4, 'Chaqueta de mezclilla', 'shirt', 'Buen estado, como lo describió.'),
  sale('ej-5', 'Sofía V.', 'Daniel C.', true, 4, 'Cámara instantánea', 'camera', null),
  sale('ej-6', 'Esteban M.', 'Valeria Q.', false, 5, 'Lámpara de escritorio', 'bulb', null),
];

export const saleHeadline = (p: Pick<SalePost, 'seller_name' | 'buyer_name'>) => `${p.seller_name} le vendió a ${p.buyer_name}`;
export const saleStars = (n: number) => `ganó ${n} estrella${n === 1 ? '' : 's'}`;
/** Texto accesible de la tarjeta (sin montos). */
export const saleLabel = (p: SalePost) => `Ejemplo. ${saleHeadline(p)}, ${p.product}, ${saleStars(p.stars)}${p.comment ? `: ${p.comment}` : ''}`;

/**
 * Mezcla las ventas cerradas con las publicaciones: una después de cada 5 (1 de cada 6 tarjetas), respetando el filtro de
 * identidad. Con búsqueda o sin publicaciones no se mezcla nada (no son productos). Si hay menos de 5 publicaciones, una
 * al final para que el feed tenga variedad.
 */
export function mixFeed<T>(items: T[], filter: VerifiedFilter, q: string, sales: SalePost[] = FEED_DEMO_SALES ? DEMO_SALES : []): (T | SalePost)[] {
  if (q.trim() || !items.length || !sales.length) return items;
  const pool = sales.filter((s) => filter === 'all' || String(s.verified) === filter);
  if (!pool.length) return items;
  const out: (T | SalePost)[] = []; let k = 0;
  items.forEach((it, i) => { out.push(it); if ((i + 1) % (SALE_EVERY - 1) === 0 && k < pool.length) out.push(pool[k++]); });
  if (k === 0) out.push(pool[0]);
  return out;
}
export const isSale = (x: unknown): x is SalePost => !!x && (x as SalePost).kind === 'sale';
