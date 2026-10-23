// Productos permanentes (migración 012): un link /p/<slug> se vende muchas veces.
// El producto (kind='listing') nunca se fondea. Cada comprador que empieza a pagar recibe su propio pedido hijo
// (kind='single', listing_slug=<producto>) con su propio escrow. Sin la migración, todo sigue como antes (link de un uso).
import { randomBytes } from 'node:crypto';
import { HttpError } from './auth';

export const LISTING_STATUSES = ['activa', 'pausada', 'archivada'] as const;
export type ListingStatus = typeof LISTING_STATUSES[number];
export const isListing = (o: any) => o?.kind === 'listing';
/** Columna o vista de la 012 inexistente (migración sin aplicar). */
export const missingColumn = (e: any) => !!e && (e.code === '42703' || e.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(String(e.message ?? '')));
export const newSlug = () => { const a = 'abcdefghijklmnopqrstuvwxyz0123456789'; let s = ''; while (s.length < 6) { const b = randomBytes(1)[0]; if (b < 252) s += a[b % 36]; } return s; };

/** Campos que el pedido hijo copia del producto (precio y destino incluidos: inmutables desde ahí). */
const COPY = ['seller_address', 'seller_user_id', 'seller_email', 'category', 'brand', 'model', 'condition', 'price_crc', 'description', 'identifier', 'photos', 'checks'] as const;
export function childRow(parent: any, buyerId: string, slug: string) {
  const row: Record<string, unknown> = { slug, kind: 'single', listing_slug: parent.slug, buyer_user_id: buyerId, status: 'creado' };
  for (const k of COPY) if (parent[k] !== undefined) row[k] = parent[k];
  return row;
}

interface Db { from(t: string): any }
/** Pedido sobre el que paga ESTE comprador: el mismo si es un link de un uso; si es un producto, su pedido hijo sin pagar
 *  (reintento) o uno nuevo. */
export async function orderForBuyer(db: Db, parent: any, buyerId: string): Promise<any> {
  if (!isListing(parent)) return parent;
  if (parent.listing_status && parent.listing_status !== 'activa') throw Object.assign(new HttpError(409, 'El vendedor pausó este producto por ahora.'), { code: 'listing_paused' });
  if (parent.stock === 0) throw Object.assign(new HttpError(409, 'Este producto se agotó.'), { code: 'listing_sold_out' });
  const { data: mine, error } = await db.from('orders').select('*').eq('listing_slug', parent.slug).eq('buyer_user_id', buyerId)
    .in('status', ['creado', 'escrow_creado']).order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  if (mine?.[0]) return mine[0];
  for (let i = 0; i < 5; i++) {
    const { data, error: e2 } = await db.from('orders').insert(childRow(parent, buyerId, newSlug())).select('*').single();
    if (!e2) return data;
    if (e2.code !== '23505') throw e2;
  }
  throw new Error('no se pudo crear el pedido');
}
