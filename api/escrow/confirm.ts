// POST /api/escrow/confirm (Bearer JWT Cavos)
//  { slug, reason: 'buyer_confirm' }          -> comprador toca "Recibí"
//  { slug, reason: 'pin', pin: '123456' }      -> vendedor ingresa el PIN que le dio el comprador
// El backend approver aprueba el hito y el release signer libera (verificación on-chain previa).
import { json, fail, orderBySlug, db, logEvent } from '../_lib/db';
import { requireCavosUser, HttpError } from '../_lib/auth';
import { approveAndRelease, pinHash } from '../_lib/escrow';
import { timingSafeEqual } from 'node:crypto';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  try {
    const user = await requireCavosUser(req);
    const { slug, reason, pin } = req.body ?? {};
    const order = await orderBySlug(slug);
    if (reason === 'buyer_confirm') {
      if (order.buyer_user_id !== user.sub) throw new HttpError(403, 'no sos el comprador');
    } else if (reason === 'pin') {
      if (order.seller_user_id !== user.sub) throw new HttpError(403, 'no sos el vendedor');
      if ((order.pin_attempts ?? 0) >= 3) throw new HttpError(429, 'demasiados intentos de PIN');
      const ok = typeof pin === 'string' && /^\d{6}$/.test(pin) && order.delivery_pin_hash &&
        timingSafeEqual(Buffer.from(pinHash(order.id, pin)), Buffer.from(order.delivery_pin_hash));
      if (!ok) {
        await db().from('orders').update({ pin_attempts: (order.pin_attempts ?? 0) + 1 }).eq('id', order.id);
        await logEvent(order.id, 'pin_failed');
        throw new HttpError(401, 'PIN incorrecto');
      }
    } else throw new HttpError(400, 'reason inválido');
    return json(res, 200, await approveAndRelease(order, reason));
  } catch (e) { return fail(res, e); }
}
