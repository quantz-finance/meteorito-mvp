// POST /api/escrow/confirm (Bearer JWT Cavos)
//  { slug, reason: 'buyer_confirm' }          -> comprador toca "Recibí"
//  { slug, reason: 'pin', pin: '123456' }      -> vendedor ingresa el PIN que le dio el comprador
//     (cara a cara: desde 'fondeado', no hay paso de envío)
//  { slug, reason: 'extend', days: 1|3|7 }     -> comprador o vendedor pide más plazo (la otra parte acepta o rechaza)
//  { slug, reason: 'extend_answer', accept }   -> la otra parte responde; aceptar mueve auto_release_at
//     Tope: 30 días desde el pago. Pendiente congela el auto-release hasta la respuesta o 24 h (ver releaseBlockedUntil).
// El backend approver aprueba el hito y el release signer libera (verificación on-chain previa).
import { json, fail, orderBySlug, db, logEvent } from '../_lib/db';
import { requireCavosUser, HttpError } from '../_lib/auth';
import { requireBuyerIdentity, isBuyerOf } from '../_lib/guest';
import { approveAndRelease, pinHash } from '../_lib/escrow';
import { timingSafeEqual } from 'node:crypto';
import { releaseDueAt } from '../_lib/env';
import { EXTENSION_DAYS, MAX_TOTAL_FROM_PAYMENT_MIN, daysLabel, extendedOf, isFaceToFace, pendingExtension } from '../_lib/agreement';
import { missingColumn } from '../_lib/listings';
import { extensionMessages, notifyOrder } from '../_lib/push';

/** Extensión de mutuo acuerdo. Solo comprador y vendedor; solo con el plazo corriendo y sin disputa. */
async function extension(req: any, order: any, reason: 'extend' | 'extend_answer') {
  const who = await requireBuyerIdentity(req).catch(async () => ({ ids: [] as string[], guest: null, cavos: await requireCavosUser(req) }));
  const roles: ('buyer' | 'seller')[] = [];
  if (isBuyerOf(order, who as any)) roles.push('buyer');
  if (who.cavos && order.seller_user_id === who.cavos.sub) roles.push('seller');
  if (!roles.length) throw new HttpError(403, 'Solo el comprador y el vendedor pueden cambiar el plazo.');
  const running = order.status === 'enviado' || (order.status === 'fondeado' && isFaceToFace(order));
  if (!running || order.dispute_tx || order.disputed_at) throw Object.assign(new HttpError(409, 'El plazo no se puede cambiar en este momento.'), { code: 'ext_not_running' });
  const paid = Date.parse(order.funded_at ?? '');
  const fits = (days: number) => paid > 0 && Date.parse(releaseDueAt(order)) + days * 86_400_000 <= paid + MAX_TOTAL_FROM_PAYMENT_MIN * 60_000;
  const save = async (patch: Record<string, unknown>) => {
    const { error } = await db().from('orders').update(patch).eq('id', order.id).eq('status', order.status);
    if (error && missingColumn(error)) throw Object.assign(new HttpError(409, 'Todavía no puedes extender el plazo.'), { code: 'ext_unavailable' });
    if (error) throw error;
  };
  const pending = pendingExtension(order);
  if (reason === 'extend') {
    const days = Number(req.body?.days);
    if (!(EXTENSION_DAYS as readonly number[]).includes(days)) throw new HttpError(400, 'Elige 1, 3 o 7 días.');
    if (pending) throw Object.assign(new HttpError(409, 'Ya hay una solicitud esperando respuesta.'), { code: 'ext_pending' });
    if (!fits(days)) throw Object.assign(new HttpError(409, `Con ${daysLabel(days)} más pasarías los 30 días desde el pago.`), { code: 'ext_cap' });
    const by = roles.includes('buyer') ? 'buyer' : 'seller';
    const ext = { by, days, at: new Date().toISOString() };
    await save({ release_ext: ext });
    await logEvent(order.id, 'extension_requested', { by, days });
    await notifyOrder(order, {}, extensionMessages(order, 'requested', by, days));
    return { pending: ext };
  }
  if (!pending) throw Object.assign(new HttpError(409, 'No hay ninguna solicitud pendiente.'), { code: 'ext_none' });
  if (!roles.some((r) => r !== pending.by)) throw new HttpError(403, 'La otra parte tiene que responder tu solicitud.');
  const accept = req.body?.accept === true;
  if (accept && !fits(pending.days)) throw Object.assign(new HttpError(409, `Con ${daysLabel(pending.days)} más pasarías los 30 días desde el pago.`), { code: 'ext_cap' });
  const extMin = extendedOf(order) + (accept ? pending.days * 1440 : 0);
  const due = accept ? releaseDueAt({ ...order, release_ext_minutes: extMin }) : order.auto_release_at ?? null;
  await save(accept ? { release_ext: null, release_ext_minutes: extMin, auto_release_at: due } : { release_ext: null });
  await logEvent(order.id, accept ? 'extension_accepted' : 'extension_rejected', { by: pending.by, days: pending.days, ...(accept ? { auto_release_at: due } : {}) });
  await notifyOrder(order, {}, extensionMessages(order, accept ? 'accepted' : 'rejected', pending.by, pending.days));
  return { accepted: accept, autoReleaseAt: due };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  try {
    const { slug, reason, pin } = req.body ?? {};
    const order = await orderBySlug(slug);
    if (reason === 'extend' || reason === 'extend_answer') return json(res, 200, await extension(req, order, reason));
    if (reason === 'buyer_confirm') {
      if (!isBuyerOf(order, await requireBuyerIdentity(req))) throw new HttpError(403, 'no eres el comprador');
    } else if (reason === 'pin') {
      const user = await requireCavosUser(req);
      if (order.seller_user_id !== user.sub) throw new HttpError(403, 'no eres el vendedor');
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
