// Panel admin de disputas (cliente). El servidor decide quién es admin (ADMIN_EMAILS contra el token Cavos verificado):
// aquí solo preguntamos (admin_me) para mostrar o no la entrada "Disputas". Un 404 = no es admin. Nunca se decide en el cliente.
import { useEffect, useState } from 'react';
import { api } from './api';
import type { MeteoritoAuth } from './types';
import type { AdminDisputeDetail, AdminDisputeRow, AiView } from '../api/_lib/disputeView';
import type { DisputeTab, Outcome } from '../api/_lib/disputeRules';

export type { AdminDisputeDetail, AdminDisputeRow, AiView, DisputeTab, Outcome };
const PATH = '/api/escrow/dispute';

// Una pregunta por sesión (sub+exp del token): no se repite en cada foco de Home.
const cache = new Map<string, boolean>();
const keyOf = (auth: MeteoritoAuth) => `${auth.address ?? ''}:${auth.email ?? ''}`;
export const __resetAdminCache = () => cache.clear();

export async function checkAdmin(auth: MeteoritoAuth): Promise<boolean> {
  if (!auth.isAuthenticated || !auth.address) return false;
  const k = keyOf(auth);
  if (cache.has(k)) return cache.get(k)!;
  try { const r = await api<{ admin?: boolean }>(auth, PATH, { action: 'admin_me' }); cache.set(k, r.admin === true); }
  catch (e: any) { if (e?.status === 404 || e?.status === 403) cache.set(k, false); else return false; }
  return cache.get(k) ?? false;
}
/** null mientras pregunta; true/false después. */
export function useIsAdmin(auth: MeteoritoAuth): boolean | null {
  const [v, setV] = useState<boolean | null>(() => (cache.has(keyOf(auth)) ? cache.get(keyOf(auth))! : null));
  useEffect(() => {
    let live = true;
    if (!auth.isAuthenticated || !auth.address) { setV(false); return; }
    checkAdmin(auth).then((x) => { if (live) setV(x); });
    return () => { live = false; };
  }, [auth.isAuthenticated, auth.address, auth.email]); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

export interface AdminList { disputes: AdminDisputeRow[]; counts: Record<DisputeTab, number>; flags: { autoResolve: boolean; ai: boolean }; capabilities: { responses: boolean; executeOnchain: boolean; auditTable: boolean; ai: boolean } }
export const listDisputes = (auth: MeteoritoAuth) => api<AdminList>(auth, PATH, { action: 'admin_list' });
export const getDispute = (auth: MeteoritoAuth, slug: string) => api<AdminDisputeDetail>(auth, PATH, { action: 'admin_get', slug });
export const aiDispute = (auth: MeteoritoAuth, slug: string, refresh = false) => api<{ available: boolean; reason?: string; result: AiView | null; cached: boolean }>(auth, PATH, { action: 'admin_ai', slug, refresh });
export interface DecideResult { executed: boolean; pending?: boolean; command?: string; resolvedTx?: string; toBuyer?: number; toSeller?: number; guestRefundPending?: boolean }
export const decideDispute = (auth: MeteoritoAuth, slug: string, d: { outcome: Outcome; buyer_pct?: number; note: string; rule_id?: string | null; ai_recommendation?: string | null }) =>
  api<DecideResult>(auth, PATH, { action: 'admin_decide', slug, confirm: true, ...d });
export const markGuestRefunded = (auth: MeteoritoAuth, slug: string, note: string) => api<{ done: boolean }>(auth, PATH, { action: 'admin_guest_refund', slug, note });

/* ---------- Pagos a Cuenta IBAN (cola manual, 029) ---------- */
export type { AdminPayoutRow } from '../api/_lib/payoutChoice';
import type { AdminPayoutRow } from '../api/_lib/payoutChoice';
export const listPayouts = (auth: MeteoritoAuth) => api<{ available: boolean; payouts: AdminPayoutRow[]; counts: { pendiente: number; pagado: number } }>(auth, PATH, { action: 'admin_payouts' });
export const markPayoutPaid = (auth: MeteoritoAuth, slug: string, note: string) => api<{ done: boolean; already: boolean; paid_at: string }>(auth, PATH, { action: 'admin_payout_reviewed', slug, note });

/* ---------- Vendedor: su versión de la disputa ---------- */
export interface SellerResponseState { available: boolean; open: boolean; response: { body: string; photo: string | null; created_at: string } | null; deadline: string | null; can_respond: boolean }
export const getSellerResponse = (auth: MeteoritoAuth, slug: string) => api<SellerResponseState>(auth, PATH, { action: 'seller_response_get', slug });
export const sendSellerResponse = (auth: MeteoritoAuth, slug: string, body: string, photo?: { url: string; token: string } | null) =>
  api<{ saved: boolean; response: SellerResponseState['response'] }>(auth, PATH, { action: 'seller_respond', slug, body, ...(photo ? { photo: photo.url, capture: photo.token } : {}) });

/* ---------- Formato ---------- */
const H = 3_600_000;
/** "hace 3 h", "hace 2 d" */
export function ageLabel(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const ms = Math.max(0, now - Date.parse(iso));
  if (ms < H) return `hace ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < 48 * H) return `hace ${Math.round(ms / H)} h`;
  return `hace ${Math.round(ms / (24 * H))} d`;
}
/** "vence en 5 h" / "venció hace 2 h" */
export function deadlineLabel(iso: string | null | undefined, now = Date.now()): { text: string; late: boolean } | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - now;
  const fmt = (x: number) => (x < H ? `${Math.max(1, Math.round(x / 60_000))} min` : x < 48 * H ? `${Math.round(x / H)} h` : `${Math.round(x / (24 * H))} d`);
  return ms >= 0 ? { text: `vence en ${fmt(ms)}`, late: false } : { text: `venció hace ${fmt(-ms)}`, late: true };
}
export const shortDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('es-CR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
