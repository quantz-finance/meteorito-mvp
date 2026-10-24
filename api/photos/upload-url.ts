// POST /api/photos/upload-url — subida de fotos por URL firmada (Supabase Storage). El bucket no acepta inserts anon (005).
//  1) { action:'capture_token', purpose:'ship'|'listing'|'dispute', ref, as? }  -> token de captura de UN uso (5 min).
//     ship: Bearer Cavos del VENDEDOR del pedido `ref` (fondeado, no cara a cara). listing: ref 'new' (Bearer Cavos, o
//     as:'guest' con la llave del comprador que invita). dispute: el COMPRADOR del pedido `ref` (llave de invitado o Cavos).
//     Devuelve { token, id, purpose, ref, code, exp, now } (code = texto corto que la app dibuja en la foto).
//  2) { purpose, capture_token, mime:'image/jpeg', size, as? } -> firma para listings/<carpeta>/<purpose>-<id>/0.jpg.
//     Sin token, vencido, ya usado, de otro propósito o de otra persona: rechazado. Esas carpetas solo se escriben así.
//  3) { draftId, index, mime, size } (Bearer Cavos, sin propósito) -> vía vieja SOLO para la foto de la tienda:
//     listings/<carpeta>/<draftId>/<index>.<ext>. Nunca sirve para un producto, un envío ni una disputa (las APIs lo
//     rechazan). Invitados (as:'guest') ya no tienen vía sin cámara.
// Máx 1 MB por foto (el cliente comprime a <300 KB). Lectura pública sigue igual.
import { db, json, fail, orderBySlug } from '../_lib/db';
import { requireCavosUser, HttpError } from '../_lib/auth';
import { guestSubFromReq, requireBuyerIdentity, isBuyerOf } from '../_lib/guest';
import { MAX_PHOTOS, MAX_PHOTO_BYTES, PHOTO_MIME, publicPrefix, userDir } from '../_lib/photos';
import { captureCode, capturePath, captureUploaded, captureUrl, checkCaptureToken, isCapturePurpose, markSigned, signCaptureToken, validCaptureRef, type CapturePurpose } from '../_lib/capture';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const guestErr = () => Object.assign(new HttpError(401, 'Falta la llave de invitado. Vuelve a abrir la página.'), { code: 'guest_key_missing' });

/** Quién toma la foto para cada propósito: la carpeta (sub) del token y las identidades aceptadas al firmar. */
async function captureOwner(req: any, purpose: CapturePurpose): Promise<{ sub: string; subs: string[] }> {
  if (purpose === 'dispute') { const who = await requireBuyerIdentity(req); return { sub: who.cavos?.sub ?? who.guest!, subs: who.ids }; }
  if (purpose === 'listing' && req.body?.as === 'guest') { const g = guestSubFromReq(req); if (!g) throw guestErr(); return { sub: g, subs: [g] }; }
  const u = await requireCavosUser(req); return { sub: u.sub, subs: [u.sub] };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  try {
    const b = req.body ?? {};
    res.setHeader?.('Cache-Control', 'no-store');

    if (b.action === 'capture_token') {
      const purpose = b.purpose;
      if (!isCapturePurpose(purpose)) throw Object.assign(new HttpError(400, 'propósito inválido'), { code: 'capture_bad_purpose' });
      const ref = purpose === 'listing' ? 'new' : b.ref;
      if (!validCaptureRef(purpose, ref)) throw Object.assign(new HttpError(400, 'pedido inválido'), { code: 'capture_bad_ref' });
      const owner = await captureOwner(req, purpose);
      if (purpose === 'ship') {
        const o = await orderBySlug(ref);
        if (o.seller_user_id !== owner.sub) throw new HttpError(403, 'no eres el vendedor');
        if (o.delivery_mode === 'cara_a_cara') throw Object.assign(new HttpError(409, 'La entrega es cara a cara: no hay envío.'), { code: 'face_to_face' });
        if (o.status !== 'fondeado') throw new HttpError(409, `status ${o.status}`);
      }
      if (purpose === 'dispute') {
        const who = await requireBuyerIdentity(req); const o = await orderBySlug(ref);
        if (!isBuyerOf(o, who)) throw new HttpError(403, 'no eres el comprador de este pedido');
      }
      const now = Date.now();
      const { token, claims } = signCaptureToken({ p: purpose, ref, sub: owner.sub }, now);
      return json(res, 200, { token, id: claims.id, purpose, ref, code: captureCode(claims), exp: new Date(claims.exp).toISOString(), now: new Date(now).toISOString() });
    }

    const { mime, size } = b;
    if (b.purpose != null || b.capture_token != null) {
      if (!isCapturePurpose(b.purpose)) throw Object.assign(new HttpError(400, 'propósito inválido'), { code: 'capture_bad_purpose' });
      const owner = await captureOwner(req, b.purpose);
      const c = checkCaptureToken(b.capture_token, { purpose: b.purpose, subs: [owner.sub] });
      if (mime !== 'image/jpeg') throw new HttpError(415, 'solo JPEG de la cámara');
      if (!Number.isFinite(size) || size <= 0 || size > MAX_PHOTO_BYTES) throw new HttpError(413, 'foto demasiado grande (máx 1 MB)');
      const used = () => Object.assign(new HttpError(409, 'Esa foto ya se usó. Toma otra con la cámara.'), { code: 'capture_token_used' });
      if (!markSigned(c.id)) throw used();
      if (await captureUploaded(db().storage, c)) throw used();
      const path = capturePath(c);
      const { data, error } = await db().storage.from('listings').createSignedUploadUrl(path);
      if (error) throw Object.assign(new HttpError(409, `no se pudo preparar la subida: ${error.message}`), { code: 'capture_token_used' });
      return json(res, 200, { path, token: data.token, signedUrl: data.signedUrl, publicUrl: captureUrl(c), capture: { token_id: c.id, purpose: c.p } });
    }

    // Vía vieja: solo la foto de la tienda (cuenta Cavos). Un invitado ya no sube fotos sin la cámara.
    if (b.as === 'guest') throw Object.assign(new HttpError(403, 'Toma la foto con la cámara de Meteorito.'), { code: 'camera_required' });
    const user = await requireCavosUser(req);
    const { draftId, index } = b;
    if (typeof draftId !== 'string' || !UUID_RE.test(draftId)) throw new HttpError(400, 'draftId inválido');
    if (!Number.isInteger(index) || index < 0 || index >= MAX_PHOTOS) throw new HttpError(400, `máximo ${MAX_PHOTOS} fotos`);
    const ext = PHOTO_MIME[mime as string];
    if (!ext) throw new HttpError(415, 'solo imágenes JPEG, PNG o WebP');
    if (!Number.isFinite(size) || size <= 0 || size > MAX_PHOTO_BYTES) throw new HttpError(413, 'foto demasiado grande (máx 1 MB)');
    const path = `${userDir(user.sub)}/${draftId.toLowerCase()}/${index}.${ext}`;
    const { data, error } = await db().storage.from('listings').createSignedUploadUrl(path);
    if (error) throw new HttpError(409, `no se pudo preparar la subida: ${error.message}`);
    return json(res, 200, { path, token: data.token, signedUrl: data.signedUrl, publicUrl: publicPrefix(user.sub) + `${draftId.toLowerCase()}/${index}.${ext}` });
  } catch (e) { return fail(res, e); }
}
