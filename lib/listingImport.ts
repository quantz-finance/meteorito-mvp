// "Importar de un link" (cliente): detecta el proveedor apenas se pega el link (para mostrar su nombre e icono mientras
// carga), pide al API los datos del anuncio y arma el aviso. No crea nada: el vendedor revisa y toca "Generar link".
// Ni el link ni el título van a analítica: solo proveedor, resultado y banderas.
import { api } from './api';
import type { MeteoritoAuth } from './types';
import { checkListingUrl, IMPORT_FAILED, SUPPORTED, type ProviderId } from '../api/_lib/importers/providers'; // pura y chica
export { checkListingUrl, IMPORT_FAILED, IMPORT_URL_INVALID, SUPPORTED } from '../api/_lib/importers/providers';

export interface ListingImport {
  result: 'success' | 'partial' | 'failed'; provider: ProviderId; provider_name: string; source_url: string | null;
  /** las mismas fotos guardadas por el servidor (import-<clave>-<uuid>), en el mismo orden; null si una no se pudo */
  photo_urls?: (string | null)[];
  title: string | null; price_crc: number | null; price_source: { amount: number; currency: string } | null; converted: boolean;
  description: string | null; photos: string[]; missing: ('title' | 'price' | 'photos')[]; message?: string; code?: string;
}

/** Icono (Ionicons, del subset de la app) de cada proveedor. */
export const PROVIDER_ICON: Record<ProviderId, string> = {
  facebook: 'logo-facebook', mercadolibre: 'pricetag', encuentra24: 'storefront', amazon: 'logo-amazon', aliexpress: 'bag-handle',
  walmart: 'cart', shopee: 'bag-handle', olx: 'storefront', falabella: 'storefront', temu: 'bag-handle', web: 'globe-outline',
};
/** Proveedor del texto pegado (o null si todavía no es un link). */
export function detectProvider(raw: string): { id: ProviderId; name: string; icon: string; blocked: boolean } | null {
  const c = checkListingUrl(raw);
  return c.ok ? { id: c.provider.id, name: c.provider.id === 'web' ? new URL(c.url).hostname.replace(/^www\./, '') : c.provider.name, icon: PROVIDER_ICON[c.provider.id], blocked: c.provider.status === 'blocked' } : null;
}
/** Proveedor que no deja leer sus anuncios desde nuestros servidores: se avisa al pegar, sin intentar. */
export const blockedNotice = (name: string) => `Todavía no podemos leer anuncios de ${name}; súbelo con la cámara.`;

export async function importFromLink(auth: MeteoritoAuth, raw: string): Promise<ListingImport> {
  const chk = checkListingUrl(raw);
  if (!chk.ok) throw Object.assign(new Error(chk.error), { code: 'import_url_invalid' });
  return api<ListingImport>(auth, '/api/store', { action: 'import_listing', url: chk.url });
}

/** "Facebook, Mercado Libre, Encuentra24 y más": los primeros proveedores soportados de verdad. */
export const supportedLabel = (n = 3) => `${SUPPORTED.slice(0, n).map((p) => p.name).join(', ')} y más`;

/** Propiedades de import_succeeded / import_failed: sin URL, título, precio ni texto. */
export const importProps = (r: Pick<ListingImport, 'provider' | 'result' | 'title' | 'price_crc' | 'photos' | 'description' | 'converted'>) =>
  ({ provider: r.provider, result: r.result, has_title: !!r.title, has_price: !!r.price_crc, photos: r.photos.length, has_description: !!r.description, converted: !!r.converted });

const CURRENCY_LABEL: Record<string, string> = { USD: 'US$', MXN: 'MX$', BRL: 'R$', EUR: '€', COP: 'COL$', CLP: 'CLP$', PEN: 'S/', UYU: '$U', GTQ: 'Q', PAB: 'B/.' };
/** Aviso en tuteo según el resultado. */
export function importNotice(r: ListingImport): { title: string; body: string } {
  if (r.result === 'failed') return { title: IMPORT_FAILED, body: 'Puede ser privado, ya no estar publicado o la página no deja leerlo.' };
  const conv = r.converted && r.price_source ? `Sugerido de ${CURRENCY_LABEL[r.price_source.currency] ?? r.price_source.currency + ' '}${r.price_source.amount.toLocaleString('en-US')}: confírmalo. ` : '';
  const falta = r.missing.map((m) => (m === 'title' ? 'el nombre' : m === 'price' ? 'el precio' : 'las fotos'));
  if (r.result === 'partial') return { title: `Importamos parte de ${r.provider_name}`, body: `${conv}Completa ${falta.join(' y ')} y revisa todo antes de generar el link.` };
  return { title: `Importado de ${r.provider_name}`, body: `${conv}Si todo está bien, genera tu link.` };
}
