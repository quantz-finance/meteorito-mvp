// POST /api/escrow/dispute (Bearer JWT Cavos del COMPRADOR)
//  { slug, reason: 'no_llego'|'no_funciona'|'no_es_lo_descrito'|'otro', description?, evidence?: string[] (URLs de fotos subidas por /api/photos/upload-url) }
// Solo el comprador y solo antes de liberar. Idempotente. Bloquea liberación (DB + on-chain).
import { json, fail, orderBySlug } from '../_lib/db';
import { requireCavosUser, HttpError } from '../_lib/auth';
import { DISPUTE_REASONS, openDispute, type DisputeReason } from '../_lib/escrow';
import { MAX_PHOTOS, publicPrefix } from '../_lib/photos';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  try {
    const user = await requireCavosUser(req);
    const { slug, reason, description, evidence } = req.body ?? {};
    if (!DISPUTE_REASONS.includes(reason)) throw new HttpError(400, 'motivo inválido');
    if (description != null && (typeof description !== 'string' || description.length > 2000)) throw new HttpError(400, 'descripción inválida');
    const prefix = publicPrefix(user.sub);
    const ev = Array.isArray(evidence) ? evidence : [];
    if (ev.length > MAX_PHOTOS || ev.some((u) => typeof u !== 'string' || !u.startsWith(prefix))) throw new HttpError(400, 'evidencia inválida');
    if (reason === 'otro' && !description?.trim()) throw new HttpError(400, 'contanos qué pasó');
    const order = await orderBySlug(slug);
    const r = await openDispute(order, user.sub, { reason: reason as DisputeReason, description: description?.trim() || null, evidence: ev });
    return json(res, 200, r);
  } catch (e) { return fail(res, e); }
}
