// Regla v3 "Período de reclamo de 30 días" (cliente). Misma función que las disputas (api/escrow/dispute.ts, acciones claim_*).
// El servidor valida identidad, versión del pedido y plazo; sin la migración 035 responde available:false y no se muestra nada.
import { api, guestApi } from './api';
import type { MeteoritoAuth } from './types';
import type { ClaimStatus } from '../api/_lib/orderRules';

const PATH = '/api/escrow/dispute';
export interface ClaimView { status: ClaimStatus; reason: string; description: string; opened_at: string; counts_at: string | null; counts: boolean;
  seller_response: string | null; responded_at: string | null; resolved_at: string | null }
export interface BuyerClaimState { available: boolean; applies: boolean; window: { phase: 'na' | 'open' | 'closed'; until: string | null }; claim: ClaimView | null }
export interface SellerClaimState { available: boolean; claim: ClaimView | null; can_respond?: boolean }
export interface AdminClaimRow extends ClaimView { slug: string; resolved_by: string | null; resolution_note: string | null }

export const getBuyerClaim = (auth: Pick<MeteoritoAuth, 'getAuthToken'>, slug: string) => guestApi<BuyerClaimState>(auth, PATH, { action: 'claim_get', slug });
export const openBuyerClaim = (auth: Pick<MeteoritoAuth, 'getAuthToken'>, slug: string, reason: string, description: string) =>
  guestApi<{ opened?: boolean; already?: boolean; claim: ClaimView }>(auth, PATH, { action: 'claim_open', slug, reason, description });
export const getSellerClaim = (auth: MeteoritoAuth, slug: string) => api<SellerClaimState>(auth, PATH, { action: 'claim_seller_get', slug });
export const respondSellerClaim = (auth: MeteoritoAuth, slug: string, body: string) => api<{ responded: boolean; claim: ClaimView }>(auth, PATH, { action: 'claim_respond', slug, body });
export const listAdminClaims = (auth: MeteoritoAuth) => api<{ available: boolean; claims: AdminClaimRow[] }>(auth, PATH, { action: 'admin_claims' });
export const resolveAdminClaim = (auth: MeteoritoAuth, slug: string, note: string) => api<{ resolved?: boolean; already?: boolean }>(auth, PATH, { action: 'admin_claim_resolve', slug, note });

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = { abierto: 'Abierto', respondido: 'Respondido', resuelto: 'Resuelto' };
export const CLAIM_REASON_LABEL: Record<string, string> = { no_llego: 'No llegó', no_funciona: 'No funciona', no_es_lo_descrito: 'No es lo descrito', otro: 'Otro' };
