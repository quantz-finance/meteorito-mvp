// Paso posterior a la subida firmada (/api/photos/upload-url): el teléfono sube los bytes directo a Storage, así que el
// servidor no los ve al firmar. Cuando una foto se USA (publicar, invitación, envío, disputa, respuesta, foto de la
// tienda), la descargamos con la service role, le quitamos EXIF/GPS/XMP/IPTC/comentarios (stripMeta, sin recodificar) y
// sobrescribimos el mismo objeto. Mejor esfuerzo: si Storage falla no se bloquea el flujo (se registra y sigue).
import { env } from './env';
import { MAX_PHOTO_BYTES } from './photos';
import { stripImageMetadata } from './stripMeta';

const BUCKET = 'listings';
const TIMEOUT_MS = 8000;

/** Ruta dentro del bucket público "listings" para una URL pública nuestra; cualquier otra URL -> null. */
export function bucketPath(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > 400) return null;
  const prefix = `${env.supabaseUrl()}/storage/v1/object/public/${BUCKET}/`;
  if (!url.startsWith(prefix)) return null;
  const path = url.slice(prefix.length);
  return /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_.-]{1,200}\/[0-9]\.(jpg|png|webp)$/.test(path) ? path : null;
}

const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

async function scrubOne(storage: any, path: string): Promise<'clean' | 'stripped' | 'skipped'> {
  const bucket = storage.from(BUCKET);
  if (typeof bucket.download !== 'function') return 'skipped';
  const { data, error } = await bucket.download(path);
  if (error || !data) return 'skipped';
  const bytes = new Uint8Array(typeof data.arrayBuffer === 'function' ? await data.arrayBuffer() : data);
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES * 2) return 'skipped';
  const r = stripImageMetadata(bytes);
  if (!r.changed) return 'clean';
  const ext = path.slice(path.lastIndexOf('.') + 1);
  const up = await bucket.upload(path, Buffer.from(r.bytes), { contentType: MIME[ext] ?? 'image/jpeg', upsert: true });
  if (up?.error) throw new Error(up.error.message ?? 'upload');
  return 'stripped';
}

/** Quita metadatos de las fotos (URLs públicas nuestras) ya subidas. Ignora URLs ajenas y duplicadas. Nunca lanza. */
export async function scrubStoredPhotos(storage: any, urls: unknown[]): Promise<Record<string, 'clean' | 'stripped' | 'skipped' | 'error'>> {
  const out: Record<string, 'clean' | 'stripped' | 'skipped' | 'error'> = {};
  const paths = [...new Set(urls.map(bucketPath).filter((p): p is string => !!p))];
  if (typeof storage?.from !== 'function' || !paths.length) return out;
  const work = Promise.all(paths.map(async (p) => {
    try { out[p] = await scrubOne(storage, p); }
    catch (e: any) { out[p] = 'error'; console.warn('photo_scrub_failed', { path: p, error: String(e?.message ?? e).slice(0, 200) }); }
  }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise<void>((res) => { timer = setTimeout(() => { console.warn('photo_scrub_timeout', { n: paths.length }); res(); }, TIMEOUT_MS); })]);
  if (timer) clearTimeout(timer);
  return out;
}
