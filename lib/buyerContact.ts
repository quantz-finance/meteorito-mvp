// Cliente de "Recibe avisos de tu compra" (comprador sin cuenta). Servidor: api/_lib/buyerContact.ts vía /api/store.
import { guestApi } from './api';
import type { MeteoritoAuth } from './types';
import { CONTACT_CONSENT_VERSION, type ContactChannel } from '../api/_lib/contactText';

type Auth = Pick<MeteoritoAuth, 'getAuthToken'>;
export interface ContactView { channel: ContactChannel; masked: string }
export interface ContactState { available: boolean; contacts: ContactView[]; email: boolean }

const call = <T,>(auth: Auth, body: Record<string, unknown>) => guestApi<T>(auth, '/api/store', body);
export const getContacts = (auth: Auth, slug: string) => call<ContactState>(auth, { action: 'buyer_contact_get', slug });
export const saveContact = (auth: Auth, slug: string, input: { channel: ContactChannel; cc?: string; phone?: string; email?: string }) =>
  call<{ saved: true; contact: ContactView; emailed: boolean }>(auth, { action: 'buyer_contact_save', slug, ...input, consent: true, consent_version: CONTACT_CONSENT_VERSION });
export const removeContact = (auth: Auth, slug: string, channel: ContactChannel) => call<{ removed: true }>(auth, { action: 'buyer_contact_remove', slug, channel });
export const linkAccount = (auth: Auth, slug: string) =>
  call<{ linked: boolean; reason?: string }>(auth, { action: 'buyer_link_account', slug, consent: true, consent_version: CONTACT_CONSENT_VERSION });
export const redeemAccess = (auth: Auth, slug: string, token: string) => call<{ grant: string; slug: string }>(auth, { action: 'buyer_access_redeem', slug, token });
export const requestAccess = (auth: Auth, slug: string, email: string) => call<{ requested: true }>(auth, { action: 'buyer_access_request', slug, email });
export const reissuePin = (auth: Auth, slug: string) => call<{ pin: string }>(auth, { action: 'buyer_pin_reissue', slug });

// "Crear cuenta": el login de Cavos puede salir a Google/Apple y volver a esta misma URL (redirect_uri = location.href).
// La intención queda en localStorage para terminar el vínculo al volver, en esta pestaña o en otra.
const PENDING = 'meteorito:contact:link-pending';
export const LINK_PENDING_TTL_MS = 30 * 60_000;
const ls = () => { try { return window.localStorage; } catch { return null; } };
export function markLinkPending(slug: string, now = Date.now()) { ls()?.setItem(PENDING, JSON.stringify({ slug, at: now })); }
export function linkPendingFor(slug: string, now = Date.now()): boolean {
  try { const v = JSON.parse(ls()?.getItem(PENDING) ?? 'null'); return !!v && v.slug === slug && now - Number(v.at) < LINK_PENDING_TTL_MS; } catch { return false; }
}
export function clearLinkPending() { ls()?.removeItem(PENDING); }

// "Ahora no": por pedido, para no insistir.
const DISMISS = (slug: string) => `meteorito:contact:dismissed:${slug}`;
export const contactDismissed = (slug: string) => ls()?.getItem(DISMISS(slug)) === '1';
export const dismissContact = (slug: string) => ls()?.setItem(DISMISS(slug), '1');
