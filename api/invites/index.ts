// /api/invites  (una sola función serverless; límite de funciones del plan de Vercel)
//  GET  ?code=xxxxxxxx                          -> invitación pública (+ mine:true si X-Guest-Key es del comprador). Sin login.
//  POST { op:'create', title, price_crc, photos?, note? }          (X-Guest-Key del comprador, sin cuenta)
//       (compatible: { category, brand, model, ... } sigue funcionando; category es opcional, por defecto 'otro')
//  POST { op:'cancel', code }                                       (solo el comprador, solo si sigue abierta)
import { db, json, fail } from '../_lib/db';
import { HttpError } from '../_lib/auth';
import { guestSubFromReq } from '../_lib/guest';
import { MAX_PHOTOS, publicPrefix } from '../_lib/photos';
import { missingColumn } from '../_lib/listings';
import { INVITE_CATS, inviteByCode, inviteCode, inviteErr, publicInvite, validCode } from '../_lib/invites';

const str = (v: unknown, max: number, req = true) => {
  if (v == null || v === '') { if (req) throw new HttpError(400, 'faltan campos'); return null; }
  if (typeof v !== 'string' || v.length > max) throw new HttpError(400, 'campo inválido'); return v.trim();
};

export default async function handler(req: any, res: any) {
  try {
    if (req.method === 'GET') {
      const code = Array.isArray(req.query?.code) ? req.query.code[0] : req.query?.code;
      if (!validCode(code)) throw new HttpError(400, 'código inválido');
      const inv = await inviteByCode(code);
      if (!inv) throw new HttpError(404, 'invitación no existe');
      const g = guestSubFromReq(req);
      res.setHeader?.('Cache-Control', 'no-store');
      return json(res, 200, publicInvite(inv, !!g && g === inv.buyer_user_id));
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'method' });
    const b = req.body ?? {};
    const guest = guestSubFromReq(req);
    if (!guest) throw Object.assign(new HttpError(401, 'Falta la llave de invitado. Vuelve a abrir el link en el mismo navegador.'), { code: 'guest_key_missing' });
    if (b.op === 'create') {
      const category = b.category == null || b.category === '' ? 'otro' : b.category;
      if (!INVITE_CATS.includes(category)) throw new HttpError(400, 'categoría inválida');
      const price = Number(b.price_crc);
      if (!Number.isInteger(price) || price < 1000 || price > 50_000_000) throw new HttpError(400, 'precio inválido');
      // Mismos campos que el vendedor: nombre (title) + precio + fotos opcionales. Por compatibilidad, marca + modelo.
      const title = str(b.title, 80, false);
      const brand = title ? '' : str(b.brand, 60);
      const model = title ?? str(b.model, 80);
      if (!`${brand ?? ''} ${model ?? ''}`.trim() || (title != null && title.length < 3)) throw new HttpError(400, 'Escribe el nombre de lo que quieres comprar.');
      const photos: string[] = Array.isArray(b.photos) ? b.photos : [];
      if (photos.length > MAX_PHOTOS || photos.some((u) => typeof u !== 'string' || !u.startsWith(publicPrefix(guest)))) throw new HttpError(400, 'fotos inválidas');
      const row: Record<string, unknown> = { buyer_user_id: guest, category, brand, model, price_crc: price, note: str(b.note, 500, false), status: 'abierta', ...(photos.length ? { photos } : {}) };
      for (let i = 0; i < 5; i++) {
        const code = inviteCode();
        let { error } = await db().from('invitations').insert({ ...row, code });
        if (error && row.photos && missingColumn(error)) { delete row.photos; ({ error } = await db().from('invitations').insert({ ...row, code })); } // sin 012: sin fotos
        if (!error) return json(res, 200, { code });
        if (error.code !== '23505') inviteErr(error);
      }
      throw new Error('no se pudo generar el código');
    }
    if (b.op === 'cancel') {
      if (!validCode(b.code)) throw new HttpError(400, 'código inválido');
      const inv = await inviteByCode(b.code);
      if (!inv) throw new HttpError(404, 'invitación no existe');
      if (inv.buyer_user_id !== guest) throw new HttpError(403, 'no eres quien creó esta invitación');
      if (inv.status !== 'abierta') throw new HttpError(409, `la invitación ya está ${inv.status}`);
      const { data, error } = await db().from('invitations').update({ status: 'cancelada' }).eq('code', inv.code).eq('status', 'abierta').select('code');
      if (error) inviteErr(error);
      if (!data?.length) throw new HttpError(409, 'la invitación ya no está abierta');
      return json(res, 200, { ok: true });
    }
    throw new HttpError(400, 'op inválida');
  } catch (e) { return fail(res, e); }
}
