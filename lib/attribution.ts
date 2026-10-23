// Atribución first-touch (UTMs del landing). Módulo puro: sin react-native, se prueba en Node (scripts/ci/t42).
// El landing enlaza a https://pago.meteorito.app/?utm_source=landing&utm_medium=cta&utm_content=<cta>.
// Se lee la URL al cargar (antes de que el router redirija y borre el query), se guarda UNA vez (no se sobrescribe)
// y analytics.ts la manda como super propiedades, en app_opened y como $set_once initial_utm_* al identificar.
// Privacidad: solo parámetros utm_* y el dominio del referrer (sin ruta ni query). Nada de tokens ni datos personales.

export const ATTR_KEY = 'meteorito:first-touch:v1';
export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
export type UtmKey = (typeof UTM_KEYS)[number];
export type Attribution = Partial<Record<UtmKey, string>> & { referring_domain?: string; landing_path?: string; captured_at?: string };
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

const clean = (v: string | null | undefined, max = 100) => {
  const s = (v ?? '').replace(/[\u0000-\u001f\u007f<>"'`]/g, '').trim().slice(0, max);
  return s || undefined;
};
const OWN = /(^|\.)meteorito\.app$|^localhost$|^127\.0\.0\.1$/;

/** UTMs + dominio del referrer externo. null si no hay nada que atribuir. */
export function parseAttribution(href: string, referrer?: string | null): Attribution | null {
  let u: URL;
  try { u = new URL(href); } catch { return null; }
  const a: Attribution = {};
  for (const k of UTM_KEYS) { const v = clean(u.searchParams.get(k)); if (v) a[k] = v; }
  try {
    if (referrer) { const h = new URL(referrer).hostname.toLowerCase(); if (h && h !== u.hostname.toLowerCase() && !OWN.test(h)) a.referring_domain = clean(h, 253); }
  } catch { /* referrer inválido */ }
  if (!Object.keys(a).length) return null;
  // Ruta de entrada sin slugs ni códigos (mismo criterio que los nombres de pantalla)
  a.landing_path = u.pathname.replace(/^\/(p|t|i|compartir)\/(?!nueva$)[^/]+/, '/$1/:id') || '/';
  return a;
}

/** Guarda la primera atribución (first-touch) y nunca la sobrescribe. Devuelve la guardada (o null) y si es la primera visita atribuida. */
export function captureFirstTouch(store: KV | null, href: string, referrer?: string | null, now = new Date()): { attr: Attribution | null; isNew: boolean } {
  const saved = readFirstTouch(store);
  if (saved) return { attr: saved, isNew: false };
  const a = parseAttribution(href, referrer);
  if (!a) return { attr: null, isNew: false };
  a.captured_at = now.toISOString();
  try { store?.setItem(ATTR_KEY, JSON.stringify(a)); } catch { /* sin storage: vale para esta carga */ }
  return { attr: a, isNew: true };
}

export function readFirstTouch(store: KV | null): Attribution | null {
  try {
    const j = JSON.parse(store?.getItem(ATTR_KEY) ?? 'null');
    if (!j || typeof j !== 'object') return null;
    const out: Attribution = {};
    for (const k of [...UTM_KEYS, 'referring_domain', 'landing_path', 'captured_at'] as const) { const v = clean(j[k], k === 'referring_domain' ? 253 : 100); if (v) (out as any)[k] = v; }
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}

/** Super propiedades (van en cada evento). */
export function superProps(a: Attribution | null): Record<string, string> {
  if (!a) return {};
  const p: Record<string, string> = {};
  for (const k of UTM_KEYS) if (a[k]) p[k] = a[k]!;
  if (a.referring_domain) p.initial_referring_domain = a.referring_domain;
  if (a.landing_path) p.initial_landing_path = a.landing_path;
  return p;
}

/** Propiedades de persona ($set_once) al identificar: initial_utm_*. */
export function personSetOnce(a: Attribution | null): Record<string, string> {
  if (!a) return {};
  const p: Record<string, string> = {};
  for (const k of UTM_KEYS) if (a[k]) p[`initial_${k}`] = a[k]!;
  if (a.referring_domain) p.initial_referring_domain = a.referring_domain;
  if (a.landing_path) p.initial_landing_path = a.landing_path;
  return p;
}

/** Conecta la atribución con un cliente PostHog (posthog-js). Separado para probarlo con un cliente falso. */
export interface PhLike { register(p: Record<string, unknown>): void; identify(id: string, set?: Record<string, unknown>, setOnce?: Record<string, unknown>): void }
export function registerAttribution(ph: PhLike, a: Attribution | null) { const p = superProps(a); if (Object.keys(p).length) ph.register(p); }
export function identifyWithAttribution(ph: PhLike, id: string, a: Attribution | null) {
  const once = personSetOnce(a);
  if (Object.keys(once).length) ph.identify(id, undefined, once); else ph.identify(id);
}
