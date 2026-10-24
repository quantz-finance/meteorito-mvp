// Importar de Facebook Marketplace (cliente): pide al API los datos del anuncio y los deja listos para precargar Vender.
// No crea nada: el vendedor revisa y toca "Generar link" (o el comprador, "Crear invitación"). El link de FB nunca se
// manda a analítica; solo la invitación del comprador lo guarda, como referencia para el vendedor.
import { api, guestApi } from './api';
import type { MeteoritoAuth } from './types';
import { checkFacebookUrl, FB_IMPORT_FAILED } from '../api/_lib/fbparse'; // pura y chica
export { checkFacebookUrl, FB_IMPORT_FAILED, FB_URL_INVALID } from '../api/_lib/fbparse';

export type FbImportResultKind = 'success' | 'partial' | 'failed';
export interface FbImport {
  result: FbImportResultKind; title: string | null; price_crc: number | null; price_source: { amount: number; currency: string } | null;
  converted: boolean; description: string | null; photos: string[]; /** la misma foto guardada por el servidor (fb-<uuid>), en el mismo orden; null si no se pudo */ photo_urls?: (string | null)[]; missing: ('title' | 'price' | 'photos')[]; message?: string;
}

export async function importFromFacebook(auth: MeteoritoAuth, raw: string): Promise<FbImport> {
  const chk = checkFacebookUrl(raw);
  if (!chk.ok) throw Object.assign(new Error(chk.error), { code: 'fb_url_invalid' });
  return api<FbImport>(auth, '/api/store', { action: 'import_facebook', url: chk.url });
}

/** Comprador sin cuenta (Comprar → Invitar a un vendedor): mismo import, identificado con su llave de invitado. */
export async function importFromFacebookAsBuyer(auth: Pick<MeteoritoAuth, 'getAuthToken'>, raw: string): Promise<FbImport> {
  const chk = checkFacebookUrl(raw);
  if (!chk.ok) throw Object.assign(new Error(chk.error), { code: 'fb_url_invalid' });
  return guestApi<FbImport>(auth, '/api/store', { action: 'import_facebook', url: chk.url });
}

/** Foto importada (data URL del API o archivo propio en demo) -> Blob. Nada de URLs externas. */
export async function importedPhotoBlob(src: string): Promise<Blob> {
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(src) && !/^\/[a-z0-9/_-]+\.(jpg|png|webp)$/i.test(src)) throw new Error('foto inválida');
  return (await fetch(src)).blob();
}

/** Propiedades del evento facebook_import: solo resultado y banderas (sin URL, título, precio ni texto). */
export const fbImportProps = (r: Pick<FbImport, 'result' | 'title' | 'price_crc' | 'photos' | 'description' | 'converted'> | null, code?: string) => r
  ? { result: r.result, has_title: !!r.title, has_price: !!r.price_crc, photos: r.photos.length, has_description: !!r.description, converted: !!r.converted }
  : { result: 'failed' as const, has_title: false, has_price: false, photos: 0, has_description: false, converted: false, code: String(code ?? 'unknown').slice(0, 40) };

/** Aviso en tuteo según el resultado. */
export function fbImportNotice(r: FbImport): { title: string; body: string } {
  if (r.result === 'failed') return { title: FB_IMPORT_FAILED, body: 'Puede ser privado o ya no estar publicado.' };
  const conv = r.converted && r.price_source ? `Convertimos US$${r.price_source.amount.toLocaleString('en-US')} a colones. ` : '';
  const falta = r.missing.map((m) => (m === 'title' ? 'el nombre' : m === 'price' ? 'el precio' : 'las fotos'));
  if (r.result === 'partial') return { title: 'Importamos lo que pudimos', body: `${conv}Completa ${falta.join(' y ')} y revisa todo antes de generar el link.` };
  return { title: 'Listo, revisa los datos', body: `${conv}Si todo está bien, genera tu link.` };
}
