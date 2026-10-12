// POST /api/escrow/ship (Bearer JWT Cavos del vendedor)
//  { slug, evidence }            -> guarda hash de evidencia; modo backend: firma y listo. Modo seller: devuelve unsignedXdr.
//  { slug, signedXdr }           -> (modo seller) XDR firmado con wallet.signXdr de Cavos; lo enviamos y verificamos on-chain.
import { json, fail, orderBySlug, db, advance, logEvent } from '../_lib/db';
import { requireCavosUser, HttpError } from '../_lib/auth';
import { env } from '../_lib/env';
import { evidenceHash } from '../_lib/escrow';
import * as tw from '../_lib/tw';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  try {
    const user = await requireCavosUser(req);
    const { slug, evidence, signedXdr } = req.body ?? {};
    const order = await orderBySlug(slug);
    if (order.seller_user_id !== user.sub) throw new HttpError(403, 'no sos el vendedor');
    if (order.status !== 'fondeado') throw new HttpError(409, `status ${order.status}`);
    const autoRelease = () => new Date(Date.now() + env.autoReleaseHours() * 3600_000).toISOString();

    if (!signedXdr) {
      if (!evidence || JSON.stringify(evidence).length > 4000) throw new HttpError(400, 'evidencia inválida');
      const h = evidenceHash(evidence);
      await db().from('orders').update({ ship_evidence: evidence, ship_evidence_hash: h }).eq('id', order.id).eq('status', 'fondeado');
      if (order.sp_mode === 'backend') {
        const r = await tw.changeMilestoneStatus(order.contract_id, env.serviceSecret(), 'Enviado', h);
        await advance(order.id, 'fondeado', { shipped_tx: r.hash, shipped_at: new Date().toISOString(), auto_release_at: autoRelease(), status: 'enviado' });
        await logEvent(order.id, 'shipped', { hash: r.hash, evidenceHash: h, signer: 'backend' });
        return json(res, 200, { shippedTx: r.hash, evidenceHash: h });
      }
      const x = await tw.changeMilestoneStatusXdr(order.contract_id, order.seller_address, 'Enviado', h);
      return json(res, 200, { unsignedXdr: x.unsignedTransaction, evidenceHash: h });
    }

    if (order.sp_mode === 'backend') throw new HttpError(400, 'modo backend no acepta XDR del cliente');
    const r = await tw.submitSignedXdr(String(signedXdr));
    const esc = await tw.getEscrow(order.contract_id);
    if (esc?.milestones?.[0]?.evidence !== order.ship_evidence_hash) throw new HttpError(409, 'evidencia on-chain no coincide');
    await advance(order.id, 'fondeado', { shipped_tx: r.hash, shipped_at: new Date().toISOString(), auto_release_at: autoRelease(), status: 'enviado' });
    await logEvent(order.id, 'shipped', { hash: r.hash, evidenceHash: order.ship_evidence_hash, signer: 'seller_cavos' });
    return json(res, 200, { shippedTx: r.hash });
  } catch (e) { return fail(res, e); }
}
