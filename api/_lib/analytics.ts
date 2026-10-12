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
