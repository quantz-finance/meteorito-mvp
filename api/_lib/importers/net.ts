// Red del importador con protección SSRF estricta (cualquier host https público, no solo una lista):
//  - solo https, puerto 443, sin usuario/clave; nombres internos (.local, .internal, localhost, metadata) bloqueados;
//  - se resuelve el DNS y TODAS las IPs deben ser públicas (sin privadas, loopback, link-local 169.254/fe80, CGNAT,
//    ULA fc00::/7, multicast, reservadas, IPv4 mapeada en IPv6 / NAT64 hacia una privada);
//  - la conexión usa la IP YA validada (lookup fijado): un DNS que cambia entre validar y conectar (rebinding) no sirve;
//  - redirecciones manuales (máx. 5), cada salto se valida igual; tiempo total limitado; tamaño máximo DESCOMPRIMIDO;
//  - content-type: html para páginas, jpeg/png/webp para fotos.
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { IncomingMessage } from 'node:http';

export interface RawResponse { status: number; headers: Record<string, string>; body: AsyncIterable<Uint8Array>; destroy: () => void }
export type Resolver = (host: string) => Promise<string[]>;
export type Requester = (url: URL, ip: string, headers: Record<string, string>, signal: AbortSignal) => Promise<RawResponse>;
export interface NetDeps { resolve?: Resolver; request?: Requester }
export interface GetResult { url: string; status: number; contentType: string; body: Buffer }
export type NetError = 'bad_url' | 'blocked_host' | 'private_ip' | 'dns' | 'too_many_redirects' | 'too_large' | 'bad_type' | 'http' | 'timeout' | 'network';
export class ImportNetError extends Error { constructor(public code: NetError, msg?: string) { super(msg ?? code); } }

const v4 = (ip: string) => ip.split('.').reduce((a, p) => a * 256 + Number(p), 0);
const inV4 = (ip: string, cidr: string) => { const [b, bits] = cidr.split('/'); const m = Number(bits); return m === 0 || Math.floor(v4(ip) / 2 ** (32 - m)) === Math.floor(v4(b) / 2 ** (32 - m)); };
const V4_BLOCK = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24',
  '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4'];
/** IPv6 -> 8 grupos de 16 bits (con :: expandido y IPv4 al final). */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0];
  const m4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (m4) { const n = v4(m4[1]); s = s.slice(0, -m4[1].length) + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16); }
  const [a, b] = s.split('::');
  const A = a ? a.split(':') : []; const B = b !== undefined ? (b ? b.split(':') : []) : [];
  const fill = b !== undefined ? 8 - A.length - B.length : 0;
  const g = [...A, ...Array(Math.max(0, fill)).fill('0'), ...B].map((x) => parseInt(x || '0', 16));
  return g.length === 8 && g.every((x) => x >= 0 && x <= 0xffff) ? g : null;
}
/** true solo si la IP es pública (enrutable en internet). */
export function isPublicIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return !V4_BLOCK.some((c) => inV4(ip, c)) && ip !== '255.255.255.255';
  if (fam !== 6) return false;
  const g = v6Groups(ip); if (!g) return false;
  const embedded = () => `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  if (g.every((x) => x === 0)) return false;                                  // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false;        // ::1
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isPublicIp(embedded()); // ::ffff:a.b.c.d / ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPublicIp(embedded());        // NAT64 64:ff9b::/96
  if ((g[0] & 0xfe00) === 0xfc00) return false;                               // ULA fc00::/7 (incluye fd00:ec2::254)
  if ((g[0] & 0xffc0) === 0xfe80) return false;                               // link-local
  if ((g[0] & 0xff00) === 0xff00) return false;                               // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false;                       // documentación
  if (g[0] === 0x2002) return isPublicIp(`${g[1] >> 8}.${g[1] & 255}.${g[2] >> 8}.${g[2] & 255}`); // 6to4
  return true;
}

const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|lan|home|corp|intranet|localdomain)$|^metadata(\.|$)|^instance-data(\.|$)/i;
/** URL que se puede pedir: https, puerto 443, sin credenciales, host con dominio y no interno. */
export function checkUrl(raw: string): URL {
  let u: URL; try { u = new URL(raw); } catch { throw new ImportNetError('bad_url'); }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) throw new ImportNetError('bad_url');
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (isIP(host)) { if (!isPublicIp(host)) throw new ImportNetError('private_ip'); return u; }
  if (!host.includes('.') || BLOCKED_NAMES.test(host)) throw new ImportNetError('blocked_host');
  return u;
}

const defaultResolve: Resolver = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);
/** Conexión https a una IP ya validada (lookup fijado), con SNI y Host del nombre original. */
const defaultRequest: Requester = (url, ip, headers, signal) => new Promise((resolve, reject) => {
  const req = httpsRequest({
    host: url.hostname, servername: isIP(url.hostname) ? undefined : url.hostname, port: 443, method: 'GET', path: url.pathname + url.search, headers, signal,
    lookup: (_h: string, opts: any, cb: any) => (opts?.all ? cb(null, [{ address: ip, family: isIP(ip) }]) : cb(null, ip, isIP(ip))),
  } as any, (res: IncomingMessage) => {
    const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
    const stream: any = enc === 'gzip' ? res.pipe(createGunzip()) : enc === 'br' ? res.pipe(createBrotliDecompress()) : enc === 'deflate' ? res.pipe(createInflate()) : res;
    const h: Record<string, string> = {}; for (const [k, v] of Object.entries(res.headers)) h[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
    resolve({ status: res.statusCode ?? 0, headers: h, body: stream, destroy: () => { res.destroy(); stream.destroy?.(); } });
  });
  req.on('error', reject); req.end();
});

async function readCapped(r: RawResponse, max: number): Promise<Buffer> {
  const chunks: Uint8Array[] = []; let size = 0;
  try { for await (const c of r.body) { size += c.byteLength; if (size > max) throw new ImportNetError('too_large'); chunks.push(c); } }
  finally { r.destroy(); }
  return Buffer.concat(chunks);
}

export interface GetOptions { kind: 'html' | 'image'; ua: string; maxBytes: number; timeoutMs: number; maxHops?: number; lang?: string }
const HTML_TYPES = /^(text\/html|application\/xhtml\+xml)$/;
const IMAGE_TYPES = /^image\/(jpeg|jpg|png|webp)$/; // lo que acepta el bucket 'listings' (Encuentra24: sin f_auto sirve JPEG)

/** GET seguro: valida URL, DNS e IP en cada salto; sigue redirecciones; corta por tiempo y tamaño. Lanza ImportNetError. */
export async function safeGet(raw: string, o: GetOptions, deps: NetDeps = {}): Promise<GetResult> {
  const resolve = deps.resolve ?? defaultResolve, request = deps.request ?? defaultRequest;
  const ac = new AbortController(); let timer: any;
  const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => { ac.abort(); rej(new ImportNetError('timeout')); }, o.timeoutMs); });
  const run = async (): Promise<GetResult> => {
    let cur = raw;
    for (let hop = 0; hop <= (o.maxHops ?? 5); hop++) {
      const u = checkUrl(cur);
      const host = u.hostname.replace(/^\[|\]$/g, '');
      let ips: string[];
      if (isIP(host)) ips = [host];
      else { try { ips = await resolve(host); } catch { throw new ImportNetError('dns'); } }
      if (!ips.length) throw new ImportNetError('dns');
      if (ips.some((ip) => !isPublicIp(ip))) throw new ImportNetError('private_ip'); // una sola IP interna basta para rechazar
      const headers = { 'User-Agent': o.ua, Accept: o.kind === 'html' ? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' : 'image/webp,image/jpeg,image/png;q=0.9',
        'Accept-Language': o.lang ?? 'es-CR,es;q=0.9,en;q=0.5', 'Accept-Encoding': 'gzip, deflate, br' };
      let r: RawResponse;
      try { r = await request(u, ips[0], headers, ac.signal); } catch (e) { if (e instanceof ImportNetError) throw e; throw new ImportNetError(ac.signal.aborted ? 'timeout' : 'network'); }
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.location; r.destroy();
        if (!loc) throw new ImportNetError('http');
        cur = new URL(loc, u).toString(); continue;
      }
      const type = (r.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (r.status < 200 || r.status >= 300) { r.destroy(); throw new ImportNetError('http', String(r.status)); }
      if (!(o.kind === 'html' ? HTML_TYPES : IMAGE_TYPES).test(type)) { r.destroy(); throw new ImportNetError('bad_type'); }
      if (Number(r.headers['content-length'] ?? 0) > o.maxBytes) { r.destroy(); throw new ImportNetError('too_large'); }
      return { url: u.toString(), status: r.status, contentType: type, body: await readCapped(r, o.maxBytes) };
    }
    throw new ImportNetError('too_many_redirects');
  };
  try { return await Promise.race([run(), timeout]); } finally { clearTimeout(timer); }
}
