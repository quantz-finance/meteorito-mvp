// POST /api/escrow/ship (Bearer JWT Cavos del vendedor) — "Ya lo envié"
//  { slug, evidence: { photo, capture_token, captured_at, note? } }  La foto (paquete o comprobante de Correos) es OBLIGATORIA
//  y solo de la cámara de la app: token de captura 'ship' de este pedido, foto ya subida a la carpeta del token.
//  El servidor arma la evidencia {at, photo, captured_at, token_id, purpose, note?}, guarda el hash y lo pone en el milestone 'Enviado'.
//  Modo backend: firma y listo. Modo seller: devuelve unsignedXdr; el cliente firma con wallet.signXdr y lo manda a
//  /api/tx/submit (action 'ship'), que hace fee-bump. La liberación automática vence con el plazo acordado (default 7 días) desde ese momento.
import { json, fail, orderBySlug, db, advance, logEvent } from '../_lib/db';
import { HttpError } from '../_lib/auth';
import { sellerSubFor } from '../_lib/sellerGuest';
import { env, releaseDueAt } from '../_lib/env';
import { isFaceToFace } from '../_lib/agreement';
import { chain, evidenceHash, shipEvidence } from '../_lib/escrow';
import { captureUploaded } from '../_lib/capture';
import { scrubStoredPhotos } from '../_lib/scrubPhotos';
import { S, validate } from '../_lib/validate';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  try {
    validate(req, S.escrowShip); // zod: forma y tamaños de body/query (api/_lib/validate.ts) -> 400 genérico
    const { slug } = req.body ?? {};
    const order = await orderBySlug(slug);
    // Cuenta Cavos del vendedor o, en pedidos de vendedor sin cuenta (038), su sesión HttpOnly de ESTE pedido.
    const user = { sub: await sellerSubFor(req, order) };
    if (order.seller_user_id !== user.sub) throw new HttpError(403, 'no eres el vendedor');
    if (order.status !== 'fondeado') throw new HttpError(409, `status ${order.status}`);
    // Cancelación sin envío en curso (api/_lib/shipRefund.ts toma el lock de la fila): no se mezcla con "Ya lo envié".
    if (Date.parse(order.release_lock_until ?? '') > Date.now()) throw Object.assign(new HttpError(409, 'Estamos actualizando este pedido. Intenta de nuevo en un minuto.'), { code: 'order_locked' });
    if (isFaceToFace(order)) throw Object.assign(new HttpError(409, 'La entrega es cara a cara: no hay envío. Pide el código al comprador.'), { code: 'face_to_face' });
    const evidence = shipEvidence(req.body?.evidence, user.sub, order.slug);
    if (!(await captureUploaded(db().storage, { p: 'ship', id: evidence.token_id, sub: user.sub })))
      throw Object.assign(new HttpError(400, 'La foto del envío no terminó de subir. Tómala de nuevo.'), { code: 'ship_photo_missing' });
    await scrubStoredPhotos(db().storage, [evidence.photo]); // sin EXIF/GPS (subida firmada: el servidor no vio los bytes)
    const h = evidenceHash(evidence);
    await db().from('orders').update({ ship_evidence: evidence, ship_evidence_hash: h }).eq('id', order.id).eq('status', 'fondeado');
    if (order.sp_mode === 'backend') {
      const r = await chain().changeMilestoneStatus(order.contract_id, env.serviceSecret(), 'Enviado', h);
      const at = new Date().toISOString(); // plazo acordado desde "Ya lo envié"
      await advance(order.id, 'fondeado', { shipped_tx: r.hash, shipped_at: at, auto_release_at: releaseDueAt({ ...order, shipped_at: at, auto_release_at: null }), status: 'enviado' });
      await logEvent(order.id, 'shipped', { hash: r.hash, evidenceHash: h, signer: 'backend', photo: !!evidence.photo });
      return json(res, 200, { shippedTx: r.hash, evidenceHash: h });
    }
    const x = await chain().changeMilestoneStatusXdr(order.contract_id, order.seller_address, 'Enviado', h);
    return json(res, 200, { unsignedXdr: x.unsignedTransaction, evidenceHash: h });
  } catch (e) { return fail(res, e); }
}
