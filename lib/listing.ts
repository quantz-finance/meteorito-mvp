// Link de venta en un paso: reglas puras (sin React ni red) para validar título, precio y fotos.
// El API (api/orders/create.ts) aplica los mismos límites; tests: scripts/ci/t32-link-1-paso.test.ts.
export const TITLE_MIN = 3;
export const TITLE_MAX = 80;
export const MIN_PRICE = 1000;
export const MAX_PRICE = 50_000_000;
export const MAX_PHOTOS = 4; // = límite de la columna orders.photos (cardinality <= 4)
/** Categoría por defecto de los links creados en un paso (la columna orders.category es NOT NULL). */
export const DEFAULT_CATEGORY = 'otro';

/** Solo dígitos: "₡185 000" -> 185000. Vacío -> 0. */
export function parsePrice(raw: string): number {
  const d = String(raw ?? '').replace(/\D/g, '').slice(0, 9);
  return d ? Number(d) : 0;
}

/** Formato de miles para el campo de precio mientras se escribe: "185000" -> "185 000". */
export function formatPriceInput(raw: string): string {
  const n = parsePrice(raw);
  return n ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : '';
}

export interface ListingInput { title: string; price: number; photos: number; photosBusy?: boolean }
export type ListingErrors = Partial<Record<'title' | 'price' | 'photos', string>>;

const fmt = (n: number) => '₡' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const PRICE_ERROR = `Ingresa un precio entre ${fmt(MIN_PRICE)} y ${fmt(MAX_PRICE)}.`;

/** Errores por campo (vacío = todo bien). */
export function validateListing(i: ListingInput): ListingErrors {
  const e: ListingErrors = {};
  const t = (i.title ?? '').trim();
  if (!t) e.title = 'Escribe qué vendes.';
  else if (t.length < TITLE_MIN) e.title = `El título necesita al menos ${TITLE_MIN} letras.`;
  else if (t.length > TITLE_MAX) e.title = `El título puede tener hasta ${TITLE_MAX} caracteres.`;
  if (!Number.isInteger(i.price) || i.price < MIN_PRICE || i.price > MAX_PRICE) e.price = PRICE_ERROR;
  if (i.photos < 1) e.photos = 'Agrega al menos una foto.';
  else if (i.photos > MAX_PHOTOS) e.photos = `Puedes subir hasta ${MAX_PHOTOS} fotos.`;
  else if (i.photosBusy) e.photos = 'Espera a que terminen de cargar las fotos.';
  return e;
}
export const isListingValid = (i: ListingInput) => Object.keys(validateListing(i)).length === 0;
