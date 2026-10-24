// Mis compras: pedidos de los que esta petición es el COMPRADOR (llave de invitado X-Guest-Key y/o sesión Cavos).
// Solo lo que la fila necesita: nada del vendedor, de la llave, del PIN, del identificador ni del contrato.
import { missingColumn } from './listings';

interface Db { from(t: string): any }
const BASE = 'slug, brand, model, price_crc, photos, status, created_at';
/** Columnas opcionales por migración (002 funded_at, 005 resolution, 017 delivery_mode): sin ellas se piden las básicas. */
const FULL = `${BASE}, funded_at, resolution, delivery_mode`;
export const BUYER_ORDERS_MAX = 100;

export interface BuyerOrderView {
  slug: string; brand: string; model: string; price_crc: number; photo: string | null; status: string;
  created_at: string | null; funded_at: string | null; resolution: { buyerPct: number | null } | null; delivery_mode: string | null;
}

export async function buyerOrders(db: Db, ids: string[]): Promise<BuyerOrderView[]> {
  const mine = ids.filter((i) => typeof i === 'string' && i.length > 0);
  if (!mine.length) return [];
  const q = (cols: string) => db.from('orders').select(cols).in('buyer_user_id', mine).neq('status', 'creado')
    .order('created_at', { ascending: false }).limit(BUYER_ORDERS_MAX);
  let r = await q(FULL);
  if (r.error && missingColumn(r.error)) r = await q(BASE);
  if (r.error) throw r.error;
  return (r.data ?? []).map((o: any) => ({
    slug: o.slug, brand: o.brand ?? '', model: o.model ?? '', price_crc: Number(o.price_crc), photo: Array.isArray(o.photos) ? o.photos[0] ?? null : null,
    status: o.status, created_at: o.created_at ?? null, funded_at: o.funded_at ?? null, delivery_mode: o.delivery_mode ?? null,
    resolution: o.resolution && typeof o.resolution === 'object' ? { buyerPct: typeof o.resolution.buyerPct === 'number' ? o.resolution.buyerPct : null } : null,
  }));
}
