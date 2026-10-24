// Acuerdo de entrega (pura, sin dependencias: la usan la app, el demo y la API).
//  - delivery_mode: 'envio' (default) o 'cara_a_cara'.
//  - protection_minutes: plazo de protección del comprador, de 24 h a 30 días. Default 7 días (envío) o 24 h (cara a cara).
//    Envío: cuenta desde "Ya lo envié". Cara a cara: cuenta desde el pago.
//  - Extensión de mutuo acuerdo: +1, +3 o +7 días; el total desde el pago nunca pasa de 30 días.
export type DeliveryMode = 'envio' | 'cara_a_cara';
export const DELIVERY_MODES: DeliveryMode[] = ['envio', 'cara_a_cara'];
export const MIN_PROTECTION_MIN = 1440;
export const MAX_PROTECTION_MIN = 30 * 1440;
export const MAX_TOTAL_FROM_PAYMENT_MIN = 30 * 1440;
export const DEFAULT_PROTECTION_MIN: Record<DeliveryMode, number> = { envio: 7 * 1440, cara_a_cara: 1440 };
export const PROTECTION_CHIPS = [1440, 3 * 1440, 7 * 1440];
export const EXTENSION_DAYS = [1, 3, 7] as const;
/** Una solicitud pendiente congela el auto-release solo durante 24 h (si la otra parte no responde, deja de congelar). */
export const EXTENSION_PENDING_MS = 24 * 3600_000;
export const DELIVERY_LABEL: Record<DeliveryMode, string> = { envio: 'Envío', cara_a_cara: 'Cara a cara' };

export const deliveryModeOf = (o: { delivery_mode?: string | null } | null | undefined): DeliveryMode => (o?.delivery_mode === 'cara_a_cara' ? 'cara_a_cara' : 'envio');
export const isFaceToFace = (o: { delivery_mode?: string | null } | null | undefined) => deliveryModeOf(o) === 'cara_a_cara';
/** Plazo vigente de un pedido; sin la migración 017 (columna ausente) o valor raro -> el default del tipo de entrega. */
export function protectionOf(o: { delivery_mode?: string | null; protection_minutes?: number | null } | null | undefined): number {
  const m = Number(o?.protection_minutes);
  return Number.isInteger(m) && m >= MIN_PROTECTION_MIN && m <= MAX_PROTECTION_MIN ? m : DEFAULT_PROTECTION_MIN[deliveryModeOf(o)];
}

export const PROTECTION_RANGE_ERROR = 'El plazo de protección debe ser de 24 h a 30 días.';
export function validateAgreement(b: { delivery_mode?: unknown; protection_minutes?: unknown }): { delivery_mode: DeliveryMode; protection_minutes: number } | { error: string } {
  const mode = b.delivery_mode == null || b.delivery_mode === '' ? 'envio' : b.delivery_mode;
  if (!DELIVERY_MODES.includes(mode as DeliveryMode)) return { error: 'Elige cara a cara o envío.' };
  if (b.protection_minutes == null || b.protection_minutes === '') return { delivery_mode: mode as DeliveryMode, protection_minutes: DEFAULT_PROTECTION_MIN[mode as DeliveryMode] };
  const m = typeof b.protection_minutes === 'number' ? b.protection_minutes : NaN;
  if (!Number.isInteger(m) || m < MIN_PROTECTION_MIN || m > MAX_PROTECTION_MIN) return { error: PROTECTION_RANGE_ERROR };
  return { delivery_mode: mode as DeliveryMode, protection_minutes: m };
}
/** Días escritos por el vendedor -> minutos (o null si no es un entero de 1 a 30). */
export function daysToMinutes(v: string): number | null {
  const s = v.trim(); if (!/^\d{1,2}$/.test(s)) return null;
  const d = Number(s); return d >= 1 && d <= 30 ? d * 1440 : null;
}

export function protectionLabel(min: number): string {
  if (min < 1440 || min % 1440) return `${Math.round(min / 60)} h`;
  const d = min / 1440; return d === 1 ? '24 h' : `${d} días`;
}
export const daysLabel = (n: number) => (n === 1 ? '1 día' : `${n} días`);
/** "Entrega: Cara a cara · Protección: 24 h" / "Entrega: Envío · Protección: 7 días desde el envío". */
export function agreementSummary(mode: DeliveryMode | string | null | undefined, minutes?: number | null): string {
  const m = deliveryModeOf({ delivery_mode: mode as string });
  const p = protectionLabel(protectionOf({ delivery_mode: m, protection_minutes: minutes }));
  return m === 'cara_a_cara' ? `Entrega: Cara a cara · Protección: ${p}` : `Entrega: Envío · Protección: ${p} desde el envío`;
}

export interface PendingExtension { by: 'buyer' | 'seller'; days: number; at: string }
export function pendingExtension(o: { release_ext?: any } | null | undefined, now = Date.now()): PendingExtension | null {
  const p = o?.release_ext;
  if (!p || (p.by !== 'buyer' && p.by !== 'seller') || !EXTENSION_DAYS.includes(p.days)) return null;
  const at = Date.parse(p.at); if (!(at > 0) || now - at >= EXTENSION_PENDING_MS) return null;
  return p as PendingExtension;
}
/** Minutos ya extendidos (aceptados). */
export const extendedOf = (o: { release_ext_minutes?: number | null } | null | undefined) => Math.max(0, Number(o?.release_ext_minutes) || 0);
/** Días que todavía caben (para mostrar solo los chips posibles). baseMs = inicio del plazo (pago o envío). */
export function extensionFits(o: { funded_at?: string | null } & Record<string, any>, dueMs: number, days: number): boolean {
  const paid = Date.parse(o.funded_at ?? ''); if (!(paid > 0)) return false;
  return dueMs + days * 86_400_000 <= paid + MAX_TOTAL_FROM_PAYMENT_MIN * 60_000;
}
export const extensionRequestText = (by: 'buyer' | 'seller', days: number) => `${by === 'buyer' ? 'El comprador' : 'El vendedor'} pidió ${daysLabel(days)} más`;
