import { createHash } from 'node:crypto';
import { env } from './env';
export const MAX_PHOTOS = 4;
export const MAX_PHOTO_BYTES = 1_048_576;
export const PHOTO_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
/** Carpeta del usuario en el bucket: el sub de Cavos si es seguro para rutas, si no un hash estable. */
export const userDir = (sub: string) => (/^[A-Za-z0-9_-]{1,64}$/.test(sub) ? sub : 'h' + createHash('sha256').update(sub).digest('hex').slice(0, 40));
export const publicPrefix = (sub: string) => `${env.supabaseUrl()}/storage/v1/object/public/listings/${userDir(sub)}/`;
