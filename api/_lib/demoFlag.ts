// Datos de EJEMPLO (productos, tiendas y ventas ficticias del feed de Comprar). Archivo mínimo (sin datos) para que la
// app lo pueda importar sin cargar la lista completa (api/_lib/demoProducts.ts, que se pide aparte solo cuando hace falta).
// ¿Se muestran? Lo elige CADA persona en su dispositivo (Mi cuenta -> "Modo de la app": "Datos de ejemplo"; lib/demoPref.ts;
// default "Testnet" = solo reales) y la app lo manda en cada pedido (?ejemplos=1 o { ejemplos: true }). El servidor decide por pedido con
// demoWanted: sin el parámetro, ningún ejemplo (y /t/<ejemplo> = 404). No hay estado global: lo de uno no afecta a otro.
// Freno de emergencia sin deploy de código: FEED_DEMO_PRODUCTS=0 en el entorno de Vercel los apaga para todos.

/** Los slugs de los productos de ejemplo empiezan así. Los reales son 6 letras/números sin guion: nunca chocan. */
export const DEMO_PRODUCT_PREFIX = 'ej-';
export const looksLikeDemoProduct = (slug: unknown): boolean => typeof slug === 'string' && slug.startsWith(DEMO_PRODUCT_PREFIX) && /^ej-[a-z0-9-]{2,40}$/.test(slug);
/** Freno de emergencia (servidor): FEED_DEMO_PRODUCTS=0 apaga los ejemplos pase lo que pase (los tests viejos corren con 0). */
export function demoKilledByEnv(): boolean {
  try { return typeof process !== 'undefined' && process.env?.FEED_DEMO_PRODUCTS === '0'; } catch { return false; }
}
/** ¿Este pedido pide los datos de ejemplo? (?ejemplos=1 en GET o { ejemplos: true } en POST). Default: no. */
export function demoWanted(req: { query?: any; body?: any } | null | undefined): boolean {
  if (demoKilledByEnv() || !req) return false;
  return req.query?.ejemplos === '1' || req.body?.ejemplos === true;
}
