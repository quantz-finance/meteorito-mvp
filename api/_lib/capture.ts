// Fotos "solo cámara" (prueba de envío, fotos de un producto nuevo y fotos de una disputa).
// Al abrir la cámara de la app, el cliente pide un TOKEN DE CAPTURA firmado por el servidor (HMAC): un solo uso, con
// propósito (ship | listing | dispute), referencia (slug del pedido o 'new'), dueño (sub) y vigencia corta (5 min).
// La firma de subida a Storage SOLO se emite con un token válido, vigente y sin usar para ese propósito, y la foto queda en
// una carpeta propia del token: listings/<carpeta del usuario>/<propósito>-<id del token>/0.jpg. Esa carpeta no se
// puede escribir por la vía vieja (draftId = uuid puro), así que una foto del carrete nunca llega a esas rutas.
// Fotos importadas de Facebook: el servidor las guarda él mismo en <carpeta>/fb-<uuid>/0.<ext> al importar.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { HttpError } from './auth';
import { env } from './env';
import { publicPrefix, userDir } from './photos';

export type CapturePurpose = 'ship' | 'listing' | 'dispute';
export const CAPTURE_PURPOSES: CapturePurpose[] = ['ship', 'listing', 'dispute'];
export const CAPTURE_TTL_MS = 5 * 60_000;
/** Holgura para el reloj del teléfono al validar captured_at (el cliente lo corrige con la hora del servidor). */
export const CAPTURE_SKEW_MS = 2 * 60_000;
export interface CaptureClaims { v: 1; id: string; p: CapturePurpose; ref: string; sub: string; iat: number; exp: number }

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const key = () => createHmac('sha256', 'meteorito-capture-v1').update(process.env.CAPTURE_SECRET || env.supabaseService()).digest();
const mac = (payload: string) => createHmac('sha256', key()).update(payload).digest();
const err = (status: number, code: string, msg: string) => Object.assign(new HttpError(status, msg), { code });

export const isCapturePurpose = (p: unknown): p is CapturePurpose => CAPTURE_PURPOSES.includes(p as CapturePurpose);
export const validCaptureRef = (p: CapturePurpose, ref: unknown): ref is string =>
  typeof ref === 'string' && (p === 'listing' ? ref === 'new' : /^[a-z0-9]{4,12}$/.test(ref));

/** Código corto que la app dibuja en la foto: el del pedido (slug) o, para un producto nuevo, uno derivado del token. */
export const captureCode = (c: Pick<CaptureClaims, 'p' | 'ref' | 'id'>) => (c.p === 'listing' ? 'P-' + c.id.slice(0, 6) : c.ref).toUpperCase();

export function signCaptureToken(c: { p: CapturePurpose; ref: string; sub: string }, now = Date.now()): { token: string; claims: CaptureClaims } {
  const claims: CaptureClaims = { v: 1, id: randomUUID(), p: c.p, ref: c.ref, sub: c.sub, iat: now, exp: now + CAPTURE_TTL_MS };
  const payload = b64u(JSON.stringify(claims));
  return { token: `${payload}.${b64u(mac(payload))}`, claims };
}

/** Firma y forma (sin mirar vigencia ni dueño). null si el token es basura o fue alterado. */
export function readCaptureToken(token: unknown): CaptureClaims | null {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra != null) return null;
  const want = mac(payload); const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (c?.v !== 1 || !isCapturePurpose(c.p) || typeof c.sub !== 'string' || typeof c.ref !== 'string' || !new RegExp(`^${UUID}$`).test(c.id)
      || !Number.isFinite(c.iat) || !Number.isFinite(c.exp)) return null;
    return c as CaptureClaims;
  } catch { return null; }
}

/** Token válido para ESTE propósito, ESTE dueño (y esta referencia, si se pide). Vigencia salvo allowExpired (evidencia ya subida). */
export function checkCaptureToken(token: unknown, want: { purpose: CapturePurpose; subs: string[]; ref?: string; now?: number; allowExpired?: boolean }): CaptureClaims {
  if (token == null || token === '') throw err(401, 'capture_token_required', 'Toma la foto con la cámara de Meteorito.');
  const c = readCaptureToken(token);
  if (!c) throw err(403, 'capture_token_invalid', 'La foto no es válida. Tómala de nuevo con la cámara.');
  if (c.p !== want.purpose) throw err(403, 'capture_wrong_purpose', 'Esa foto es para otra cosa. Tómala de nuevo con la cámara.');
  if (!want.subs.includes(c.sub)) throw err(403, 'capture_wrong_owner', 'La foto no es válida. Tómala de nuevo con la cámara.');
  if (want.ref != null && c.ref !== want.ref) throw err(403, 'capture_wrong_ref', 'Esa foto es de otro pedido. Tómala de nuevo con la cámara.');
  if (!want.allowExpired && (want.now ?? Date.now()) > c.exp) throw err(410, 'capture_token_expired', 'Pasaron más de 5 minutos. Toma la foto de nuevo.');
  return c;
}

export const capturePath = (c: Pick<CaptureClaims, 'p' | 'id' | 'sub'>) => `${userDir(c.sub)}/${c.p}-${c.id}/0.jpg`;
export const captureUrl = (c: Pick<CaptureClaims, 'p' | 'id' | 'sub'>) => `${publicPrefix(c.sub)}${c.p}-${c.id}/0.jpg`;

/** Foto tomada con la cámara de la app (carpeta de un token) del usuario `sub`, o null. */
export function cameraPhoto(raw: unknown, sub: string): { purpose: CapturePurpose; id: string } | null {
  if (typeof raw !== 'string' || raw.length > 400) return null;
  const prefix = publicPrefix(sub);
  if (!raw.startsWith(prefix)) return null;
  const m = new RegExp(`^(ship|listing|dispute)-(${UUID})/0\\.jpg$`).exec(raw.slice(prefix.length));
  return m ? { purpose: m[1] as CapturePurpose, id: m[2] } : null;
}
/** Foto guardada por el servidor al importar un anuncio de Facebook. */
export const FB_PHOTO_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const fbPhotoPath = (sub: string, id = randomUUID(), ext = 'jpg') => `${userDir(sub)}/fb-${id}/0.${ext}`;
export function isFbPhoto(raw: unknown, sub: string): boolean {
  if (typeof raw !== 'string' || raw.length > 400) return false;
  const prefix = publicPrefix(sub);
  return raw.startsWith(prefix) && new RegExp(`^fb-${UUID}/0\\.(jpg|png|webp)$`).test(raw.slice(prefix.length));
}
/** Foto aceptable en un producto nuevo (o en una invitación): cámara de la app (listing) o importada de Facebook. */
export const listingPhotoOk = (u: unknown, sub: string) => cameraPhoto(u, sub)?.purpose === 'listing' || isFbPhoto(u, sub);
export const CAMERA_REQUIRED_MSG = 'Las fotos se toman con la cámara de Meteorito. Actualiza la app y toma la foto de nuevo.';
export const cameraRequired = () => err(400, 'camera_required', CAMERA_REQUIRED_MSG);

/** captured_at del cliente: ISO dentro de la vigencia del token (con holgura). Si no, la foto no sirve como evidencia. */
export function captureTime(raw: unknown, c: CaptureClaims): string {
  const t = typeof raw === 'string' && raw.length <= 40 ? Date.parse(raw) : NaN;
  if (!Number.isFinite(t) || t < c.iat - CAPTURE_SKEW_MS || t > c.exp + CAPTURE_SKEW_MS) throw err(400, 'capture_time_invalid', 'La hora de la foto no coincide. Tómala de nuevo.');
  return new Date(t).toISOString();
}

// Un solo uso: (1) en esta instancia, un id ya firmado no se vuelve a firmar; (2) entre instancias, si el objeto ya
// existe en Storage el token está usado (y Storage sin upsert nunca deja escribir dos veces la misma ruta).
const signed = new Map<string, number>();
export const __resetCaptureForTests = () => signed.clear();
export function markSigned(id: string, now = Date.now()) {
  for (const [k, exp] of signed) if (exp < now) signed.delete(k);
  if (signed.has(id)) return false;
  signed.set(id, now + CAPTURE_TTL_MS + CAPTURE_SKEW_MS); return true;
}
/** ¿Ya hay una foto subida en la carpeta del token? */
export async function captureUploaded(storage: any, c: Pick<CaptureClaims, 'p' | 'id' | 'sub'>): Promise<boolean> {
  const dir = `${userDir(c.sub)}/${c.p}-${c.id}`;
  const { data, error } = await storage.from('listings').list(dir, { limit: 2, search: '0.jpg' });
  if (error) throw err(503, 'storage_unavailable', 'No pudimos revisar la foto. Intenta de nuevo.');
  return Array.isArray(data) && data.some((o: any) => o?.name === '0.jpg');
}

/** Fotos del anuncio de Facebook (data URLs que bajó el import): el servidor las guarda en la carpeta del usuario
 *  (<carpeta>/fb-<uuid>/0.<ext>) y devuelve sus URLs públicas en el mismo orden (null si una no se pudo guardar).
 *  Así un producto importado usa la foto del anuncio sin abrir ninguna vía de subida desde el teléfono. */
export async function storeImportedPhotos(storage: any, photos: string[], sub: string, maxBytes: number): Promise<(string | null)[]> {
  const out: (string | null)[] = [];
  for (const d of photos) {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(d);
    const ext = m ? FB_PHOTO_EXT[m[1]] : null;
    const buf = m ? Buffer.from(m[2], 'base64') : null;
    if (!m || !ext || !buf || !buf.length || buf.length > maxBytes) { out.push(null); continue; }
    const id = randomUUID(); const path = fbPhotoPath(sub, id, ext);
    try {
      const { error } = await storage.from('listings').upload(path, buf, { contentType: m[1], upsert: false });
      out.push(error ? null : `${publicPrefix(sub)}fb-${id}/0.${ext}`);
    } catch { out.push(null); }
  }
  return out;
}
