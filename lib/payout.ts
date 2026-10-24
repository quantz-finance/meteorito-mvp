// Cuenta IBAN para cobrar (registro; todavía no hay pagos reales al IBAN). API: /api/store (migración 011).
import { api } from './api';
import type { MeteoritoAuth } from './types';
import type { PayoutView } from '../api/_lib/payout';
export type { PayoutView } from '../api/_lib/payout';
export { crIbanError, formatIban, maskIban, maskPhone, normalizeIban, normalizeSinpe } from '../api/_lib/payout';

export const PAYOUT_UNAVAILABLE = 'Todavía no puedes registrar tu cuenta. Intenta más tarde.';
const friendly = (e: any): never => {
  if (e?.code === 'payout_unavailable' || e?.status === 503) throw Object.assign(new Error(PAYOUT_UNAVAILABLE), { code: 'payout_unavailable' });
  throw e;
};
export async function getPayout(auth: MeteoritoAuth): Promise<PayoutView | null> {
  try { return (await api<{ payout: PayoutView | null }>(auth, '/api/store', { action: 'payout_get' })).payout; } catch (e) { return friendly(e); }
}
export async function savePayout(auth: MeteoritoAuth, v: { iban: string; holder_name: string; sinpe_phone?: string }): Promise<PayoutView> {
  try { return (await api<{ payout: PayoutView }>(auth, '/api/store', { action: 'payout_set', ...v })).payout; } catch (e) { return friendly(e); }
}

/** Pasos del perfil (la verificación con cédula todavía no está activa y no cuenta para el %). */
export interface ProfileStep { key: string; label: string; done: boolean; soon?: boolean }
export function profileSteps(p: { name?: string | null; storeSlug?: string | null; payout?: boolean; products?: number }): ProfileStep[] {
  return [
    { key: 'name', label: 'Tu nombre', done: !!p.name?.trim() },
    { key: 'store', label: 'Usuario de tienda', done: !!p.storeSlug },
    { key: 'iban', label: 'Cuenta IBAN para cobrar', done: !!p.payout },
    { key: 'product', label: 'Tu primer producto', done: (p.products ?? 0) > 0 },
    { key: 'id', label: 'Verifica tu perfil', done: false, soon: true },
  ];
}
export const profilePct = (steps: ProfileStep[]) => {
  const active = steps.filter((s) => !s.soon);
  return Math.round((active.filter((s) => s.done).length / active.length) * 100);
};
