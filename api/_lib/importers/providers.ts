// Proveedores de "Importar de un link" (PURO: sin red ni node:*; lo usan el API y el cliente para mostrar el proveedor
// apenas se pega el link). Cada proveedor declara sus dominios base; los subdominios cuentan (articulo.mercadolibre.com.mx).
// Probado contra links reales el 2026-10-24 DESDE PRODUCCIÓN (IPs de Vercel; ver docs/marketplace-import.md). `status`:
//  - 'ok': se lee sin credenciales desde el servidor.
//  - 'blocked': el sitio exige verificación o bloquea servidores (403 / "verifica tu identidad"). No se muestra como
//    soportado ni se intenta: el vendedor ve el mensaje amable y sube las fotos con la cámara.
export type ProviderId = 'facebook' | 'mercadolibre' | 'encuentra24' | 'amazon' | 'aliexpress' | 'walmart' | 'shopee' | 'olx' | 'falabella' | 'temu' | 'web';
export interface Provider { id: ProviderId; name: string; hosts: string[]; short?: string[]; status: 'ok' | 'blocked' }

const MELI_TLDS = ['com.mx', 'com.ar', 'com.co', 'cl', 'com.pe', 'com.uy', 'com.ec', 'com.ve', 'co.cr', 'com.gt', 'com.pa', 'com.do', 'com.bo', 'com.py', 'com.hn', 'com.ni', 'com.sv'];
export const PROVIDERS: Provider[] = [
  { id: 'facebook', name: 'Facebook', hosts: ['facebook.com'], short: ['fb.me'], status: 'ok' },
  { id: 'mercadolibre', name: 'Mercado Libre', hosts: [...MELI_TLDS.map((t) => `mercadolibre.${t}`), 'mercadolivre.com.br'], short: ['meli.la'], status: 'blocked' },
  { id: 'encuentra24', name: 'Encuentra24', hosts: ['encuentra24.com'], status: 'blocked' },
  { id: 'amazon', name: 'Amazon', hosts: ['amazon.com', 'amazon.com.mx', 'amazon.com.br', 'amazon.es'], short: ['a.co', 'amzn.to', 'amzn.eu'], status: 'blocked' },
  { id: 'aliexpress', name: 'AliExpress', hosts: ['aliexpress.com', 'aliexpress.us'], short: ['a.aliexpress.com', 's.click.aliexpress.com'], status: 'blocked' },
  { id: 'walmart', name: 'Walmart', hosts: ['walmart.co.cr'], status: 'ok' }, // walmart.com.mx bloquea servidores (/blocked): queda como página genérica
  { id: 'shopee', name: 'Shopee', hosts: ['shopee.com.br', 'shopee.com.mx', 'shopee.com.co', 'shopee.cl'], short: ['shope.ee'], status: 'blocked' },
  { id: 'olx', name: 'OLX', hosts: ['olx.com.br'], status: 'blocked' },
  { id: 'falabella', name: 'Falabella', hosts: ['falabella.com', 'falabella.com.co', 'falabella.com.pe'], status: 'blocked' },
  { id: 'temu', name: 'Temu', hosts: ['temu.com'], short: ['share.temu.com'], status: 'blocked' },
];
export const WEB_PROVIDER: Provider = { id: 'web', name: 'la página', hosts: [], status: 'ok' };

const under = (h: string, base: string) => h === base || h.endsWith('.' + base);
/** Host -> proveedor (o null si es otro sitio). */
export function providerForHost(host: string): Provider | null {
  const h = host.toLowerCase().replace(/\.$/, '');
  return PROVIDERS.find((p) => p.hosts.some((b) => under(h, b)) || (p.short ?? []).some((b) => under(h, b))) ?? null;
}
export const isShortLink = (host: string) => PROVIDERS.some((p) => (p.short ?? []).some((b) => under(host.toLowerCase(), b)));

export const IMPORT_URL_INVALID = 'Pega el link completo de tu anuncio (empieza con https://).';
export const IMPORT_FAILED = 'Todavía no podemos leer ese link. Tómale foto a tu anuncio y súbela.'; // = COPY.importLink.failed (lib/copy.ts); sin nombrar al proveedor

/** Texto pegado -> primera URL https pública con pinta de anuncio. Acepta texto alrededor ("Mira esto: https://…") y sin https://. */
export function checkListingUrl(input: unknown): { ok: true; url: string; provider: Provider } | { ok: false; url: null; error: string } {
  const bad = { ok: false as const, url: null, error: IMPORT_URL_INVALID };
  if (typeof input !== 'string' || input.length > 2000) return bad;
  const tok = input.split(/\s+/).map((w) => w.replace(/^[<("']+|[>)"'.,;]+$/g, '')).find((w) => /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|\?)/i.test(w));
  if (!tok) return bad;
  let u: URL; try { u = new URL(/^https?:\/\//i.test(tok) ? tok.replace(/^http:/i, 'https:') : 'https://' + tok); } catch { return bad; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return bad;
  const host = u.hostname.toLowerCase();
  // Nombres internos o IPs literales: nunca (la red vuelve a validar cada IP resuelta; esto es solo para responder rápido).
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[') || /\.(local|internal|localhost|lan|home|corp)$/.test(host)) return bad;
  u.hash = '';
  return { ok: true, url: u.toString(), provider: providerForHost(host) ?? WEB_PROVIDER };
}

/** Proveedores que se muestran como soportados en la pantalla (iconos + nombres). */
export const SUPPORTED = PROVIDERS.filter((p) => p.status === 'ok');

/** Origen del producto importado (columnas source_url/source_provider, migración 019). Inválido -> {} (no se guarda). */
export function listingSource(url: unknown, provider: unknown): { source_url?: string; source_provider?: ProviderId } {
  if (typeof url !== 'string' || url.length > 1000) return {};
  const chk = checkListingUrl(url);
  if (!chk.ok || chk.url.length > 1000) return {};
  const id = [...PROVIDERS.map((p) => p.id), 'web'].includes(provider as ProviderId) ? (provider as ProviderId) : chk.provider.id;
  return { source_url: chk.url, source_provider: id };
}
