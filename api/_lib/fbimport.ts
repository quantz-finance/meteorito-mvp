// Importar de Facebook Marketplace (server): pide el anuncio con dos user agents, sigue redirecciones SOLO dentro de
// facebook.com / fb.me, corta por tiempo y tamaño, y baja la foto del CDN de FB (las URLs firmadas vencen en días).
// La foto vuelve como data URL: el cliente la comprime y la sube por la vía normal (/api/photos/upload-url) al generar el
// link, igual que una foto elegida del teléfono. Así no quedan archivos huérfanos si el vendedor no publica.
import { FB_IMPORT_FAILED, checkFacebookUrl, isAllowedImageHost, isAllowedPageHost, parseListingHtml, safeUrl, toCrc, type FbPrice, type ParsedListing } from './fbparse';

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; redirect?: 'manual'; signal?: AbortSignal }) => Promise<Response>;
export interface FbImportResult {
  result: 'success' | 'partial' | 'failed';
  title: string | null; price_crc: number | null; price_source: FbPrice | null; converted: boolean;
  description: string | null; photos: string[]; missing: ('title' | 'price' | 'photos')[]; message?: string;
}

const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const UA_CRAWLER = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const MAX_HTML = 512 * 1024;      // las etiquetas OG están en los primeros ~2 KB; nunca leer más de 512 KB
const MAX_IMAGE = 4 * 1024 * 1024; // la foto de FB pesa ~70 KB (600 px); 4 MB es el techo
const MAX_HOPS = 5;
const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'image/jpeg', 'image/jpg': 'image/jpeg', 'image/png': 'image/png', 'image/webp': 'image/webp' };

/** Lee hasta `max` bytes (o hasta </head> si stopAtHead). Devuelve null si se pasa del máximo y no hay corte. */
async function readCapped(r: Response, max: number, stopAtHead: boolean): Promise<Uint8Array | null> {
  const reader = r.body?.getReader();
  if (!reader) return new Uint8Array(await r.arrayBuffer()).slice(0, max);
  const chunks: Uint8Array[] = []; let size = 0; const dec = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); size += value.byteLength;
      if (stopAtHead && dec.decode(value, { stream: true }).toLowerCase().includes('</head>')) break;
      if (size > max) { if (stopAtHead) break; return null; }
    }
  } finally { reader.cancel().catch(() => {}); }
  const out = new Uint8Array(Math.min(size, max)); let o = 0;
  for (const c of chunks) { if (o >= out.length) break; const n = Math.min(c.byteLength, out.length - o); out.set(c.subarray(0, n), o); o += n; }
  return out;
}

/** GET con redirecciones manuales: cada salto debe seguir en un host permitido (SSRF). */
async function getFollow(url: string, ua: string, allow: (h: string) => boolean, f: FetchLike, signal: AbortSignal): Promise<{ res: Response; url: string } | null> {
  let cur = url;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (!safeUrl(cur, allow)) return null;
    const res = await f(cur, { headers: { 'User-Agent': ua, 'Accept-Language': 'es-CR,es;q=0.9,en;q=0.5', Accept: 'text/html,image/*;q=0.9,*/*;q=0.5' }, redirect: 'manual', signal });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location'); res.body?.cancel().catch(() => {});
      if (!loc) return null;
      cur = new URL(loc, cur).toString(); continue;
    }
    return { res, url: cur };
  }
  return null;
}

async function fetchListing(url: string, ua: string, f: FetchLike, signal: AbortSignal): Promise<ParsedListing | null> {
  try {
    const r = await getFollow(url, ua, isAllowedPageHost, f, signal);
    if (!r || !r.res.ok) return null;
    const bytes = await readCapped(r.res, MAX_HTML, true);
    if (!bytes) return null;
    const html = new TextDecoder().decode(bytes);
    if (/\/(login|checkpoint)\b/i.test(new URL(r.url).pathname)) return { ...parseListingHtml(''), loginWall: true };
    return parseListingHtml(html);
  } catch { return null; }
}

const isImageBytes = (b: Uint8Array) => (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45);
async function fetchImage(url: string, f: FetchLike, signal: AbortSignal): Promise<string | null> {
  try {
    const r = await getFollow(url, UA_MOBILE, isAllowedImageHost, f, signal);
    if (!r || !r.res.ok) return null;
    const type = IMAGE_TYPES[(r.res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()];
    if (!type) { r.res.body?.cancel().catch(() => {}); return null; }
    const len = Number(r.res.headers.get('content-length') ?? 0);
    if (len > MAX_IMAGE) { r.res.body?.cancel().catch(() => {}); return null; }
    const b = await readCapped(r.res, MAX_IMAGE, false);
    if (!b || !b.byteLength || !isImageBytes(b)) return null;
    return `data:${type};base64,${Buffer.from(b).toString('base64')}`;
  } catch { return null; }
}

const withTimeout = async <T>(ms: number, fn: (s: AbortSignal) => Promise<T>, fallback: T): Promise<T> => {
  const ac = new AbortController(); let timer: any;
  const timeout = new Promise<T>((res) => { timer = setTimeout(() => { ac.abort(); res(fallback); }, ms); });
  try { return await Promise.race([fn(ac.signal).catch(() => fallback), timeout]); } finally { clearTimeout(timer); }
};

let testFetch: FetchLike | null = null;
/** Solo tests: fetch simulado para el endpoint (nunca se llama en runtime). */
export const __setFbFetchForTests = (f: FetchLike | null) => { testFetch = f; };

// Límite por identidad (vendedor o llave de invitado) y por IP de invitados (por instancia): no convertir nuestra IP en un scraper ni quemarla con FB. 8 por minuto.
const hits = new Map<string, number[]>();
export function fbRateLimited(sub: string, now = Date.now(), max = 8): boolean {
  const recent = (hits.get(sub) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= max) { hits.set(sub, recent); return true; }
  recent.push(now); hits.set(sub, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

/** Invitados (sin cuenta): máximo de importaciones por minuto desde una misma IP, sumando todas sus llaves. */
export const FB_GUEST_IP_PER_MIN = 12;
/** IP del cliente según el proxy de Vercel (x-vercel-forwarded-for / x-forwarded-for los pone Vercel, no el cliente). */
export function clientIp(req: any): string | null {
  const h = req?.headers ?? {};
  const raw = h['x-vercel-forwarded-for'] ?? h['x-forwarded-for'] ?? h['x-real-ip'];
  const v = String(Array.isArray(raw) ? raw[0] : raw ?? '').split(',')[0].trim();
  return v && v.length <= 64 ? v : null;
}

/** Link de FB pegado por el vendedor -> datos para precargar el formulario. Nunca lanza: si no se puede, result 'failed'. */
export async function importFacebookListing(input: string, deps: { fetch?: FetchLike; rate: number; timeoutMs?: number }): Promise<FbImportResult> {
  const f = deps.fetch ?? testFetch ?? ((u, i) => fetch(u, i as any));
  const ms = deps.timeoutMs ?? 6000;
  const failed: FbImportResult = { result: 'failed', title: null, price_crc: null, price_source: null, converted: false, description: null, photos: [], missing: ['title', 'price', 'photos'], message: FB_IMPORT_FAILED };
  const chk = checkFacebookUrl(input);
  if (!chk.ok) return failed;
  // Navegador móvil: título, foto y resumen con precio. Crawler de FB: la descripción del vendedor. En paralelo.
  const [mob, bot] = await withTimeout(ms, (s) => Promise.all([fetchListing(chk.url, UA_MOBILE, f, s), fetchListing(chk.url, UA_CRAWLER, f, s)]), [null, null] as (ParsedListing | null)[]);
  const a = mob?.isListing ? mob : null; const b = bot?.isListing ? bot : null;
  const title = a?.title ?? b?.title ?? null;
  const price = a?.price ?? b?.price ?? null;
  const description = b?.description ?? a?.description ?? null;
  const images = [...new Set([...(a?.images ?? []), ...(b?.images ?? [])])];
  if (!title && !price && !images.length) return failed;
  const photos: string[] = [];
  for (const u of images) { // la primera que baje (FB expone una sola); máx. 1 intento extra
    if (photos.length || images.indexOf(u) > 1) break;
    const d = await withTimeout(ms, (s) => fetchImage(u, f, s), null);
    if (d) photos.push(d);
  }
  const price_crc = toCrc(price, deps.rate);
  const missing: FbImportResult['missing'] = [];
  if (!title) missing.push('title'); if (!price_crc) missing.push('price'); if (!photos.length) missing.push('photos');
  return { result: missing.length ? 'partial' : 'success', title, price_crc, price_source: price, converted: !!price && price.currency !== 'CRC' && !!price_crc, description, photos, missing };
}
