// Productos de EJEMPLO del feed de Comprar: el interruptor. Archivo mínimo (sin datos) para que la app lo pueda importar
// sin cargar la lista completa (api/_lib/demoProducts.ts, que se pide aparte solo cuando hace falta).
// Apagarlos: FEED_DEMO_PRODUCTS = false (o, sin deploy de código, la variable de entorno FEED_DEMO_PRODUCTS=0 en Vercel).

export const FEED_DEMO_PRODUCTS = true;
/** Los slugs de los productos de ejemplo empiezan así. Los reales son 6 letras/números sin guion: nunca chocan. */
export const DEMO_PRODUCT_PREFIX = 'ej-';
export const looksLikeDemoProduct = (slug: unknown): boolean => typeof slug === 'string' && slug.startsWith(DEMO_PRODUCT_PREFIX) && /^ej-[a-z0-9-]{2,40}$/.test(slug);
/** ¿Se muestran? El flag del código y, en el servidor, FEED_DEMO_PRODUCTS=0 los apaga (los tests viejos corren con 0). */
export function demoProductsOn(): boolean {
  if (!FEED_DEMO_PRODUCTS) return false;
  try { return typeof process === 'undefined' || process.env?.FEED_DEMO_PRODUCTS !== '0'; } catch { return true; }
}
