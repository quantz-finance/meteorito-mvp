// Analítica server-side (PostHog) para eventos de dinero: la fuente confiable para métricas de inversionistas.
// Privacidad: distinct_id = hash del pedido (no de la persona), sin perfiles de persona, sin sub/wallet/email/IMEI.
import { createHash } from 'node:crypto';
import { PostHog } from 'posthog-node';

const KEY = process.env.POSTHOG_KEY ?? process.env.EXPO_PUBLIC_POSTHOG_KEY ?? '';
const HOST = process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com';
let ph: PostHog | null = null;
const client = () => (KEY && process.env.ANALYTICS_DISABLED !== '1' ? (ph ??= new PostHog(KEY, { host: HOST, flushAt: 1, flushInterval: 0 })) : null);

/** Eventos de order_events que se reenvían a PostHog con prefijo "srv_". */
const FORWARD = new Set(['order_created', 'escrow_deployed', 'funded', 'shipped', 'approved', 'released', 'release_refused', 'pin_failed', 'dispute_opened', 'dispute_resolved']);
const ALLOWED = ['amount', 'reason', 'ramp', 'signer', 'category', 'price_crc', 'hours_to_release'];

export const orderKey = (orderId: string) => 'order_' + createHash('sha256').update(`meteorito-order:${orderId}`).digest('hex').slice(0, 24);

export async function trackServer(orderId: string, kind: string, detail: Record<string, unknown> = {}) {
  const c = client();
  if (!c || !FORWARD.has(kind)) return;
  const properties: Record<string, unknown> = { $process_person_profile: false, network: 'testnet', order_key: orderKey(orderId), source: 'server' };
  for (const k of ALLOWED) if (detail[k] !== undefined && typeof detail[k] !== 'object') properties[k] = detail[k];
  if (typeof detail.amount !== 'undefined') properties.amount_usdc = Number(detail.amount);
  try { c.capture({ distinctId: orderKey(orderId), event: `srv_${kind}`, properties }); await c.flush(); }
  catch (e: any) { console.warn('[analytics] falló', kind, e?.message); }
}

/** Código de error exacto de create/activate (sin sub, wallet, email ni mensaje crudo): diagnosticar fallas por dispositivo. */
export function errorCode(e: any): string {
  if (typeof e?.code === 'string' && /^[a-z0-9_]{2,40}$/.test(e.code)) return e.code;
  const st = Number(e?.status);
  return st ? `http_${st}` : 'internal';
}
/** Propiedades de srv_api_error: código, estado y (si es auth_invalid) motivo + host del issuer. Nunca token, sub ni mensaje. */
export function apiErrorProps(e: any): Record<string, string | number> {
  const p: Record<string, string | number> = { code: errorCode(e), status: Number(e?.status) || 500 };
  if (typeof e?.reason === 'string' && /^[a-z_]{2,30}$/.test(e.reason)) p.reason = e.reason;
  if (typeof e?.issHost === 'string' && /^[a-z0-9.-]{3,60}$/.test(e.issHost)) p.iss = e.issHost;
  return p;
}
export async function trackApiError(area: 'create' | 'activate', e: any, extra: Record<string, string | number | boolean> = {}) {
  const { code, status, ...why } = apiErrorProps(e);
  extra = { ...why, ...extra };
  console.error(`[${area}] error`, JSON.stringify({ code, status, ...extra }));
  const c = client();
  if (!c) return;
  try { c.capture({ distinctId: `srv_${area}`, event: 'srv_api_error', properties: { $process_person_profile: false, network: 'testnet', source: 'server', area, code, status, ...extra } }); await c.flush(); }
  catch (x: any) { console.warn('[analytics] falló', area, x?.message); }
}
