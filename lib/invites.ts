// Invitaciones de compra (comprador -> vendedor). API: /api/invites (docs/buyer-invites.md).
import { guestApi } from './api';
import { guestKey } from './guest';
import { DEMO_ENABLED } from './demo';
import { PUBLIC_BASE_URL } from './orders';
import type { MeteoritoAuth } from './types';

export interface Invite {
  code: string; category: string; brand: string; model: string; price_crc: number; note: string | null;
  status: 'abierta' | 'aceptada' | 'cancelada'; order_slug: string | null; created_at: string; mine: boolean;
}
export const inviteLink = (code: string) => `${PUBLIC_BASE_URL}/i/${code}`;
const MINE = 'meteorito:guest:invites';

export function myInviteCodes(): string[] { try { return JSON.parse(window.localStorage.getItem(MINE) ?? '[]'); } catch { return []; } }
function remember(code: string) { try { window.localStorage.setItem(MINE, JSON.stringify([code, ...myInviteCodes().filter((c) => c !== code)].slice(0, 20))); } catch { /* sin storage */ } }

export async function getInvite(code: string): Promise<Invite | null> {
  if (DEMO_ENABLED) return null;
  const r = await fetch(`/api/invites?code=${encodeURIComponent(code)}`, { headers: { 'X-Guest-Key': guestKey() }, cache: 'no-store' });
  if (r.status === 404) return null;
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
  return j as Invite;
}

export async function createInvite(auth: Pick<MeteoritoAuth, 'getAuthToken'>, i: { category: string; brand: string; model: string; price_crc: number; note?: string }): Promise<string> {
  if (DEMO_ENABLED) throw new Error('Las invitaciones no están disponibles en el modo demo.');
  const r = await guestApi<{ code: string }>(auth, '/api/invites', { op: 'create', ...i });
  remember(r.code);
  return r.code;
}
export async function cancelInvite(auth: Pick<MeteoritoAuth, 'getAuthToken'>, code: string) { await guestApi(auth, '/api/invites', { op: 'cancel', code }); }
