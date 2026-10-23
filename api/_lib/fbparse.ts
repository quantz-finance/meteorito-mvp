// Importar de Facebook Marketplace: reglas PURAS (sin red ni node:*), las usa el API y el cliente.
// Qué expone FB sin login (probado 2026-10-23, ver docs/facebook-import.md): solo etiquetas OG en el <head>.
//  - og:title = título del anuncio; og:image = UNA foto (CDN fbcdn.net con firma que vence);
//  - con user agent de navegador móvil, og:description = "Título - ₡18000, in San Joaquin, Heredia." (de ahí sale el precio);
//  - con facebookexternalhit, og:description = la descripción que escribió el vendedor.
//  - Sin JSON-LD ni product:price:* (se soportan igual por si aparecen). Sin login: muro de login (/login).

export const FB_IMPORT_FAILED = 'No pudimos leer ese anuncio, completa los datos.';
export const FB_URL_INVALID = 'Pega el link de un anuncio de Facebook Marketplace.';
const TITLE_MAX = 80;
const DESC_MAX = 2000;

const hostOk = (h: string, base: string) => h === base || h.endsWith('.' + base);
/** Páginas que se pueden pedir: facebook.com (y subdominios) y fb.me. Nada más (SSRF). */
export const isAllowedPageHost = (host: string) => { const h = host.toLowerCase(); return hostOk(h, 'facebook.com') || h === 'fb.me' || h === 'www.fb.me'; };
/** Fotos: solo el CDN de FB. */
export const isAllowedImageHost = (host: string) => { const h = host.toLowerCase(); return hostOk(h, 'fbcdn.net') || h === 'lookaside.fbsbx.com'; };

/** URL segura de pedir: https, sin usuario/clave, sin puerto, host permitido. */
export function safeUrl(raw: string, allow: (host: string) => boolean): URL | null {
  let u: URL; try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  return allow(u.hostname) ? u : null;
}

/** Link pegado por el vendedor -> URL de anuncio de Marketplace (o error). Acepta texto alrededor y sin https://. */
export function checkFacebookUrl(input: unknown): { ok: true; url: string } | { ok: false; url: null; error: string } {
  const bad = { ok: false as const, url: null, error: FB_URL_INVALID };
  if (typeof input !== 'string' || input.length > 2000) return bad;
  // Primer "token" del texto pegado que mencione facebook.com o fb.me; se valida la URL COMPLETA (sin extraer pedazos).
  const tok = input.split(/\s+/).find((w) => /(facebook\.com|fb\.me)/i.test(w));
  if (!tok) return bad;
  const raw = /^[a-z][a-z0-9+.-]*:/i.test(tok) ? tok : 'https://' + tok;
  const u = safeUrl(raw, isAllowedPageHost);
  if (!u) return bad;
  const isFbMe = u.hostname.toLowerCase().endsWith('fb.me');
  if (!isFbMe && !/^\/(marketplace\/item\/\d+|share\/(?:[a-z]\/)?[A-Za-z0-9_-]+)/i.test(u.pathname)) return bad;
  if (isFbMe && u.pathname.length < 2) return bad;
  return { ok: true, url: u.toString() };
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return all; } }
    return NAMED[e.toLowerCase()] ?? all;
  });
}

export interface FbPrice { amount: number; currency: string }
/** "₡25.000", "₡18000", "CRC 25,000", "$12600", "US$1,250.50" -> { amount, currency }. Gratis/sin precio -> null. */
export function parseFbPrice(text: string): FbPrice | null {
  const m = String(text ?? '').match(/(₡|CRC|US\$|USD|\$)\s?(\d[\d.,\u00a0\u202f ]*)/i);
  if (!m) return null;
  const sym = m[1].toUpperCase();
  const currency = sym === '₡' || sym === 'CRC' ? 'CRC' : 'USD';
  let n = m[2].replace(/[\u00a0\u202f ]/g, '').replace(/[.,]$/, '');
  const dec = n.match(/[.,](\d{1,2})$/); // decimales: separador seguido de 1-2 dígitos al final
  let amount: number;
  if (dec && currency === 'USD') amount = Number(n.slice(0, -dec[0].length).replace(/[.,]/g, '') + '.' + dec[1]);
  else amount = Number(n.replace(/[.,]/g, ''));
  return Number.isFinite(amount) && amount > 0 ? { amount, currency } : null;
}

/** Precio a colones enteros (formato del app). USD al tipo de cambio, redondeado a ₡100. Otra moneda -> null. */
export function toCrc(p: FbPrice | null, rate: number): number | null {
  if (!p) return null;
  if (p.currency === 'CRC') return Math.round(p.amount);
  if (p.currency === 'USD' && rate > 0) return Math.round((p.amount * rate) / 100) * 100;
  return null;
}

export interface ParsedListing { title: string | null; description: string | null; price: FbPrice | null; images: string[]; isListing: boolean; loginWall: boolean }

function metas(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = tag.match(/\b(?:property|name)\s*=\s*"([^"]+)"/i)?.[1]?.toLowerCase();
    const val = tag.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1];
    if (key && val != null && !out.has(key)) out.set(key, decodeEntities(val));
  }
  return out;
}
function jsonLd(html: string): any[] {
  const out: any[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const j = JSON.parse(m[1]); out.push(...(Array.isArray(j) ? j : [j])); } catch { /* JSON-LD roto: se ignora */ }
  }
  return out;
}
const cleanTitle = (t: string) => {
  const s = t.replace(/\s+/g, ' ').trim();
  if (s.length <= TITLE_MAX) return s;
  const cut = s.slice(0, TITLE_MAX); const sp = cut.lastIndexOf(' ');
  return (sp > 40 ? cut.slice(0, sp) : cut).trim();
};

/** HTML de una página de FB -> datos del anuncio. Solo cuenta como anuncio si og:url es de /marketplace/item/. */
export function parseListingHtml(html: string): ParsedListing {
  const head = html.split(/<\/head>/i)[0];
  const m = metas(head);
  const ld = jsonLd(head).find((j) => /product/i.test(String(j?.['@type'] ?? ''))) ?? null;
  const ogUrl = m.get('og:url') ?? '';
  const isListing = /facebook\.com\/marketplace\/item\/\d+/i.test(ogUrl);
  const loginWall = !isListing && (/\/login|checkpoint/i.test(ogUrl) || /login_form|id="login"|\/login\/?\?/i.test(html) || m.has('og:title'));
  const rawTitle = isListing ? (m.get('og:title') ?? ld?.name ?? null) : null;
  const title = rawTitle ? cleanTitle(rawTitle) || null : null;

  // Precio: product:price:* / JSON-LD si existen; si no, el resumen "Título - ₡18000, in …" del og:description móvil.
  let price: FbPrice | null = null;
  const amt = Number(m.get('product:price:amount') ?? ld?.offers?.price);
  const cur = String(m.get('product:price:currency') ?? ld?.offers?.priceCurrency ?? '').toUpperCase();
  if (isListing && Number.isFinite(amt) && amt > 0 && /^[A-Z]{3}$/.test(cur)) price = { amount: amt, currency: cur };
  const desc = m.get('og:description') ?? m.get('description') ?? '';
  const summary = !!rawTitle && desc.startsWith(rawTitle.slice(0, 30)) && / - (?:₡|CRC|US\$|\$|USD)?\s?[\d.,]+|, in /.test(desc.slice(0, rawTitle.length + 60));
  if (isListing && !price && summary) price = parseFbPrice(desc.slice(Math.max(0, desc.indexOf(' - ', Math.min(rawTitle!.length, desc.length) - 5))));
  // Descripción: solo si es texto del vendedor (no el resumen generado ni una copia del título).
  const d = desc.replace(/\r/g, '').trim();
  const description = isListing && d && !summary && !d.startsWith(rawTitle ?? '\u0000') ? d.slice(0, DESC_MAX) : null;

  const imgs = [m.get('og:image'), m.get('og:image:secure_url'), m.get('twitter:image'), ...(Array.isArray(ld?.image) ? ld.image : ld?.image ? [ld.image] : [])];
  const seen = new Set<string>(); const images: string[] = [];
  for (const u of imgs) { // misma foto con otra firma (og:image vs twitter:image): una sola vez
    const ok = typeof u === 'string' ? safeUrl(u, isAllowedImageHost) : null;
    if (isListing && ok && !seen.has(ok.hostname + ok.pathname + (ok.searchParams.get('media_id') ?? ''))) { seen.add(ok.hostname + ok.pathname + (ok.searchParams.get('media_id') ?? '')); images.push(u as string); }
  }
  images.splice(4);
  return { title, description, price, images, isListing, loginWall };
}
