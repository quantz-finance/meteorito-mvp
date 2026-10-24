// POST /api/orders/create  (Bearer JWT Cavos + proof{action:'create', ref:'new'})
// Reemplaza el insert directo desde el cliente. anon ya no inserta (migración 003).
import { randomBytes } from 'node:crypto';
import { trackServer, trackApiError } from '../_lib/analytics';
import { db, json, fail } from '../_lib/db';
import { requireCavosUser, requireAddressProof, HttpError, bindWalletIfFresh } from '../_lib/auth';
import { walletState } from '../_lib/wallet';
import { MAX_PHOTOS, publicPrefix } from '../_lib/photos';
import { cameraRequired, listingPhotoOk } from '../_lib/capture';
import { inviteByCode, inviteErr, validCode } from '../_lib/invites';
import { missingColumn } from '../_lib/listings';
import { guestSubFromReq } from '../_lib/guest';
import { validateAgreement } from '../_lib/agreement';

const CATS = ['celular', 'consola', 'laptop', 'tablet', 'camara', 'otro'];
// Link en un paso: solo título, precio y fotos. Categoría, marca, modelo, estado y declaraciones son opcionales
// (los clientes viejos los siguen mandando). Sin migración: el título se guarda en `model` y `brand` queda vacío,
// así public_orders, seller_orders e invitaciones siguen igual. Mismos límites que lib/listing.ts.
const TITLE_MIN = 3, TITLE_MAX = 80, DEFAULT_CATEGORY = 'otro';
const slug = () => { const a = 'abcdefghijklmnopqrstuvwxyz0123456789'; let s = ''; while (s.length < 6) { const b = randomBytes(1)[0]; if (b < 252) s += a[b % 36]; } return s; };
const str = (v: unknown, max: number, req = true) => {
  if (v == null || v === '') { if (req) throw new HttpError(400, 'faltan campos'); return null; }
  if (typeof v !== 'string' || v.length > max) throw new HttpError(400, 'campo inválido'); return v.trim();
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  try {
    const user = await requireCavosUser(req);
    const b = req.body ?? {};
    const seller = await requireAddressProof(b.proof, 'create', 'new');
    const bind = await bindWalletIfFresh(user, seller);
    // Otra dirección ligada a esta cuenta: no se bloquea aquí (relink explícito), pero queda el código para diagnosticar.
    if (bind === 'other_wallet') await trackApiError('create', { code: 'wallet_other_bound', status: 200 });
    const category = b.category == null || b.category === '' ? DEFAULT_CATEGORY : b.category;
    if (!CATS.includes(category)) throw new HttpError(400, 'categoría inválida');
    // Título: `title` (pantalla única) o, por compatibilidad, marca + modelo.
    const title = str(b.title, TITLE_MAX, false);
    const brand = title ? '' : (str(b.brand, 60, false) ?? '');
    const model = title ?? (str(b.model, 80, false) ?? '');
    const fullTitle = `${brand} ${model}`.trim();
    if (!fullTitle) throw new HttpError(400, 'Escribe el título de lo que vendes.');
    if (fullTitle.length < TITLE_MIN) throw new HttpError(400, `El título necesita al menos ${TITLE_MIN} letras.`);
    const price = Number(b.price_crc);
    if (!Number.isInteger(price) || price < 1000 || price > 50_000_000) throw new HttpError(400, 'precio inválido');
    // Acuerdo de entrega: cara a cara o envío y plazo de protección (24 h a 30 días), validado aquí.
    const agreement = validateAgreement({ delivery_mode: b.delivery_mode, protection_minutes: b.protection_minutes });
    if ('error' in agreement) throw Object.assign(new HttpError(400, agreement.error), { code: 'bad_agreement' });
    // Fotos obligatorias (1-4): tomadas con la cámara de la app (token 'listing'), de la invitación o, si el producto trae
    // source_url de import (link del anuncio que se importó; no se guarda), las que el servidor guardó al importar ese link.
    const importSource = typeof b.source_url === 'string' && b.source_url.length <= 1000 ? b.source_url : null;
    const photos: string[] = Array.isArray(b.photos) ? b.photos : [];
    if (photos.length < 1) throw new HttpError(400, 'agrega al menos una foto');
    if (photos.length > MAX_PHOTOS || photos.some((u) => typeof u !== 'string')) throw new HttpError(400, 'fotos inválidas');
    // Publicación en respuesta a una invitación del comprador: se lee antes de validar las fotos, porque el vendedor puede
    // reutilizar las de la invitación (p. ej. la foto del anuncio de Facebook que importó el comprador).
    let invite: any = null;
    if (b.invite != null) {
      if (!validCode(b.invite)) throw new HttpError(400, 'invitación inválida');
      invite = await inviteByCode(b.invite);
    }
    const invitePhotos: string[] = Array.isArray(invite?.photos) ? invite.photos : [];
    if (photos.some((u) => !invitePhotos.includes(u) && !u.startsWith(publicPrefix(user.sub)))) throw new HttpError(400, 'fotos inválidas');
    if (photos.some((u) => !invitePhotos.includes(u) && !listingPhotoOk(u, user.sub, importSource))) throw cameraRequired();
    // El link no se publica si la wallet del vendedor no puede recibir USDC (activar con /api/wallet/activate).
    if ((await walletState(seller)) !== 'ready') throw Object.assign(new HttpError(409, 'Tu cuenta todavía no está activada para recibir pagos. Actívala y vuelve a publicar.'), { code: 'wallet_not_ready' });
    // La invitación debe seguir abierta y el precio acordado coincidir.
    if (b.invite != null) {
      if (!invite) throw new HttpError(404, 'La invitación no existe.');
      if (invite.status !== 'abierta') throw Object.assign(new HttpError(409, 'Esta invitación ya fue aceptada o cancelada.'), { code: 'invite_not_open' });
      // El comprador invita como INVITADO (guest:<hash de su llave>), así que comparar con el sub de Cavos nunca coincidía.
      const myGuest = guestSubFromReq(req);
      if (invite.buyer_user_id === user.sub || (myGuest && invite.buyer_user_id === myGuest)) throw new HttpError(400, 'No puedes aceptar tu propia invitación.');
      if (price !== invite.price_crc) throw Object.assign(new HttpError(409, `El precio acordado en la invitación es ₡${invite.price_crc}.`), { code: 'invite_price_mismatch' });
    }
    const row = {
      seller_address: seller, seller_user_id: user.sub, seller_email: user.email ?? null,
      category, brand, model, condition: str(b.condition, 40, false) ?? '',
      price_crc: price, description: str(b.description, 2000, false), identifier: str(b.identifier, 40, false),
      photos, checks: Array.isArray(b.checks) ? b.checks.slice(0, 20) : [], status: 'creado',
    };
    // Producto permanente (se vende muchas veces, un escrow por comprador), salvo respuesta a invitación: ese link queda
    // reservado para quien invitó. Sin la migración 012 la columna no existe: link de un uso, como antes.
    let kind: 'listing' | 'single' | null = invite || b.single === true ? 'single' : 'listing';
    // Sin la migración 017 las columnas del acuerdo no existen: se crea sin ellas (rige el default: envío, 7 días).
    let agreed: Record<string, unknown> = agreement;
    for (let i = 0; i < 5; i++) {
      const s = slug();
      const ins = () => db().from('orders').insert({ ...row, ...agreed, slug: s, ...(kind ? { kind } : {}) });
      let { error } = await ins();
      if (error && missingColumn(error) && Object.keys(agreed).length) { agreed = {}; ({ error } = await ins()); }
      if (error && kind && missingColumn(error)) { kind = null; ({ error } = await ins()); }
      if (!error) {
        if (invite) { // aceptar la invitación (condicionado a que siga abierta: una sola publicación por invitación)
          const { data: ok, error: e2 } = await db().from('invitations').update({ status: 'aceptada', order_slug: s, seller_user_id: user.sub, accepted_at: new Date().toISOString() }).eq('code', invite.code).eq('status', 'abierta').select('code');
          if (e2) inviteErr(e2);
          if (!ok?.length) { await db().from('orders').update({ status: 'cancelado' }).eq('slug', s).eq('status', 'creado'); throw Object.assign(new HttpError(409, 'Esta invitación ya fue aceptada por otra publicación.'), { code: 'invite_not_open' }); }
        }
        await trackServer(`slug:${s}`, 'order_created', { category: row.category, price_crc: price, from_invite: !!invite, delivery_mode: agreement.delivery_mode, protection_minutes: agreement.protection_minutes });
        return json(res, 200, { slug: s, kind: kind ?? 'single', ...agreement });
      }
      if (error.code !== '23505') throw error;
    }
    throw new Error('no se pudo generar slug');
  } catch (e: any) { await trackApiError('create', e); return fail(res, e); }
}
