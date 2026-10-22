// Tienda personal del vendedor: pago.meteorito.app/t/<usuario>. API: /api/store (migración 010).
import { api, guestApi } from './api';
import { DEMO_ENABLED, demoApi, demoGetStore } from './demo';
import { PUBLIC_BASE_URL } from './orders';
import type { MeteoritoAuth } from './types';
export { ratingLabel } from './rating';

export interface StoreItem { slug: string; title: string; price_crc: number; photo: string | null }
export interface Store { store_slug: string; display_name: string; rating_avg: number | null; rating_count: number; items: StoreItem[] }

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
export async function updateMyStore(auth: MeteoritoAuth, patch: { store_slug?: string; display_name?: string }): Promise<Store> {
  return friendly(() => api<Store>(auth, '/api/store', { action: 'update', ...patch }));
}
/** Calificación del comprador (llave de invitado o sesión), una vez por pedido. */
export async function rateOrder(auth: Pick<MeteoritoAuth, 'getAuthToken'>, slug: string, stars: number): Promise<void> {
  if (DEMO_ENABLED) { await demoApi('/api/store', { action: 'rate', slug, stars }); return; }
  await friendly(() => guestApi(auth, '/api/store', { action: 'rate', slug, stars }));
}
async function friendly<T>(f: () => Promise<T>): Promise<T> {
  try { return await f(); }
  catch (e: any) { if (e?.code === 'store_unavailable' || e?.status === 503 || e?.status === 404 && e?.code === 'http_404') throw Object.assign(new Error(STORE_UNAVAILABLE), { code: 'store_unavailable' }); throw e; }
}

const RATED = (slug: string) => `meteorito:rated:${slug}`;
export function ratedStars(slug: string): number | null { try { const v = window.localStorage.getItem(RATED(slug)); return v ? Number(v) : null; } catch { return null; } }
export function rememberRated(slug: string, stars: number) { try { window.localStorage.setItem(RATED(slug), String(stars)); } catch { /* sin storage */ } }
