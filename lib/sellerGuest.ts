// Vendedor SIN cuenta: acepta la invitación con un código por correo (api/invites, ops seller_*). La sesión es una cookie
// HttpOnly que pone el servidor (solo para ese pedido): este archivo nunca la ve ni la guarda.
import { guestApi } from './api';
import { SELLER_GUEST_CONSENT_VERSION } from '../api/_lib/sellerGuestText';

/** Consentimiento del correo (la casilla): el servidor lo exige y lo registra aparte de la aceptación (migración 039). */
const consent = { consent: true, consent_version: SELLER_GUEST_CONSENT_VERSION } as const;

const noAccount = { getAuthToken: () => null } as const; // sin Bearer: actúa la sesión del vendedor, no una cuenta
/** Llamadas del vendedor sin cuenta (envío, PIN, disputa): misma forma que api(auth, path, body). */
export const sellerCall = <T = any>(path: string, body: unknown) => guestApi<T>(noAccount as any, path, body);

export const requestSellerCode = (code: string, email: string, delivery_mode: string, agreement_hash: string) =>
  sellerCall<{ challenge_id: string; expires_at: string; sent_to: string }>('/api/invites', { op: 'seller_otp_request', code, email, delivery_mode, agreement_hash, ...consent });
export const acceptAsSeller = (code: string, challenge_id: string, otp: string, delivery_mode: string, agreement_hash: string) =>
  sellerCall<{ slug: string; accepted: true }>('/api/invites', { op: 'seller_accept', code, challenge_id, otp, delivery_mode, agreement_hash });
export const requestRecoverCode = (code: string, email: string) => sellerCall<{ sent: true; challenge_id: string | null }>('/api/invites', { op: 'seller_recover_request', code, email, ...consent });
export const recoverSeller = (code: string, challenge_id: string, otp: string) => sellerCall<{ slug: string }>('/api/invites', { op: 'seller_recover_verify', code, challenge_id, otp });
