// Fotos: compresión en el dispositivo + subida por URL firmada (/api/photos/upload-url). El bucket no acepta anon.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { api } from './api';
import { DEMO_ENABLED } from './demo';
import { supabase } from './supabase';
import type { MeteoritoAuth } from './types';

export { MAX_PHOTOS } from './listing';
const MAX_SIDE = 1280;
const TARGET_BYTES = 300 * 1024;

export interface PickedPhoto { uri: string; width?: number; height?: number }

/** Lado largo ≤1280 px, JPEG ~0.7; si sigue >300 KB, baja calidad (0.55, 0.4). */
export async function compressPhoto(p: PickedPhoto): Promise<Blob> {
  const long = Math.max(p.width ?? 0, p.height ?? 0);
  const resize = long > MAX_SIDE ? ((p.width ?? 0) >= (p.height ?? 0) ? { width: MAX_SIDE } : { height: MAX_SIDE }) : null;
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

/** Comprime y sube una foto. index 0..3 dentro del borrador. Devuelve la URL pública. */
export async function uploadPhoto(auth: MeteoritoAuth, p: PickedPhoto, draftId: string, index: number): Promise<string> {
  return uploadCompressed(auth, await compressPhoto(p), draftId, index);
}

/** Sube un JPEG ya comprimido (p. ej. comprimido al elegir la foto). */
export async function uploadCompressed(auth: MeteoritoAuth, blob: Blob, draftId: string, index: number): Promise<string> {
  if (DEMO_ENABLED) return blobToDataUrl(blob); // demo: sin Storage; la foto queda local como data URL
  const r = await api<{ path: string; token: string; publicUrl: string }>(auth, '/api/photos/upload-url', { draftId, index, mime: 'image/jpeg', size: blob.size });
  const { error } = await (await supabase()).storage.from('listings').uploadToSignedUrl(r.path, r.token, blob, { contentType: 'image/jpeg' });
  if (error) throw new Error(`No se pudo subir la foto: ${error.message}`);
  return r.publicUrl;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.onerror = () => reject(fr.error); fr.readAsDataURL(blob); });
}
