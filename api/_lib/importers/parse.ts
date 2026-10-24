// Parsers del importador (PUROS: HTML -> datos). Orden: datos propios del proveedor (si los hay), JSON-LD Product,
// Open Graph (og:* y product:price:*) y microdata (itemprop). Lo que falte lo completa el vendedor.
import { decodeEntities } from '../fbparse';
import type { ProviderId } from './providers';

export interface Price { amount: number; currency: string }
export interface Parsed { title: string | null; description: string | null; price: Price | null; images: string[] }
export const TITLE_MAX = 80;
export const DESC_MAX = 500;      // descripción recortada: el vendedor la revisa
export const MAX_IMPORT_PHOTOS = 4;

const clean = (s: unknown) => (typeof s === 'string' ? decodeEntities(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '');
export function cutTitle(t: string): string | null {
  const s = clean(t); if (!s) return null;
  if (s.length <= TITLE_MAX) return s;
  const cut = s.slice(0, TITLE_MAX); const sp = cut.lastIndexOf(' ');
  return (sp > 40 ? cut.slice(0, sp) : cut).trim();
}
export function cutDescription(d: string | null | undefined): string | null {
  const s = typeof d === 'string' ? decodeEntities(d).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : '';
  if (!s) return null;
  return s.length <= DESC_MAX ? s : s.slice(0, DESC_MAX - 1).replace(/\s+\S*$/, '') + '…';
}
const num = (v: unknown) => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
const cur = (v: unknown) => { const c = String(v ?? '').trim().toUpperCase(); return /^[A-Z]{3}$/.test(c) ? c : null; };

function metas(html: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const val = tag.match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1] ?? tag.match(/\bcontent\s*=\s*'([^']*)'/i)?.[1];
    if (key && val != null) out.set(key, [...(out.get(key) ?? []), decodeEntities(val)]);
  }
  return out;
}
const first = (m: Map<string, string[]>, ...keys: string[]) => { for (const k of keys) { const v = m.get(k)?.[0]; if (v) return v; } return null; };

/** Todos los objetos JSON-LD (incluye @graph y listas). */
export function jsonLd(html: string): any[] {
  const out: any[] = [];
  const walk = (j: any) => { if (!j || typeof j !== 'object') return; if (Array.isArray(j)) return j.forEach(walk); out.push(j); if (j['@graph']) walk(j['@graph']); };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) { try { walk(JSON.parse(m[1].trim())); } catch { /* roto: se ignora */ } }
  return out;
}
const isType = (j: any, t: RegExp) => [].concat(j?.['@type'] ?? []).some((x: any) => t.test(String(x)));
const ldImages = (v: any): string[] => [].concat(v ?? []).flatMap((x: any) => (typeof x === 'string' ? [x] : x?.url ? [x.url] : x?.contentUrl ? [x.contentUrl] : []));
function ldOffer(o: any): Price | null {
  for (const x of [].concat(o ?? [])) {
    const amount = num((x as any)?.price ?? (x as any)?.lowPrice ?? (x as any)?.priceSpecification?.price);
    const c = cur((x as any)?.priceCurrency ?? (x as any)?.priceSpecification?.priceCurrency);
    if (amount && c) return { amount, currency: c };
    const nested = ldOffer((x as any)?.offers); if (nested) return nested;
  }
  return null;
}

/** Imágenes: absolutas https, sin duplicados, máx. 8 candidatas (se bajan hasta MAX_IMPORT_PHOTOS). */
export function absImages(list: (string | null | undefined)[], base: string): string[] {
  const out: string[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'string') continue;
    let u: URL; try { u = new URL(decodeEntities(raw.trim()).replace(/^\/\//, 'https://'), base); } catch { continue; }
    if (u.protocol === 'http:') u.protocol = 'https:';
    if (u.protocol !== 'https:') continue;
    const s = u.toString(); if (!out.includes(s)) out.push(s);
    if (out.length >= 8) break;
  }
  return out;
}

/** Genérico: JSON-LD Product -> Open Graph -> microdata. */
export function parseGeneric(html: string, pageUrl: string): Parsed {
  const ld = jsonLd(html);
  const prod = ld.find((j) => isType(j, /^Product$/i)) ?? ld.find((j) => isType(j, /ProductGroup|Offer|Vehicle|IndividualProduct/i)) ?? null;
  const variant = prod?.hasVariant ? [].concat(prod.hasVariant)[0] as any : null;
  const m = metas(html);
  const title = cutTitle(prod?.name ?? first(m, 'og:title', 'twitter:title', 'name') ?? (html.match(/<title[^>]*>([^<]{3,200})<\/title>/i)?.[1] ?? ''));
  let price = ldOffer(prod?.offers) ?? ldOffer(variant?.offers);
  if (!price) {
    const amount = num(first(m, 'product:price:amount', 'og:price:amount', 'price', 'twitter:data1'));
    const c = cur(first(m, 'product:price:currency', 'og:price:currency', 'pricecurrency'));
    if (amount && c) price = { amount, currency: c };
  }
  if (!price) { // microdata en el cuerpo: <span itemprop="price" content="123"> + itemprop="priceCurrency"
    const a = num(html.match(/itemprop=["']price["'][^>]*content=["']([^"']+)/i)?.[1] ?? html.match(/content=["']([^"']+)["'][^>]*itemprop=["']price["']/i)?.[1]);
    const c = cur(html.match(/itemprop=["']priceCurrency["'][^>]*content=["']([^"']+)/i)?.[1] ?? html.match(/content=["']([A-Z]{3})["'][^>]*itemprop=["']priceCurrency["']/i)?.[1]);
    if (a && c) price = { amount: a, currency: c };
  }
  const description = cutDescription(prod?.description ?? first(m, 'og:description', 'description', 'twitter:description'));
  const images = absImages([...ldImages(prod?.image), ...ldImages(variant?.image), ...(m.get('og:image') ?? []), ...(m.get('og:image:secure_url') ?? []), ...(m.get('twitter:image') ?? []), ...(m.get('image') ?? [])], pageUrl);
  return { title, description, price, images };
}

/** Encuentra24 (Next.js): og:title "Título | Lugar" y og:image; precio, descripción y fotos en el payload del stream. */
export function parseEncuentra24(html: string, pageUrl: string): Parsed {
  const g = parseGeneric(html, pageUrl);
  // Payload RSC: JSON escapado una o dos veces (\\" , \\\\n, \\\\r, \\u003c): se desescapa para leerlo como texto.
  const s = html.replace(/\\+"/g, '"').replace(/\\+r/g, '').replace(/\\+n/g, '\n').replace(/\\+u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const amount = num(s.match(/"price_value":(\d+(?:\.\d+)?)/)?.[1]);
  const sym = s.match(/"price":\{"currency":\{[^}]*"symbol":"([A-Z]{3})"/)?.[1] ?? (s.match(/"price_symbol":"([^"]+)"/)?.[1] === '₡' ? 'CRC' : null);
  const descMeta = s.match(/"name":"description","content":"([^"]{3,4000})"/)?.[1] ?? s.match(/"property":"og:description","content":"([^"]{3,4000})"/)?.[1];
  const adId = pageUrl.match(/\/(\d{6,})(?:[/?#]|$)/)?.[1];
  const photos = adId ? [...new Set([...s.matchAll(/https:\/\/photos\.encuentra24\.com\/t_or_fh_[a-z]\/f_auto\/v1\/[a-z]{2}\/[\d/]+\/(\d+)_[0-9a-f]+(?:-[0-9a-f]+)?/g)].filter((x) => x[1] === adId).map((x) => x[0].replace(/t_or_fh_[a-z]\/f_auto\//, 't_or_fh_l/')))] : [];
  return {
    title: g.title ? cutTitle(g.title.replace(/\s+\|\s+[^|]+$/, '')) : null,
    description: cutDescription(descMeta) ?? g.description,
    price: amount && sym ? { amount, currency: sym } : g.price,
    images: photos.length ? absImages(photos, pageUrl) : absImages(g.images.filter((u) => !/opengraph-image/.test(u)), pageUrl),
  };
}

const AMAZON_CURRENCY: Record<string, string> = { 'amazon.com.mx': 'MXN', 'amazon.com.br': 'BRL', 'amazon.es': 'EUR', 'amazon.com': 'USD' };
/** Amazon: título (#productTitle / meta title), priceAmount del JSON de la página, fotos hiRes. Moneda por dominio. */
export function parseAmazon(html: string, pageUrl: string): Parsed {
  const g = parseGeneric(html, pageUrl);
  const host = new URL(pageUrl).hostname.replace(/^www\./, '');
  const t = html.match(/id="productTitle"[^>]*>([\s\S]{3,400}?)<\/span>/i)?.[1] ?? html.match(/<meta name="title" content="([^"]+)"/i)?.[1] ?? null;
  const amount = num(html.match(/"priceAmount":(\d+(?:\.\d+)?)/)?.[1]);
  const currency = cur(html.match(/"currencyCode":"([A-Z]{3})"/)?.[1]) ?? AMAZON_CURRENCY[host] ?? null;
  const hi = [...html.matchAll(/"hiRes":"(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/g)].map((x) => x[1]);
  const old = html.match(/data-old-hires="(https:[^"]+)"/)?.[1];
  const mobile = [...html.matchAll(/data-a-hires="(https:\/\/m\.media-amazon\.com\/images\/I\/[^"]+)"/g)].map((x) => x[1]); // página móvil
  const about = [...(html.match(/id="feature-bullets"[\s\S]*?<\/ul>/i)?.[0] ?? '').matchAll(/<span class="a-list-item">([\s\S]*?)<\/span>/g)].map((x) => clean(x[1])).filter(Boolean).join('\n');
  return {
    title: t ? cutTitle(t.replace(/\s*:\s*Amazon\.[a-z.]+.*$/i, '')) : g.title ? cutTitle(g.title.replace(/\s*:\s*Amazon\.[a-z.]+.*$/i, '')) : null,
    description: cutDescription(about) ?? g.description,
    price: amount && currency ? { amount, currency } : g.price,
    images: absImages([...hi, old, ...mobile, ...g.images], pageUrl),
  };
}

export function parseFor(provider: ProviderId, html: string, pageUrl: string): Parsed {
  if (provider === 'encuentra24') return parseEncuentra24(html, pageUrl);
  if (provider === 'amazon') return parseAmazon(html, pageUrl);
  const g = parseGeneric(html, pageUrl);
  // Mercado Libre / AliExpress / Walmart: títulos con sufijo de la tienda.
  if (g.title) g.title = cutTitle(g.title.replace(/\s+[|\-–]\s+(Mercado ?Libre|MercadoLivre|AliExpress|Walmart)[^|]*$/i, '').replace(/\s*-\s*AliExpress\s*\d*$/i, ''));
  if (provider === 'aliexpress' && g.description && /^Smarter Shopping/i.test(g.description)) g.description = null;
  return g;
}

// Tipo de cambio APROXIMADO a dólares (solo para SUGERIR el precio en colones; el vendedor confirma el final).
// USD/CRC sale de env (el mismo que usa el app). Monedas volátiles (ARS, VES) no se convierten: el vendedor escribe el precio.
export const USD_PER: Record<string, number> = { USD: 1, PAB: 1, EUR: 1.08, MXN: 0.054, BRL: 0.18, COP: 0.00025, CLP: 0.00105, PEN: 0.27, UYU: 0.024, GTQ: 0.13, HNL: 0.04, NIO: 0.027, DOP: 0.0165, BOB: 0.145, PYG: 0.00013 };
/** Precio -> colones (sugerencia). CRC tal cual; otras monedas al tipo aproximado, redondeado a ₡100. Sin tipo -> null. */
export function suggestCrc(p: Price | null, crcPerUsd: number): number | null {
  if (!p) return null;
  if (p.currency === 'CRC') return Math.round(p.amount);
  const usd = USD_PER[p.currency];
  if (!usd || !(crcPerUsd > 0)) return null;
  const crc = Math.round((p.amount * usd * crcPerUsd) / 100) * 100;
  return crc >= 100 ? crc : null;
}
