// POST /api/escrow/dispute (Bearer JWT Cavos del COMPRADOR)
//  { slug, reason: 'no_llego'|'no_funciona'|'no_es_lo_descrito'|'otro', description?, evidence?: string[], captures?: string[] }
//  evidence: fotos tomadas con la cámara de la app (una por token de captura 'dispute' de este pedido, en `captures`, mismo orden).
// Solo el comprador y solo antes de liberar. Idempotente. Bloquea liberación (DB + on-chain).
import { json, fail, orderBySlug } from '../_lib/db';
import { HttpError } from '../_lib/auth';
import { requireBuyerIdentity } from '../_lib/guest';
import { DISPUTE_REASONS, openDispute, type DisputeReason } from '../_lib/escrow';
import { MAX_PHOTOS } from '../_lib/photos';
import { cameraRequired, captureUrl, checkCaptureToken } from '../_lib/capture';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  try {
    const who = await requireBuyerIdentity(req);
    const { slug, reason, description, evidence } = req.body ?? {};
    if (!DISPUTE_REASONS.includes(reason)) throw new HttpError(400, 'motivo inválido');
    if (description != null && (typeof description !== 'string' || description.length > 2000)) throw new HttpError(400, 'descripción inválida');
    const sub = who.cavos?.sub ?? who.guest!;
    const ev = Array.isArray(evidence) ? evidence : [];
    const caps = Array.isArray(req.body?.captures) ? req.body.captures : [];
    if (ev.length > MAX_PHOTOS || ev.some((u) => typeof u !== 'string')) throw new HttpError(400, 'evidencia inválida');
    // Solo fotos de la cámara de la app: cada una con su token de captura 'dispute' de ESTE pedido y en la carpeta del token.
    ev.forEach((u: string, i: number) => {
      let c;
      try { c = checkCaptureToken(caps[i], { purpose: 'dispute', subs: who.ids, ref: slug, allowExpired: true }); }
      catch (e: any) { throw Object.assign(new HttpError(400, e.message), { code: e.code === 'capture_token_required' ? 'camera_required' : e.code }); }
      if (u !== captureUrl(c)) throw cameraRequired();
    });
    if (reason === 'otro' && !description?.trim()) throw new HttpError(400, 'cuéntanos qué pasó');
    const order = await orderBySlug(slug);
    const buyerSub = who.ids.find((i) => i === order.buyer_user_id) ?? sub;
    const r = await openDispute(order, buyerSub, { reason: reason as DisputeReason, description: description?.trim() || null, evidence: ev });
    return json(res, 200, r);
  } catch (e) { return fail(res, e); }
}
