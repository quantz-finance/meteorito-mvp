// POST /api/escrow/ship (Bearer JWT Cavos del vendedor) — "Ya lo envié"
//  { slug, evidence? }  evidence opcional: { photo?, note? } (foto del paquete o del comprobante de Correos, número de guía).
//  El servidor arma la evidencia {at, photo?, note?} (siempre hay algo que hashear), guarda el hash y lo pone en el milestone 'Enviado'.
//  Modo backend: firma y listo. Modo seller: devuelve unsignedXdr; el cliente firma con wallet.signXdr y lo manda a
//  /api/tx/submit (action 'ship'), que hace fee-bump. La liberación automática vence 7 días después (env.autoReleaseMinutes).
import { json, fail, orderBySlug, db, advance, logEvent } from '../_lib/db';
import { requireCavosUser, HttpError } from '../_lib/auth';
import { env, autoReleaseAt } from '../_lib/env';
import { chain, evidenceHash, shipEvidence } from '../_lib/escrow';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  try {
    const user = await requireCavosUser(req);
    const { slug } = req.body ?? {};
    const order = await orderBySlug(slug);
    if (order.seller_user_id !== user.sub) throw new HttpError(403, 'no eres el vendedor');
    if (order.status !== 'fondeado') throw new HttpError(409, `status ${order.status}`);
    const evidence = shipEvidence(req.body?.evidence, user.sub);
    const h = evidenceHash(evidence);
    await db().from('orders').update({ ship_evidence: evidence, ship_evidence_hash: h }).eq('id', order.id).eq('status', 'fondeado');
    if (order.sp_mode === 'backend') {
      const r = await chain().changeMilestoneStatus(order.contract_id, env.serviceSecret(), 'Enviado', h);
      await advance(order.id, 'fondeado', { shipped_tx: r.hash, shipped_at: new Date().toISOString(), auto_release_at: autoReleaseAt(), status: 'enviado' });
      await logEvent(order.id, 'shipped', { hash: r.hash, evidenceHash: h, signer: 'backend', photo: !!evidence.photo });
      return json(res, 200, { shippedTx: r.hash, evidenceHash: h });
    }
    const x = await chain().changeMilestoneStatusXdr(order.contract_id, order.seller_address, 'Enviado', h);
    return json(res, 200, { unsignedXdr: x.unsignedTransaction, evidenceHash: h });
  } catch (e) { return fail(res, e); }
}
