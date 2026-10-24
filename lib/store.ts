// Tienda personal del vendedor: pago.meteorito.app/t/<usuario>. API: /api/store (migración 010).
import { api, guestApi } from './api';
import { DEMO_ENABLED, demoApi, demoGetStore } from './demo';
import { PUBLIC_BASE_URL } from './orders';
import type { MeteoritoAuth } from './types';
export { ratingLabel } from './rating';

export interface StoreItem { slug: string; title: string; price_crc: number; photo: string | null; /** Solo en Mi tienda (migración 012). */ listing_status?: 'activa' | 'pausada' }
export interface Store { store_slug: string; display_name: string; /** Foto de la tienda (migración 014); null = inicial. */ avatar_url?: string | null;
  /** Solo Mi tienda (dueño): WhatsApp de contacto +506XXXXXXXX (migración 016); null = sin teléfono. Nunca en la tienda pública. */ contact_phone?: string | null;
  /** Solo Mi tienda: el vendedor eligió mostrar su WhatsApp en el perfil público (migración 020). */ whatsapp_public?: boolean; rating_avg: number | null; rating_count: number; items: StoreItem[] }

export const storeLink = (slug: string) => `${PUBLIC_BASE_URL}/t/${slug}`;
export const STORE_UNAVAILABLE = 'La tienda todavía no está disponible. Tus links de venta funcionan igual.';

/** Tienda pública; null si no existe. Lanza error con mensaje amable si el backend no la tiene disponible. */
export async function getStore(slug: string): Promise<Store | null> {
  if (DEMO_ENABLED) return demoGetStore(slug) as Store | null;
  let r: Response;
  try { r = await fetch(`/api/store?store=${encodeURIComponent(slug)}`, { cache: 'no-store' }); }
  catch { throw new Error('No pudimos cargar la tienda. Revisa tu conexión e intenta de nuevo.'); }
  if (r.status === 404) return null;
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 503 || r.status >= 500 ? STORE_UNAVAILABLE : j.error ?? `Error ${r.status}`);
  return j as Store;
}
export async function getMyStore(auth: MeteoritoAuth): Promise<Store> {
  return friendly(() => api<Store>(auth, '/api/store', { action: 'me' }));
}
export async function updateMyStore(auth: MeteoritoAuth, patch: { store_slug?: string; display_name?: string; avatar_url?: string | null; contact_phone?: string | null; whatsapp_public?: boolean }): Promise<Store> {
  return friendly(() => api<Store>(auth, '/api/store', { action: 'update', ...patch }));
}
/** Reseña del comprador (llave de invitado o sesión), una por pedido y solo con la compra liberada.
 *  Devuelve el usuario de la tienda del vendedor (para ir a su perfil) o null. */
export async function rateOrder(auth: Pick<MeteoritoAuth, 'getAuthToken'>, slug: string, stars: number, extra: { comment?: string; buyer_name?: string } = {}): Promise<string | null> {
  const body = { action: 'rate', slug, stars, ...(extra.comment?.trim() ? { comment: extra.comment.trim() } : {}), ...(extra.buyer_name?.trim() ? { buyer_name: extra.buyer_name.trim() } : {}) };
  const r: any = DEMO_ENABLED ? await demoApi('/api/store', body) : await friendly(() => guestApi(auth, '/api/store', body));
  return typeof r?.store_slug === 'string' ? r.store_slug : null;
}
async function friendly<T>(f: () => Promise<T>): Promise<T> {
  try { return await f(); }
  catch (e: any) { if (['avatar_unavailable', 'bad_avatar', 'phone_unavailable', 'bad_phone'].includes(e?.code)) throw e; if (e?.code === 'store_unavailable' || e?.status === 503 || e?.status === 404 && e?.code === 'http_404') throw Object.assign(new Error(STORE_UNAVAILABLE), { code: 'store_unavailable' }); throw e; }
}

/** WhatsApp del vendedor para el comprador de ESTE pedido (llave de invitado o sesión), solo con el pedido pagado.
 *  null si el vendedor no lo agregó, si todavía no está disponible o ante cualquier error (nunca rompe la página). */
export async function getSellerContact(auth: Pick<MeteoritoAuth, 'getAuthToken'>, slug: string): Promise<string | null> {
  try {
    const r = DEMO_ENABLED ? await demoApi('/api/store', { action: 'seller_contact', slug }) : await guestApi<{ contact_phone: string | null }>(auth, '/api/store', { action: 'seller_contact', slug });
    return typeof r?.contact_phone === 'string' ? r.contact_phone : null;
  } catch { return null; }
}

const RATED = (slug: string) => `meteorito:rated:${slug}`;
export function ratedStars(slug: string): number | null { try { const v = window.localStorage.getItem(RATED(slug)); return v ? Number(v) : null; } catch { return null; } }
export function rememberRated(slug: string, stars: number) { try { window.localStorage.setItem(RATED(slug), String(stars)); } catch { /* sin storage */ } }

/** Mi tienda: pausar, reactivar o archivar un producto permanente (migración 012). */
export async function setListingStatus(auth: MeteoritoAuth, slug: string, status: 'activa' | 'pausada' | 'archivada'): Promise<Store> {
  const { api } = await import('./api');
  return api<Store>(auth, '/api/store', { action: 'listing_set', slug, status });
}

export const AVATAR_ERROR = 'No pudimos cambiar la foto. Prueba con otra imagen o intenta de nuevo.';
const AVATAR_SIDE = 512;
/** Foto de la tienda: recorte cuadrado centrado (512 px) + compressPhoto + la misma subida firmada de las fotos de productos. */
export async function uploadStoreAvatar(auth: MeteoritoAuth, p: { uri: string; width?: number; height?: number }): Promise<Store> {
  const { compressPhoto, newDraftId, uploadCompressed } = await import('./photos');
  let square: { uri: string; width: number; height: number };
  try {
    const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
    let w = p.width ?? 0, h = p.height ?? 0;
    if (!w || !h) { const probe = await ImageManipulator.manipulate(p.uri).renderAsync(); w = probe.width; h = probe.height; }
    const side = Math.min(w, h);
    const ctx = ImageManipulator.manipulate(p.uri).crop({ originX: Math.floor((w - side) / 2), originY: Math.floor((h - side) / 2), width: side, height: side });
    if (side > AVATAR_SIDE) ctx.resize({ width: AVATAR_SIDE, height: AVATAR_SIDE });
    const img = await ctx.renderAsync();
    const out = await img.saveAsync({ compress: 0.9, format: SaveFormat.JPEG });
    square = { uri: out.uri, width: out.width, height: out.height };
  } catch { throw new Error(AVATAR_ERROR); }
  const blob = await compressPhoto(square).catch(() => { throw new Error(AVATAR_ERROR); });
  const url = await uploadCompressed(auth, blob, newDraftId(), 0).catch(() => { throw new Error(AVATAR_ERROR); });
  try { return await updateMyStore(auth, { avatar_url: url }); }
  catch (e: any) { throw new Error(e?.code === 'avatar_unavailable' || e?.code === 'store_unavailable' ? 'Todavía no puedes poner foto a tu tienda. Intenta más tarde.' : AVATAR_ERROR); }
}

/* ---------- Feed de Comprar + perfil público (GET /api/store?feed / ?profile) ---------- */
export type VerifiedFilter = 'true' | 'false' | 'all';
export interface FeedSeller { store_slug: string; display_name: string; avatar_url: string | null; verified: boolean; rating_avg: number | null; rating_count: number }
export interface FeedItem { slug: string; title: string; price_crc: number; photo: string | null; created_at: string; seller: FeedSeller }
/** Producto del bloque Patrocinado (migración 024): un vendedor pagó para mostrarlo ahí. */
export interface SponsoredItem { id: number; slug: string; title: string; price_crc: number; photo: string | null; seller: FeedSeller }
export interface FeedPage { items: FeedItem[]; next_cursor: string | null; /** Solo en la 1.ª página; [] o ausente = sin bloque. */ sponsored?: SponsoredItem[] }
export interface Review { stars: number; comment: string | null; /** Nombre corto que eligió el comprador; null = "Compra verificada". */ buyer_name: string | null; created_at: string | null }
/** Cómo salieron las ventas, sin montos. completed = no_issues + disputes_resolved. */
export interface SalesOutcome { completed: number; no_issues: number; disputes_resolved: number; disputes_open: number }
export interface SellerProfile extends FeedSeller {
  bio: string | null; location: string | null; sales_completed: number; sales?: SalesOutcome; member_since: string | null;
  /** Número de seguidores (migración 022). Nunca quiénes. null/ausente = no disponible: no se muestra. */ followers?: number | null;
  /** https://wa.me/506… solo si el vendedor puso su WhatsApp; null si no. */ whatsapp: string | null;
  items: (StoreItem & { created_at?: string | null })[]; reviews: Review[];
}
export const FEED_ERROR = 'No pudimos cargar las publicaciones. Revisa tu conexión e intenta de nuevo.';

/** Feed con el algoritmo (order=rank). `personal`: quien sigue a alguien pide su feed por POST (impulso de los que
 *  sigue, sin caché pública); si no, GET cacheado igual para todos. */
export async function getFeed(o: { q?: string; cursor?: string | null; verified: VerifiedFilter; limit?: number; personal?: Pick<MeteoritoAuth, 'getAuthToken'> | null }): Promise<FeedPage> {
  if (DEMO_ENABLED) { const { demoFeed } = await import('./demoFeed'); return demoFeed(o); }
  let j: any;
  if (o.personal) {
    try { j = await guestApi(o.personal, '/api/store', { action: 'feed', verified: o.verified, ...(o.q?.trim() ? { q: o.q.trim() } : {}), ...(o.cursor ? { cursor: o.cursor } : {}), ...(o.limit ? { limit: o.limit } : {}) }); }
    catch (e: any) { throw new Error(e?.status >= 500 || !e?.status ? FEED_ERROR : e.message || FEED_ERROR); }
  } else {
    const qs = new URLSearchParams({ feed: '1', verified: o.verified, order: 'rank' });
    if (o.q?.trim()) qs.set('q', o.q.trim());
    if (o.cursor) qs.set('cursor', o.cursor);
    if (o.limit) qs.set('limit', String(o.limit));
    let r: Response;
    try { r = await fetch(`/api/store?${qs}`); } catch { throw new Error(FEED_ERROR); }
    j = (await r.json().catch(() => null)) ?? {};
    if (!r.ok) throw new Error(r.status >= 500 ? FEED_ERROR : j.error ?? FEED_ERROR);
  }
  return { items: Array.isArray(j?.items) ? j.items : [], next_cursor: j?.next_cursor ?? null, sponsored: Array.isArray(j?.sponsored) ? j.sponsored : [] };
}
/** Perfil público; null si no existe. */
export async function getSellerProfile(slug: string): Promise<SellerProfile | null> {
  if (DEMO_ENABLED) { const { demoProfile } = await import('./demoFeed'); return demoProfile(slug); }
  let r: Response;
  try { r = await fetch(`/api/store?profile=${encodeURIComponent(slug)}`); }
  catch { throw new Error('No pudimos cargar el perfil. Revisa tu conexión e intenta de nuevo.'); }
  if (r.status === 404) return null;
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 503 || r.status >= 500 ? STORE_UNAVAILABLE : j.error ?? `Error ${r.status}`);
  return j as SellerProfile;
}

export type OrderSeller = FeedSeller & { sales: SalesOutcome };
/** Vendedor de un pedido/link para la ficha /p/<slug>. null si no tiene tienda o no se pudo cargar (no rompe la ficha). */
export async function getOrderSeller(orderSlug: string): Promise<OrderSeller | null> {
  if (DEMO_ENABLED) { const { demoOrderSeller } = await import('./demoFeed'); return demoOrderSeller(); }
  try {
    const r = await fetch(`/api/store?seller_of=${encodeURIComponent(orderSlug)}`);
    if (!r.ok) return null;
    const j: any = (await r.json().catch(() => null)) ?? {};
    return j.seller && typeof j.seller.store_slug === 'string' ? j.seller as OrderSeller : null;
  } catch { return null; }
}
