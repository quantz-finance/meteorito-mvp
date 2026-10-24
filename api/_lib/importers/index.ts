// "Importar de un link": cualquier anuncio público (Facebook, Mercado Libre, Encuentra24, Amazon, AliExpress, Walmart…)
// -> datos para precargar Vender. Facebook usa su importador de siempre (fbimport.ts, allowlist de FB). El resto:
// página con protección SSRF (net.ts) -> parser del proveedor o genérico (parse.ts) -> hasta 4 fotos como data URL
// (el cliente las comprime y sube por la vía normal, igual que la foto de FB). Nunca lanza: si no se puede, 'failed'.
import { importFacebookListing } from '../fbimport';
import { checkFacebookUrl } from '../fbparse';
import { checkListingUrl, IMPORT_FAILED, providerForHost, WEB_PROVIDER, type Provider, type ProviderId } from './providers';
import { ImportNetError, safeGet, type NetDeps } from './net';
import { MAX_IMPORT_PHOTOS, parseFor, suggestCrc, type Price } from './parse';

export interface ListingImport {
  result: 'success' | 'partial' | 'failed';
  provider: ProviderId; provider_name: string; source_url: string | null;
  title: string | null; price_crc: number | null; price_source: Price | null; converted: boolean;
  description: string | null; photos: string[]; missing: ('title' | 'price' | 'photos')[]; message?: string; code?: string;
}
// Navegador móvil (como cualquier persona que abre el link) y, si la página no trae datos, un agente honesto de vista previa.
const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
export const UA_PREVIEW = 'Mozilla/5.0 (compatible; MeteoritoLinkPreview/1.0; +https://meteorito.app)';
const MAX_HTML = 3 * 1024 * 1024;  // Amazon y Walmart traen todo en el HTML (1-2 MB)
const MAX_IMAGE = 4 * 1024 * 1024;
/** Bytes de imagen real (JPEG, PNG o WebP: lo que acepta el bucket), no lo que diga el content-type. */
export const isImageBytes = (b: Uint8Array) => (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45);
/** Muro de verificación / login: la página existe pero no deja ver el anuncio. */
const isWall = (url: string, html: string) => /\/(account-verification|login|signin|captcha|blocked)\b/i.test(new URL(url).pathname) || /<title>\s*(Verifica tu identidad|Attention Required|Robot Check)/i.test(html)
  || /action="[^"]*\/errors\/validateCaptcha/i.test(html); // captcha de Amazon desde IPs de datacenter (título "Amazon.com.mx")
/** Título que solo es el nombre del sitio ("Amazon.com.mx", "Walmart"): no es el producto. */
export const siteOnlyTitle = (title: string, url: string, name: string) => { const t = title.trim().toLowerCase(); const h = new URL(url).hostname.replace(/^www\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(t) || t === h || t === name.toLowerCase(); };
/** Link guardado en el producto: sin query ni fragmento (rastreadores, afiliados). */
const canonical = (u: string) => { const x = new URL(u); x.search = ''; x.hash = ''; return x.toString(); };

const parseClean = (p: Provider, html: string, url: string) => { const r = parseFor(p.id, html, url); return r.title && siteOnlyTitle(r.title, url, p.name) ? { ...r, title: null } : r; };

let testNet: NetDeps | null = null;
/** Solo tests: red simulada (resolver + requester), nunca en runtime. */
export const __setImportNetForTests = (d: NetDeps | null) => { testNet = d; };

const failed = (p: Provider, code: string, source_url: string | null = null): ListingImport => ({ result: 'failed', provider: p.id, provider_name: p.name, source_url,
  title: null, price_crc: null, price_source: null, converted: false, description: null, photos: [], missing: ['title', 'price', 'photos'], message: IMPORT_FAILED, code });

/** `ignoreStatus`: solo tests, para seguir probando los extractores de proveedores excluidos (por si vuelven a abrir). */
export async function importListing(input: unknown, deps: { rate: number; timeoutMs?: number; net?: NetDeps; ignoreStatus?: boolean }): Promise<ListingImport> {
  const chk = checkListingUrl(input);
  if (!chk.ok) return failed(WEB_PROVIDER, 'bad_url');
  let provider = chk.provider;
  if (provider.id === 'facebook') { // el de siempre (allowlist FB y su propio fetch)
    const fb = checkFacebookUrl(chk.url);
    if (!fb.ok) return failed(provider, 'bad_url');
    const r = await importFacebookListing(fb.url, { rate: deps.rate });
    return { ...r, provider: 'facebook', provider_name: 'Facebook', source_url: canonical(fb.url), ...(r.result === 'failed' ? { message: IMPORT_FAILED, code: 'unreadable' } : {}) };
  }
  if (provider.status === 'blocked' && !deps.ignoreStatus) return failed(provider, 'provider_blocked');
  const net = deps.net ?? testNet ?? {};
  const ms = deps.timeoutMs ?? 8000;
  const t0 = Date.now(); const left = () => Math.max(500, ms - (Date.now() - t0));
  let page: { url: string; html: string } | null = null; let code = 'unreadable';
  for (const ua of [UA_MOBILE, UA_PREVIEW]) {
    try {
      const r = await safeGet(chk.url, { kind: 'html', ua, maxBytes: MAX_HTML, timeoutMs: left() }, net);
      const html = r.body.toString('utf8');
      const finalHost = new URL(r.url).hostname;
      const p2 = providerForHost(finalHost);
      if (p2 && p2.id !== provider.id) provider = p2; // link corto o redirección a otro proveedor conocido
      if (provider.status === 'blocked' && !deps.ignoreStatus) return failed(provider, 'provider_blocked');
      if (isWall(r.url, html)) { code = 'wall'; continue; }
      const parsed = parseClean(provider, html, r.url);
      if (parsed.title || parsed.price) { page = { url: r.url, html }; break; }
    } catch (e) {
      code = e instanceof ImportNetError ? (e.code === 'http' && /^\d{3}$/.test(e.message) ? `http_${e.message}` : e.code) : 'network'; // http_403: el sitio rechaza la IP del servidor
      if (e instanceof ImportNetError && ['bad_url', 'blocked_host', 'private_ip', 'dns', 'too_many_redirects'].includes(e.code)) break; // no reintentar
    }
  }
  if (!page) return failed(provider, code, canonical(chk.url));
  const parsed = parseClean(provider, page.html, page.url);
  // Fotos en paralelo: cada una con la misma protección SSRF (pueden estar en otro host/CDN).
  const imgs = await Promise.all(parsed.images.slice(0, MAX_IMPORT_PHOTOS + 2).map(async (u) => {
    try {
      const r = await safeGet(u, { kind: 'image', ua: UA_MOBILE, maxBytes: MAX_IMAGE, timeoutMs: Math.min(5000, left()) }, net);
      if (!r.body.byteLength || !isImageBytes(r.body)) return null;
      return `data:${r.contentType === 'image/jpg' ? 'image/jpeg' : r.contentType};base64,${r.body.toString('base64')}`;
    } catch { return null; }
  }));
  const photos = imgs.filter((x): x is string => !!x).slice(0, MAX_IMPORT_PHOTOS);
  const price_crc = suggestCrc(parsed.price, deps.rate);
  const missing: ListingImport['missing'] = [];
  if (!parsed.title) missing.push('title'); if (!price_crc) missing.push('price'); if (!photos.length) missing.push('photos');
  return { result: missing.length ? 'partial' : 'success', provider: provider.id, provider_name: provider.id === 'web' ? new URL(page.url).hostname.replace(/^www\./, '') : provider.name,
    source_url: canonical(page.url), title: parsed.title, price_crc, price_source: parsed.price, converted: !!parsed.price && parsed.price.currency !== 'CRC' && !!price_crc,
    description: parsed.description, photos, missing };
}
