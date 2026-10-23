// Analítica de producto (PostHog). Un solo helper: track(). Ver docs/tracking-plan.md.
// Privacidad (Ley 8968): sin email/teléfono/IMEI/wallet/montos por persona. distinct_id = SHA-256(salt + sub de Cavos).
// Sin autocapture de inputs, sin grabación de sesión, con opt-out persistente.
import { Platform } from 'react-native';
import { DEMO_ENABLED } from './demo';
import { captureFirstTouch, identifyWithAttribution, registerAttribution, superProps, type Attribution } from './attribution';

export const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '';
export const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';
/** Salt público de seudonimización (no es secreto: evita que el sub crudo salga del dispositivo). */
export const ANALYTICS_SALT = 'meteorito-analytics-v1';
const OPT_KEY = 'meteorito:analytics-optout';

type Props = Record<string, string | number | boolean | null | undefined>;
const web = Platform.OS === 'web' && typeof window !== 'undefined';
let ph: any = null;
let distinctId: string | null = null;
let anonId = 'anon_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
let optedOut = false;
let started = false;
const queue: [string, Props][] = [];
let attr: Attribution | null = null; // first-touch del landing (lib/attribution.ts)
let attrNew = false;

function readOpt(): boolean { try { return web && window.localStorage.getItem(OPT_KEY) === '1'; } catch { return false; } }
export function isOptedOut() { return optedOut; }
export function setOptOut(v: boolean) {
  optedOut = v;
  try { if (web) v ? window.localStorage.setItem(OPT_KEY, '1') : window.localStorage.removeItem(OPT_KEY); } catch {}
  if (ph) v ? ph.opt_out_capturing() : ph.opt_in_capturing();
}

async function sha256(s: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const b = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  const { hash } = await import('@stellar/stellar-sdk'); // nativo: sha256 ya incluido en el bundle
  return hash(Buffer.from(s)).toString('hex');
}
export const hashSub = async (sub: string) => 'u_' + (await sha256(`${ANALYTICS_SALT}:${sub}`)).slice(0, 32);

/** sub del JWT de Cavos (solo se lee para hashearlo; nunca se envía). */
export function subFromJwt(token: string | null): string | null {
  try { const p = token!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(atob(p)).sub ?? null; } catch { return null; }
}

const base = (): Props => ({ platform: Platform.OS, network: 'testnet', app: 'meteorito-mvp' });

export function initAnalytics() {
  if (started) return; started = true;
  optedOut = readOpt();
  if (DEMO_ENABLED) return; // demo: sin analítica
  if (!POSTHOG_KEY || !web) return; // nativo: envío HTTP directo (send())
  // UTMs del landing: se leen YA (al cargar el módulo, antes de que el router redirija y borre el query).
  // Con opt-out no se guarda nada.
  if (!optedOut) {
    let store: Storage | null = null; try { store = window.localStorage; } catch { /* modo privado estricto */ }
    ({ attr, isNew: attrNew } = captureFirstTouch(store, window.location.href, document.referrer));
  }
  import('posthog-js').then(({ default: posthog }) => {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST, person_profiles: 'identified_only',
      autocapture: false, capture_pageview: false, capture_pageleave: true,
      disable_session_recording: true, disable_surveys: true, mask_all_text: true, mask_all_element_attributes: true,
      persistence: 'localStorage', ip: false, property_denylist: ['$ip'], opt_out_capturing_by_default: optedOut,
      sanitize_properties: (p: any) => { delete p.$ip; if (typeof p.$current_url === 'string') p.$current_url = scrub(p.$current_url); return p; },
    } as any);
    ph = posthog;
    registerAttribution(posthog, attr); // super propiedades: van en cada evento
    if (distinctId) identifyWithAttribution(posthog, distinctId, attr);
    for (const [e, p] of queue.splice(0)) posthog.capture(e, p);
  }).catch(() => {});
  track('app_opened', { ...superProps(attr), first_touch: attrNew }); // primer evento de la carga (va a la cola hasta que cargue posthog)
}
// Quita query strings (tokens de login, etc.) de las URLs.
const scrub = (u: string) => u.split('?')[0].split('#')[0];

async function send(event: string, properties: Props) {
  if (!POSTHOG_KEY) return;
  try {
    await fetch(`${POSTHOG_HOST}/i/v0/e/`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: POSTHOG_KEY, event, distinct_id: distinctId ?? anonId, properties: { ...properties, $process_person_profile: !!distinctId } }) });
  } catch {}
}

export function track(event: string, props: Props = {}) {
  if (DEMO_ENABLED || optedOut || !POSTHOG_KEY) return;
  const p = { ...base(), ...props };
  if (!web) { send(event, p); return; }
  if (ph) ph.capture(event, p); else queue.push([event, p]);
}
export const screen = (name: string) => track('screen_viewed', { screen: name });

export async function identify(token: string | null) {
  const sub = subFromJwt(token);
  if (!sub) return;
  const id = await hashSub(sub);
  if (id === distinctId) return;
  distinctId = id;
  if (ph && !optedOut) identifyWithAttribution(ph, id, attr); // $set_once initial_utm_*
}
export function resetAnalytics() { distinctId = null; if (ph) { ph.reset(); registerAttribution(ph, attr); } } // reset borra las super propiedades
/** Error genérico sin mensaje crudo (puede tener datos): solo código/área. */
export const trackError = (area: string, e: unknown) =>
  track('error_shown', { area, code: String((e as any)?.message ?? e).slice(0, 60).replace(/[0-9A-Z]{20,}/g, '…') });
/** Montos en rangos (nunca exactos en eventos ligados a persona). */
export function priceBucket(crc: number): string {
  const b = [25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];
  for (const x of b) if (crc < x) return `<${x / 1000}k`;
  return '>=1M';
}
