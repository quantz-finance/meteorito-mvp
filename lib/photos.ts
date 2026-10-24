// Fotos: compresión en el dispositivo + subida por URL firmada (/api/photos/upload-url). El bucket no acepta anon.
import { api } from './api';
import { DEMO_ENABLED } from './demo';
import { supabase } from './supabase';
import type { MeteoritoAuth } from './types';
import { tagPhotoError } from './photoError';

export { MAX_PHOTOS } from './listing';
const MAX_SIDE = 1280;
const TARGET_BYTES = 300 * 1024;

export interface PickedPhoto { uri: string; width?: number; height?: number }

/** Lado largo ≤1280 px, JPEG ~0.7; si sigue >300 KB, baja calidad (0.55, 0.4). */
export async function compressPhoto(p: PickedPhoto): Promise<Blob> {
  const long = Math.max(p.width ?? 0, p.height ?? 0);
  const resize = long > MAX_SIDE ? ((p.width ?? 0) >= (p.height ?? 0) ? { width: MAX_SIDE } : { height: MAX_SIDE }) : null;
  // Carga diferida: el manipulador solo hace falta al publicar con fotos (no en la bienvenida ni en /p/).
  const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
  let last: Blob | null = null;
  for (const compress of [0.7, 0.55, 0.4]) {
    const ctx = ImageManipulator.manipulate(p.uri);
    if (resize) ctx.resize(resize);
    const img = await ctx.renderAsync();
    const out = await img.saveAsync({ compress, format: SaveFormat.JPEG });
    const raw = await (await fetch(out.uri)).blob();
    last = raw.type === 'image/jpeg' ? raw : new Blob([await raw.arrayBuffer()], { type: 'image/jpeg' });
    if (last.size <= TARGET_BYTES) break;
  }
  return last!;
}

export function newDraftId(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const h = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  h[12] = '4'; h[16] = ((parseInt(h[16], 16) & 3) | 8).toString(16);
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** Sube un JPEG ya comprimido por la vía vieja: SOLO la foto de la tienda (productos, envíos y disputas usan uploadCaptured). */
export async function uploadCompressed(auth: MeteoritoAuth, blob: Blob, draftId: string, index: number): Promise<string> {
  if (DEMO_ENABLED) return blobToDataUrl(blob); // demo: sin Storage; la foto queda local como data URL
  let r: { path: string; token: string; publicUrl: string };
  try { r = await api(auth, '/api/photos/upload-url', { draftId, index, mime: 'image/jpeg', size: blob.size }); }
  catch (e) { throw tagPhotoError('sign', e); }
  let error: any;
  try { ({ error } = await (await supabase()).storage.from('listings').uploadToSignedUrl(r.path, r.token, blob, { contentType: 'image/jpeg' })); }
  catch (e) { throw tagPhotoError('storage', e); }
  if (error) throw Object.assign(tagPhotoError('storage', new Error(`No se pudo subir la foto: ${error.message}`)), { code: 'storage_' + String(error.statusCode ?? error.name ?? 'error'), status: Number(error.statusCode) || undefined });
  return r.publicUrl;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = () => reject(fr.error); fr.readAsDataURL(blob); });
}

// ---- Cámara de la app (fotos "solo cámara": envío, producto nuevo, disputa) ----
export const CAMERA_MAX_SIDE = MAX_SIDE;
/** Cuadro de la cámara (canvas ya con la marca de fecha) -> JPEG con el mismo objetivo que compressPhoto (≤300 KB). */
export async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  let last: Blob | null = null;
  for (const q of [0.8, 0.7, 0.55, 0.4]) {
    last = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), 'image/jpeg', q));
    if (!last) break;
    if (last.size <= TARGET_BYTES) break;
  }
  if (!last) { // Safari viejo sin toBlob: data URL
    const d = canvas.toDataURL('image/jpeg', 0.6);
    last = await (await fetch(d)).blob();
  }
  return last.type === 'image/jpeg' ? last : new Blob([await last.arrayBuffer()], { type: 'image/jpeg' });
}

/** Sube una foto de la cámara con su token de captura (un uso, 5 min). La firma solo sale con un token válido. */
export async function uploadCaptured(auth: MeteoritoAuth, blob: Blob, cap: { token: string; purpose: 'ship' | 'listing' | 'dispute' }, asGuest: boolean, asSeller = false): Promise<string> {
  const { api, guestApi } = await import('./api');
  const body = { purpose: cap.purpose, capture_token: cap.token, mime: 'image/jpeg', size: blob.size, ...(asGuest && cap.purpose === 'listing' ? { as: 'guest' } : {}), ...(asSeller && cap.purpose === 'dispute' ? { as: 'seller' } : {}) };
  let r: { path: string; token: string; publicUrl: string };
  try { r = asGuest ? await guestApi(auth, '/api/photos/upload-url', body) : await api(auth, '/api/photos/upload-url', body); }
  catch (e) { throw tagPhotoError('sign', e); }
  if (DEMO_ENABLED) return blobToDataUrl(blob); // demo: el token se valida igual (simulado); la foto queda local
  let error: any;
  try { ({ error } = await (await supabase()).storage.from('listings').uploadToSignedUrl(r.path, r.token, blob, { contentType: 'image/jpeg' })); }
  catch (e) { throw tagPhotoError('storage', e); }
  if (error) throw Object.assign(tagPhotoError('storage', new Error(`No se pudo subir la foto: ${error.message}`)), { code: 'storage_' + String(error.statusCode ?? error.name ?? 'error'), status: Number(error.statusCode) || undefined });
  return r.publicUrl;
}
