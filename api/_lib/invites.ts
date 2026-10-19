// Invitaciones de compra: el comprador inicia, el vendedor confirma publicando el listing (ver docs/buyer-invites.md).
import { randomBytes } from 'node:crypto';
import { db } from './db';
import { HttpError } from './auth';

export const INVITE_CATS = ['celular', 'consola', 'laptop', 'tablet', 'camara', 'otro'];
const A = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const inviteCode = () => { let s = ''; while (s.length < 8) { const b = randomBytes(1)[0]; if (b < 252) s += A[b % 36]; } return s; };
export const validCode = (c: unknown): c is string => typeof c === 'string' && /^[a-z0-9]{8}$/.test(c);
const NOT_READY = 'Las invitaciones todavía no están disponibles en este entorno.';

/** Si la migración 009 no está aplicada, PostgREST responde 42P01/PGRST205: error claro en vez de 500 genérico. */
function tableMissing(e: any) { return e?.code === '42P01' || e?.code === 'PGRST205' || /invitations/.test(String(e?.message)) && /(does not exist|schema cache)/.test(String(e?.message)); }
export function inviteErr(e: any): never { if (tableMissing(e)) throw Object.assign(new HttpError(503, NOT_READY), { code: 'invites_unavailable' }); throw e; }

export async function inviteByCode(code: string): Promise<any | null> {
  const { data, error } = await db().from('invitations').select('*').eq('code', code).maybeSingle();
  if (error) inviteErr(error);
  return data ?? null;
}
/** Invitación ligada a un link de pago (reserva el link a quien invitó). Nunca rompe el pago si la tabla no existe. */
export async function inviteForOrder(slug: string): Promise<any | null> {
  try { const { data, error } = await db().from('invitations').select('*').eq('order_slug', slug).maybeSingle(); return error ? null : data ?? null; } catch { return null; }
}
/** Vista pública: nunca expone buyer_user_id / seller_user_id. */
export const publicInvite = (i: any, mine: boolean) => ({
  code: i.code, category: i.category, brand: i.brand, model: i.model, price_crc: i.price_crc, note: i.note ?? null,
  status: i.status, order_slug: i.order_slug ?? null, created_at: i.created_at, mine,
});
