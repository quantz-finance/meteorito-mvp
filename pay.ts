// POST /api/escrow/pay { slug, step: 'start'|'confirm_sinpe', proof }  (Bearer JWT Cavos del comprador)
// start: despliega el escrow (si no existe) y devuelve los datos del SINPE simulado (monto desde DB).
// confirm_sinpe ("Ya pagué"): ramp-provider.mock fondea el escrow. Devuelve el PIN de entrega UNA vez.
import { json, fail, orderBySlug } from '../_lib/db';
import { requireCavosUser, requireAddressProof, HttpError } from '../_lib/auth';
import { deployFor, mockRampFund } from '../_lib/escrow';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  try {
    const user = await requireCavosUser(req);
    const { slug, step, proof } = req.body ?? {};
    let order = await orderBySlug(slug);
    if (step === 'start') {
      const buyer = await requireAddressProof(proof, 'pay', order.slug);
      await deployFor(order, buyer, user.sub);
      order = await orderBySlug(slug);
      return json(res, 200, { contractId: order.contract_id, amountUsdc: Number(order.amount_usdc), priceCrc: Number(order.price_crc), sinpe: { simulated: true, reference: `MET-${order.slug.toUpperCase()}` } });
    }
    if (step === 'confirm_sinpe') {
      if (order.buyer_user_id !== user.sub) throw new HttpError(403, 'no sos el comprador de este pedido');
      const r = await mockRampFund(order.id);
      return json(res, 200, r);
    }
    throw new HttpError(400, 'step inválido');
  } catch (e) { return fail(res, e); }
}
