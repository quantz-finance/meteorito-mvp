// Hashes CSP de los <script> inline. Lo usan preload.mjs (falla el build si falta uno) y el test t106.
import { createHash } from 'node:crypto';

/** sha256 en base64 de cada <script> inline ejecutable (sin src; JSON/ld+json no cuentan). */
export function inlineScriptHashes(html) {
  const out = new Set();
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1];
    if (/\bsrc\s*=/.test(attrs)) continue;
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? '').toLowerCase();
    if (type && !['module', 'text/javascript', 'application/javascript'].includes(type)) continue; // datos, no código
    out.add('sha256-' + createHash('sha256').update(m[2], 'utf8').digest('base64'));
  }
  return out;
}
/** Políticas CSP de vercel.json (enforce y report-only) para la ruta global. */
export function cspPolicies(vercel) {
  const out = [];
  for (const h of vercel.headers ?? []) for (const x of h.headers ?? []) if (/^content-security-policy(-report-only)?$/i.test(x.key)) out.push({ source: h.source, key: x.key, value: x.value });
  return out;
}
/** Hashes permitidos en script-src (de todas las políticas: tienen que coincidir). */
export function cspScriptHashes(vercel) {
  const sets = cspPolicies(vercel).map((p) => new Set([...(p.value.match(/script-src[^;]*/)?.[0] ?? '').matchAll(/'(sha256-[A-Za-z0-9+/=]+)'/g)].map((m) => m[1])));
  if (!sets.length) return new Set();
  return new Set([...sets[0]].filter((h) => sets.every((s) => s.has(h))));
}
/** Encabezados globales de seguridad de vercel.json (source "/(.*)"): los servidores locales (demo, e2e) los aplican
 *  igual que Vercel, así el e2e corre con la misma CSP que producción. */
export function securityHeaders(vercel) {
  const g = (vercel.headers ?? []).find((h) => h.source === '/(.*)');
  return Object.fromEntries((g?.headers ?? []).map((h) => [h.key, h.value]));
}
