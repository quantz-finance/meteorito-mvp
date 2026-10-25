// Datos de EJEMPLO (productos, tiendas y ventas ficticias del feed de Comprar). Archivo mínimo (sin datos) para que la
// app lo pueda importar sin cargar la lista completa (api/_lib/demoProducts.ts, que se pide aparte solo cuando hace falta).
// ¿Se muestran? Lo decide el SERVIDOR con un solo interruptor: app_settings.demo_data_enabled (migración 032), que cambia
// el admin maestro en la app (Mi cuenta -> "Datos de ejemplo"). Ver api/_lib/appSettings.ts (demoDataOn).
// Freno de emergencia sin deploy de código: FEED_DEMO_PRODUCTS=0 en el entorno de Vercel los apaga aunque el interruptor esté encendido.

/** Los slugs de los productos de ejemplo empiezan así. Los reales son 6 letras/números sin guion: nunca chocan. */
export const DEMO_PRODUCT_PREFIX = 'ej-';
export const looksLikeDemoProduct = (slug: unknown): boolean => typeof slug === 'string' && slug.startsWith(DEMO_PRODUCT_PREFIX) && /^ej-[a-z0-9-]{2,40}$/.test(slug);
/** Freno de emergencia (servidor): FEED_DEMO_PRODUCTS=0 apaga los ejemplos pase lo que pase (los tests viejos corren con 0). */
export function demoKilledByEnv(): boolean {
  try { return typeof process !== 'undefined' && process.env?.FEED_DEMO_PRODUCTS === '0'; } catch { return false; }
}
