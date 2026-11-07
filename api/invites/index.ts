// /api/invites  (una sola función serverless; límite de funciones del plan de Vercel)
//  GET  ?code=xxxxxxxx                          -> invitación pública (+ mine:true si X-Guest-Key es del comprador). Sin login.
//  POST { op:'create', title, price_crc, photos?, note?, source_url? } (X-Guest-Key del comprador, sin cuenta)
//       source_url: link del anuncio (Facebook, Mercado Libre, Amazon, cualquier tienda https) que vio el comprador
//       (referencia para el vendedor; migración 015). Se acepta aunque no lo podamos leer.
//       (compatible: { category, brand, model, ... } sigue funcionando; category es opcional, por defecto 'otro')
//  POST { op:'cancel', code }                                       (solo el comprador, solo si sigue abierta)
//  Vendedor SIN cuenta (api/_lib/sellerGuest.ts, docs/vendedor-sin-cuenta.md; flag SELLER_GUEST_ENABLED, solo testnet):
//  POST { op:'seller_otp_request', code, email, delivery_mode, agreement_hash }        -> código por correo
//  POST { op:'seller_accept', code, challenge_id, otp, delivery_mode, agreement_hash } -> pedido + aceptación + cookie HttpOnly
//  POST { op:'seller_recover_request', code, email } / { op:'seller_recover_verify', code, challenge_id, otp } -> sesión nueva
//       seller_otp_request y seller_recover_request exigen consent:true + consent_version vigente (migración 039).
//  POST { op:'seller_guest_purge', email? } (solo admin, Bearer Cavos) -> retención: disocia correos vencidos (90 días) o, con
//       email, el de ese vendedor a pedido (nunca con una venta abierta). pg_cron lo corre cada día (meteorito_seller_guest_retention).
//  GET agrega seller_guest {available, agreements} (invitación abierta) y seller_order (solo con la sesión del vendedor).
import { db, json, fail } from '../_lib/db';
import { scrubStoredPhotos } from '../_lib/scrubPhotos';
import { HttpError } from '../_lib/auth';
import { guestSubFromReq } from '../_lib/guest';
import { MAX_PHOTOS, publicPrefix } from '../_lib/photos';
import { cameraRequired, listingPhotoOk } from '../_lib/capture';
import { missingColumn } from '../_lib/listings';
import { checkListingUrl } from '../_lib/importers/providers';
import { INVITE_CATS, inviteByCode, inviteCode, inviteErr, publicInvite, validCode } from '../_lib/invites';
import { S, validate } from '../_lib/validate';
import { rateLimit } from '../_lib/rateLimit';
import { assertRisk } from '../_lib/risk';
import { acceptInvite, agreementsFor, guestSellerSession, otpRequest, purgeGuests, recoverRequest, recoverVerify, sellerGuestAvailable, sellerOrderView } from '../_lib/sellerGuest';
import { requireAdmin } from '../_lib/admin';

const SELLER_OPS = new Set(['seller_otp_request', 'seller_accept', 'seller_recover_request', 'seller_recover_verify']);
/** Bloque público del vendedor sin cuenta. Nunca expone sesión, correo, hash del código ni IBAN. */
async function sellerGuestBlock(req: any, inv: any) {
  const av = sellerGuestAvailable();
  const out: Record<string, unknown> = { seller_guest: { available: av.available, ...(inv.status === 'abierta' ? { agreements: agreementsFor(inv) } : {}) } };
  if (inv.status === 'aceptada' && inv.order_slug) {
    try {
      const { data: o } = await db().from('orders').select('*').eq('slug', inv.order_slug).maybeSingle();
      if (o?.seller_auth_kind === 'guest') {
        (out.seller_guest as any).order_is_guest = true;
        if (await guestSellerSession(req, o)) out.seller_order = sellerOrderView(o);
      }
    } catch { /* sin 038: sin bloque */ }
  }
  return out;
}

const str = (v: unknown, max: number, req = true) => {
  if (v == null || v === '') { if (req) throw new HttpError(400, 'faltan campos'); return null; }
  if (typeof v !== 'string' || v.length > max) throw new HttpError(400, 'campo inválido'); return v.trim();
};

export default async function handler(req: any, res: any) {
  try {
    validate(req, S.invites); // zod: forma y tamaños de body/query (api/_lib/validate.ts) -> 400 genérico
    const sellerOp = req.method === 'POST' && SELLER_OPS.has(req.body?.op);
    if (req.method === 'POST' && !sellerOp) await rateLimit(req, 'invites.create'); // límite persistente por IP (migración 037)
    if (req.method === 'GET') {
      const code = Array.isArray(req.query?.code) ? req.query.code[0] : req.query?.code;
      if (!validCode(code)) throw new HttpError(400, 'código inválido');
      const inv = await inviteByCode(code);
      if (!inv) throw new HttpError(404, 'invitación no existe');
      const g = guestSubFromReq(req);
      res.setHeader?.('Cache-Control', 'no-store');
      const mine = !!g && g === inv.buyer_user_id;
      return json(res, 200, { ...publicInvite(inv, mine), ...(mine ? {} : await sellerGuestBlock(req, inv)) });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'method' });
    const b = req.body ?? {};
    if (sellerOp) { // vendedor sin cuenta: no necesita llave de invitado ni cuenta
      res.setHeader?.('Cache-Control', 'no-store');
      await rateLimit(req, b.op === 'seller_accept' || b.op === 'seller_recover_verify' ? 'invites.otp_verify' : 'invites.otp');
      if (!validCode(b.code)) throw new HttpError(400, 'código inválido');
      const inv = await inviteByCode(b.code);
      if (!inv) throw new HttpError(404, 'invitación no existe');
      if (b.op === 'seller_otp_request') return json(res, 200, await otpRequest(req, inv, b));
      if (b.op === 'seller_accept') return json(res, 200, await acceptInvite(req, res, inv, b));
      if (b.op === 'seller_recover_request') return json(res, 200, await recoverRequest(inv, b));
      return json(res, 200, await recoverVerify(res, b));
    }
    if (b.op === 'seller_guest_purge') { await requireAdmin(req); res.setHeader?.('Cache-Control', 'no-store'); return json(res, 200, await purgeGuests(b)); }
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
      let source_url: string | null = null;
      if (b.source_url != null && b.source_url !== '') {
        const chk = typeof b.source_url === 'string' && b.source_url.length <= 1000 ? checkListingUrl(b.source_url) : null;
        if (!chk?.ok || chk.url.length > 1000) throw Object.assign(new HttpError(400, 'El link del anuncio no es válido.'), { code: 'import_url_invalid' });
        source_url = chk.url;
      }
      // Solo fotos de la cámara de la app (token 'listing' del invitado) o, si trae source_url de import, la foto que el
      // servidor guardó al importar ese mismo link.
      if (photos.some((u) => !listingPhotoOk(u, guest, source_url))) throw cameraRequired();
      await scrubStoredPhotos(db().storage, photos); // sin EXIF/GPS (subida firmada: el servidor no vio los bytes)
      // Mismos topes que al publicar (api/_lib/risk.ts). Si no pasa, no se crea la invitación.
      await assertRisk({ req, action: 'order', amountCrc: price, actor: guest });
      const row: Record<string, unknown> = { buyer_user_id: guest, category, brand, model, price_crc: price, note: str(b.note, 500, false), status: 'abierta', ...(photos.length ? { photos } : {}), ...(source_url ? { source_url } : {}) };
      for (let i = 0; i < 5; i++) {
        const code = inviteCode();
        let { error } = await db().from('invitations').insert({ ...row, code });
        // Columnas opcionales que pueden faltar si la migración no está aplicada: 015 (source_url) y 012 (photos).
        for (const col of ['source_url', 'photos']) {
          if (!error || !missingColumn(error) || !(col in row)) continue;
          delete row[col]; ({ error } = await db().from('invitations').insert({ ...row, code }));
        }
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
