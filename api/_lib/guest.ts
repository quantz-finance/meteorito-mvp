// Comprador INVITADO (sin cuenta, sin login). Decisión de diseño del MVP testnet (ver docs/guest-checkout.md):
//  - El navegador del comprador genera una llave secreta aleatoria (64 hex) y la guarda en localStorage. Viaja en X-Guest-Key.
//  - El servidor NUNCA la guarda: la identidad del comprador es buyer_user_id = 'guest:' + sha256(sal + llave)[0..40].
//  - Quien tenga la llave controla ese pedido (confirmar recepción, abrir disputa). Es un secreto "portador", como el link mágico de un correo.
//  - Sin wallet propia: el escrow se despliega con la wallet `platform` como buyer_address (reembolsos de disputa los gestiona el equipo).
import { createHash } from 'node:crypto';
import { requireCavosUser, HttpError, type CavosUser } from './auth';
import { grantBuyerFromReq, linkedGuests } from './buyerContact';
import { db } from './db';

export const GUEST_PREFIX = 'guest:';
export const isGuestSub = (sub: unknown) => typeof sub === 'string' && sub.startsWith(GUEST_PREFIX);

/** buyer_user_id del invitado a partir de su llave, o null si no hay llave / es inválida. */
export function guestSubFromReq(req: any): string | null {
  const raw = req.headers?.['x-guest-key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) return null;
  return GUEST_PREFIX + createHash('sha256').update(`meteorito-guest-v1:${key}`).digest('hex').slice(0, 40);
}

export interface BuyerIdentity {
  /** Identidades con las que esta petición puede actuar como comprador (sub de Cavos y/o invitado). */
  ids: string[];
  guest: string | null;
  cavos: CavosUser | null;
}

/** Comprador = invitado (X-Guest-Key) y/o cuenta Cavos (compradores anteriores al modo invitado). Un token Cavos malo se ignora si hay llave de invitado. */
export async function requireBuyerIdentity(req: any): Promise<BuyerIdentity> {
  const guest = guestSubFromReq(req);
  const hasBearer = String(req.headers?.authorization ?? '').startsWith('Bearer ');
  let cavos: CavosUser | null = null;
  if (hasBearer) {
    try { cavos = await requireCavosUser(req); }
    catch (e) { if (!guest) throw e; }
  }
  // Link de acceso ya abierto en este dispositivo (X-Order-Access): vale SOLO para el pedido del body (slug).
  const granted = grantBuyerFromReq(req, req.body?.slug);
  if (!guest && !cavos && !granted) throw Object.assign(new HttpError(401, 'Falta la llave de invitado. Vuelve a abrir el link en el mismo navegador.'), { code: 'guest_key_missing' });
  // Cuenta vinculada a llaves de invitado (migración 028): sus compras sin cuenta también son de la cuenta. Sin 028: nada.
  const linked = cavos ? await linkedGuests(db(), cavos.sub) : [];
  const ids = [...new Set([guest, cavos?.sub, granted, ...linked].filter(Boolean) as string[])];
  return { ids, guest, cavos };
}
export const isBuyerOf = (order: any, who: BuyerIdentity) => !!order.buyer_user_id && who.ids.includes(order.buyer_user_id);
