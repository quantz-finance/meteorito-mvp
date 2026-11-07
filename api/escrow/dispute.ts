// POST /api/escrow/dispute (Bearer JWT Cavos del COMPRADOR o su llave de invitado)
//  { slug, reason: 'no_llego'|'no_funciona'|'no_es_lo_descrito'|'otro', description?, evidence?: string[], captures?: string[] }
//  evidence: fotos tomadas con la cámara de la app (una por token de captura 'dispute' de este pedido, en `captures`, mismo orden).
// Solo el comprador y solo antes de liberar. Idempotente. Bloquea liberación (DB + on-chain).
// Regla v2 (rules_version >= 2, api/_lib/replyRule.ts): description = versión de quien compra (obligatoria, ≥ 10) y al
// menos una foto salvo 'no_llego'; se avisa a quien vende y corren sus 48 h (respuesta: reply_due_at).
//
// Panel de disputas (misma función: el proyecto tiene un tope de 12 funciones de Vercel). Con `action`:
//  Admin (Bearer Cavos de un correo de ADMIN_EMAILS; si no, 404; sin sesión, 401). Ver api/_lib/admin.ts:
//   { action:'admin_me' }                          -> { admin:true, email }
//   { action:'admin_list' }                        -> { disputes, counts, flags, capabilities }
//   { action:'admin_get', slug }                   -> detalle: línea de tiempo, envío, evidencia, mensajes entre las partes, respuesta, on-chain, IA, auditoría
//   { action:'admin_ai', slug, refresh? }          -> resumen + recomendación con IA (caché por disputa; sin credencial: available:false)
//   { action:'admin_decide', slug, outcome:'refund'|'release'|'split', buyer_pct?, note, confirm:true }
//                                                  -> auditoría + resolución on-chain (si el servidor tiene DISPUTE_RESOLVER_SECRET;
//                                                     si no, queda 'pending_onchain' con el comando del script)
//   { action:'admin_guest_refund', slug, note? }   -> marca como hecha la devolución por fuera al comprador invitado
//   { action:'admin_socials_clear', store_slug } -> borra las redes de esa tienda (031) + auditoría sin los links
//   { action:'admin_payouts' } / { action:'admin_payout_reviewed', slug, note } (alias viejo: admin_payout_paid) -> cola de pagos a Cuenta IBAN (029; sin ella available:false)
//  Vendedor del pedido (Bearer Cavos):
//   { action:'seller_response_get', slug }         -> { available, open, response, deadline, can_respond }
//   { action:'seller_respond', slug, body?, tracking?, photo?, capture? } -> su versión: foto de la cámara (token 'dispute'
//                                                  propio), guía de envío o texto (al menos uno). v2: solo dentro de las 48 h.
// Regla v3 "Período de reclamo de 30 días" (api/_lib/claims.ts, migración 035; sin ella available:false). No congela fondos:
//  Comprador (X-Guest-Key o Bearer): { action:'claim_get', slug } -> { available, applies, window:{phase,until}, claim }
//                                    { action:'claim_open', slug, reason, description } -> reporte (una vez, dentro de 30 días)
//  Vendedor del pedido (Bearer):     { action:'claim_seller_get', slug } -> { available, claim, can_respond }
//                                    { action:'claim_respond', slug, body } -> su respuesta (antes de 48 h: cuenta respondido)
//  Admin:                            { action:'admin_claims' } / { action:'admin_claim_resolve', slug, note }
import { db, json, fail, orderBySlug } from '../_lib/db';
import { scrubStoredPhotos } from '../_lib/scrubPhotos';
import { HttpError, requireCavosUser } from '../_lib/auth';
import { requireBuyerIdentity } from '../_lib/guest';
import { DISPUTE_REASONS, openDispute, type DisputeReason } from '../_lib/escrow';
import { MAX_PHOTOS } from '../_lib/photos';
import { cameraRequired, captureUrl, checkCaptureToken } from '../_lib/capture';
import { requireAdmin } from '../_lib/admin';
import { adminAi, adminDetail, adminList, sellerRespond, sellerResponseGet } from '../_lib/disputeAdmin';
import { decideDispute, markGuestRefunded, validateDecision } from '../_lib/disputeResolve';
import { adminPayouts, markPayoutPaid } from '../_lib/payoutChoice';
import { startReplyWindow, validateBuyerVersion } from '../_lib/replyRule';
import { replyRuleApplies } from '../_lib/orderRules';
import { adminClearSocials } from '../_lib/socialsAdmin';
import { adminClaims, claimForBuyer, claimForSeller, openClaim, resolveClaim, respondClaim } from '../_lib/claims';
import { S, validate } from '../_lib/validate';
import { sellerSubFor } from '../_lib/sellerGuest';

async function action(req: any, res: any, a: string) {
  res.setHeader?.('Cache-Control', 'no-store');
  const b = req.body ?? {};
  if (a === 'seller_response_get' || a === 'seller_respond') {
    const order = await orderBySlug(b.slug);
    const sub = await sellerSubFor(req, order); // Cavos o sesión del vendedor sin cuenta (038)
    return json(res, 200, a === 'seller_respond' ? await sellerRespond(order, sub, b) : await sellerResponseGet(order, sub));
  }
  if (a === 'claim_get' || a === 'claim_open') {
    const who = await requireBuyerIdentity(req);
    const order = await orderBySlug(b.slug);
    return json(res, 200, a === 'claim_open' ? await openClaim(order, who, b) : await claimForBuyer(order, who));
  }
  if (a === 'claim_seller_get' || a === 'claim_respond') {
    const order = await orderBySlug(b.slug);
    const sub = await sellerSubFor(req, order);
    return json(res, 200, a === 'claim_respond' ? await respondClaim(order, sub, b) : await claimForSeller(order, sub));
  }
  if (!a.startsWith('admin_')) throw new HttpError(400, 'acción inválida');
  const admin = await requireAdmin(req);
  if (a === 'admin_me') return json(res, 200, { admin: true, email: admin.email });
  if (a === 'admin_list') return json(res, 200, await adminList(req));
  if (a === 'admin_get') return json(res, 200, await adminDetail(b.slug, req));
  if (a === 'admin_ai') return json(res, 200, await adminAi(b.slug, req, b.refresh === true));
  if (a === 'admin_decide') {
    const input = validateDecision(b);
    const order = await orderBySlug(b.slug);
    return json(res, 200, await decideDispute(order, { sub: admin.sub, email: admin.email, source: 'admin' }, input));
  }
  if (a === 'admin_claims') return json(res, 200, await adminClaims());
  if (a === 'admin_claim_resolve') return json(res, 200, await resolveClaim(await orderBySlug(b.slug), admin, b.note));
  if (a === 'admin_guest_refund') return json(res, 200, await markGuestRefunded(await orderBySlug(b.slug), admin, b.note));
  // Cola manual de pagos a Cuenta IBAN (029): el escrow liberó a 'platform'; el equipo transfiere y la marca como pagada.
  if (a === 'admin_payouts') return json(res, 200, await adminPayouts());
  if (a === 'admin_socials_clear') return json(res, 200, await adminClearSocials(b.store_slug, admin)); // redes reportadas (031)
  if (a === 'admin_payout_reviewed' || a === 'admin_payout_paid') return json(res, 200, await markPayoutPaid(b.slug, admin, b.note));
  throw new HttpError(400, 'acción inválida');
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  try {
    validate(req, S.escrowDispute); // zod: forma y tamaños de body/query (api/_lib/validate.ts) -> 400 genérico
    if (typeof req.body?.action === 'string') return await action(req, res, req.body.action);
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
    await scrubStoredPhotos(db().storage, ev); // sin EXIF/GPS (subida firmada: el servidor no vio los bytes)
    const buyerSub = who.ids.find((i) => i === order.buyer_user_id) ?? sub;
    // Regla v2 (pedidos con rules_version >= 2): versión de quien compra obligatoria + aviso a quien vende con 48 h.
    validateBuyerVersion(order, { reason, description, evidence: ev });
    const v2 = replyRuleApplies(order);
    const r = await openDispute(order, buyerSub, { reason: reason as DisputeReason, description: description?.trim() || null, evidence: ev }, { notify: !v2 });
    const win = v2 && !r.already ? await startReplyWindow(order) : null;
    return json(res, 200, { ...r, ...(win ? { reply_due_at: win.dueAt } : {}) });
  } catch (e) { return fail(res, e); }
}
