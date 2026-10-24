// "Importar de un link" (cliente): detecta el proveedor apenas se pega el link (para mostrar su nombre e icono mientras
// carga), pide al API los datos del anuncio y arma el aviso. No crea nada: el vendedor revisa y toca "Generar link".
// Ni el link ni el título van a analítica: solo proveedor, resultado y banderas.
import { api, guestApi } from './api';
import type { MeteoritoAuth } from './types';
import { COPY } from './copy';
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
export const blockedNotice = (_name?: string) => COPY.importLink.failed; // no nombra al proveedor

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

// --- Comprar → Invitar a un vendedor: el comprador pega el link del anuncio de CUALQUIER marketplace.
// Si el proveedor se deja leer (Facebook, Walmart, tiendas con datos públicos) se precargan nombre, precio y foto. Si no
// (Mercado Libre, Amazon, Encuentra24…), el link se acepta igual, sin error: va en la invitación para el vendedor.
export const INVITE_URL_INVALID = 'Pega el link completo del anuncio (empieza con https://).';
/** Marketplaces que se muestran en la hoja (iconos): son los que se aceptan, no una promesa de leerlos. */
export const INVITE_MARKETS: ProviderId[] = ['facebook', 'mercadolibre', 'amazon', 'encuentra24', 'walmart'];
export const inviteMarketsLabel = 'Pega el link del anuncio';

/** Comprador sin cuenta: mismo import_listing que Vender, identificado con su llave de invitado. */
export async function importFromLinkAsBuyer(auth: Pick<MeteoritoAuth, 'getAuthToken'>, raw: string): Promise<ListingImport> {
  const chk = checkListingUrl(raw);
  if (!chk.ok) throw Object.assign(new Error(INVITE_URL_INVALID), { code: 'import_url_invalid' });
  return guestApi<ListingImport>(auth, '/api/store', { action: 'import_listing', url: chk.url });
}

type Detected = NonNullable<ReturnType<typeof detectProvider>>;
/** Proveedor que no se lee (bloquea nuestros servidores): no nombra al proveedor. Copy final aprobado por Neo. */
export const INVITE_UNREAD = 'No pudimos leer ese anuncio. Escribe el nombre y el precio.';
/** Se intenta leer solo donde funciona; los proveedores que bloquean nuestros servidores no se piden. */
export const inviteCanRead = (d: Detected) => !d.blocked;
/** Línea debajo del campo apenas se pega el link (sin error para ningún proveedor). */
export const inviteDetectedLabel = (d: Detected) => d.blocked ? INVITE_UNREAD
  : d.id === 'web' ? `Anuncio de ${d.name}` : `Anuncio de ${d.name}: llenamos el nombre, el precio y la foto.`;

/** Aviso en el formulario después de pegar el link. `r` null = no se pidió (proveedor bloqueado) o falló la red. */
export function inviteImportNotice(d: Pick<Detected, 'name'>, r: ListingImport | null): { title: string; body: string } {
  const name = r?.provider_name || d.name;
  if (!r || r.result === 'failed') return { title: 'No pudimos leer ese anuncio.', body: 'Escribe el nombre y el precio. El vendedor verá el link del anuncio.' };
  if (r.result === 'partial') return { title: `Importamos parte de ${name}`, body: importNotice(r).body.replace('generar el link', 'crear la invitación') };
  const conv = importNotice(r).body.replace('Si todo está bien, genera tu link.', '').trim();
  return { title: `Importado de ${name}`, body: `${conv ? conv + ' ' : ''}Ajusta el precio si acordaste otro con el vendedor.` };
}
