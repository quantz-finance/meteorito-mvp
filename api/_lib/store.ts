// Tienda personal del vendedor (/t/<usuario>) y calificaciones. Migración 010 (seller_profiles, seller_ratings, vistas públicas).
// Si la migración no está aplicada, todo responde 503 'store_unavailable' y el resto de la app sigue igual.
import { randomBytes } from 'node:crypto';
import { HttpError } from './auth';
import { ownPhotoUrl } from './photos';

export const STORE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
/** Rutas y palabras que no pueden ser usuario de tienda. */
export const RESERVED = new Set(['api', 'admin', 'meteorito', 'soporte', 'ayuda', 'tienda', 'tiendas', 'legal', 'nueva', 'vender', 'comprar', 'pedidos', 'mi-tienda', 'team']);
/** Reseña = compra verificada: solo con el pedido liberado (el vendedor ya cobró). */
export const RATABLE = ['liberado'];
export { cleanReviewComment, REVIEW_MAX, shortBuyerName } from './reviewText';

/** "José.Pérez+x@…" -> "jose-perez". Vacío si no queda nada útil. */
export function normalizeStoreSlug(raw: unknown): string {
  return String(raw ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-').slice(0, 30).replace(/-+$/g, '');
}
export function validStoreSlug(s: string): boolean { return STORE_SLUG_RE.test(s) && !RESERVED.has(s); }
/** Usuario inicial a partir del correo (parte local). */
export function baseSlugFromEmail(email?: string | null): string {
  const s = normalizeStoreSlug(String(email ?? '').split('@')[0].split('+')[0]);
  return validStoreSlug(s) ? s.slice(0, 24).replace(/-+$/g, '') : 'tienda';
}
export const withSuffix = (base: string) => `${base.slice(0, 24).replace(/-+$/g, '')}-${randomBytes(2).toString('hex')}`;
/** "rolando.arguello@x" -> "Rolando". */
export function nameFromEmail(email?: string | null): string {
  const raw = String(email ?? '').split('@')[0].split(/[._+-]/)[0].trim();
  return raw ? (raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()).slice(0, 40) : 'Vendedor';
}
export function cleanName(raw: unknown): string {
  const s = String(raw ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim();
  if (s.length < 1 || s.length > 40) throw new HttpError(400, 'El nombre debe tener entre 1 y 40 caracteres.');
  return s;
}

/** Errores de "no existe la tabla/vista" (migración 010 sin aplicar) -> 503 amable. */
export function storeDbErr(e: any): never {
  const missing = e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST200' || /does not exist|schema cache/i.test(String(e.message ?? '')));
  if (missing) throw Object.assign(new HttpError(503, 'La tienda todavía no está disponible. Tus links de venta funcionan igual.'), { code: 'store_unavailable' });
  throw e;
}

/** Foto de la tienda: SOLO una imagen ya subida por /api/photos/upload-url a la carpeta del propio vendedor
 *  (<bucket público>/<su carpeta>/<uuid>/0.jpg|png|webp). Cualquier otra URL -> null (se rechaza). */
export function avatarUrlOf(raw: unknown, sub: string): string | null { return ownPhotoUrl(raw, sub); }
