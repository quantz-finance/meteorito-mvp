// Dónde cobrar: Cuenta IBAN (pago manual del equipo) o USDC a su wallet Stellar (029). API: /api/store (migraciones 011 y 029).
import { COPY } from './copy';
import { api } from './api';
import type { MeteoritoAuth } from './types';
import type { PayoutView } from '../api/_lib/payout';
export type { PayoutView } from '../api/_lib/payout';
export { crIbanError, formatIban, maskIban, maskPhone, normalizeIban, normalizeSinpe, shortStellar } from '../api/_lib/payout';

export const PAYOUT_UNAVAILABLE = 'Todavía no puedes registrar tu cuenta. Intenta más tarde.';
const friendly = (e: any): never => {
  if (e?.code === 'payout_unavailable' || e?.status === 503) throw Object.assign(new Error(PAYOUT_UNAVAILABLE), { code: 'payout_unavailable' });
  throw e;
};
export async function getPayout(auth: MeteoritoAuth): Promise<PayoutView | null> {
  return (await getPayoutState(auth)).payout;
}
/** payout + choice: ¿puede elegir wallet o Cuenta IBAN? (false sin la migración 029: solo Cuenta IBAN, como antes). */
export async function getPayoutState(auth: MeteoritoAuth): Promise<{ payout: PayoutView | null; choice: boolean }> {
  try { const r = await api<{ payout: PayoutView | null; choice?: boolean }>(auth, '/api/store', { action: 'payout_get' }); return { payout: r.payout, choice: r.choice === true }; } catch (e) { return friendly(e); }
}
export type WalletCheck = 'ready' | 'no_trustline' | 'no_account';
export const checkPayoutWallet = (auth: MeteoritoAuth, stellar_address: string) =>
  api<{ state: WalletCheck }>(auth, '/api/store', { action: 'payout_check', stellar_address }).then((r) => r.state);
export async function savePayoutWallet(auth: MeteoritoAuth, stellar_address: string): Promise<{ payout: PayoutView; state: WalletCheck }> {
  try { return await api<{ payout: PayoutView; state: WalletCheck }>(auth, '/api/store', { action: 'payout_set', method: 'wallet', stellar_address }); } catch (e) { return friendly(e); }
}
/** Validación local de una dirección Stellar (G + 55 caracteres base32). El servidor revisa el checksum. */
export function stellarAddressError(v: string): string | null {
  const s = v.trim().toUpperCase();
  if (!s) return 'Pega la dirección de tu wallet.';
  if (!s.startsWith('G')) return 'La dirección empieza con G.';
  if (!/^[A-Z2-7]*$/.test(s)) return 'La dirección solo tiene letras y números del 2 al 7.';
  if (s.length !== 56) return `Le ${s.length < 56 ? 'faltan' : 'sobran'} ${Math.abs(56 - s.length)} caracteres (son 56).`;
  return null;
}
/** Beta en testnet: elige Cuenta IBAN sin mandar ningún dato de cuenta (el servidor guarda el dato de ejemplo). */
export async function savePayout(auth: MeteoritoAuth): Promise<PayoutView> {
  try { return (await api<{ payout: PayoutView }>(auth, '/api/store', { action: 'payout_set', method: 'iban' })).payout; } catch (e) { return friendly(e); }
}

/** Pasos del perfil (la verificación con cédula todavía no está activa y no cuenta para el %). */
export interface ProfileStep { key: string; label: string; done: boolean; soon?: boolean }
export function profileSteps(p: { name?: string | null; storeSlug?: string | null; payout?: boolean; products?: number }): ProfileStep[] {
  return [
    { key: 'name', label: 'Tu nombre', done: !!p.name?.trim() },
    { key: 'store', label: 'Usuario de tienda', done: !!p.storeSlug },
    { key: 'iban', label: 'Dónde cobrar', done: !!p.payout },
    { key: 'product', label: 'Tu primer producto', done: (p.products ?? 0) > 0 },
    { key: 'id', label: COPY.myStore.confirmIdentity, done: false, soon: true },
  ];
}
export const profilePct = (steps: ProfileStep[]) => {
  const active = steps.filter((s) => !s.soon);
  return Math.round((active.filter((s) => s.done).length / active.length) * 100);
};
