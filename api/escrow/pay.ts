// POST /api/escrow/pay { slug, step: 'start'|'confirm_sinpe', proof }  (Bearer JWT Cavos del comprador)
// start: despliega el escrow (si no existe) y devuelve los datos del SINPE simulado (monto desde DB).
// confirm_sinpe ("Ya pagué"): ramp-provider.mock fondea el escrow. Devuelve el PIN de entrega UNA vez.
import { json, fail, orderBySlug } from '../_lib/db';
import { requireCavosUser, requireAddressProof, HttpError, bindWalletIfFresh } from '../_lib/auth';
import { deployFor, mockRampFund } from '../_lib/escrow';
import { walletState } from '../_lib/wallet';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  try {
    const user = await requireCavosUser(req);
    const { slug, step, proof } = req.body ?? {};
    let order = await orderBySlug(slug);
    if (step === 'start') {
      // Pedido ya tomado: solo su comprador puede re-consultarlo (no exponer datos de pago a otro sub).
      if (order.contract_id && order.buyer_user_id !== user.sub) throw new HttpError(403, 'este pedido ya tiene comprador');
      const buyer = await requireAddressProof(proof, 'pay', order.slug);
      await bindWalletIfFresh(user, buyer);
      if (order.seller_user_id === user.sub || order.seller_address === buyer)
        throw Object.assign(new HttpError(409, 'No puedes comprar tu propio artículo.'), { code: 'self_purchase' });
      // Fondeo testnet: lo hace el ramp simulado desde la treasury (confirm_sinpe); el comprador NO necesita saldo.
      // Su wallet sí debe poder recibir USDC (reembolso si hay disputa): misma activación patrocinada que el vendedor.
      if (!order.contract_id && (await walletState(buyer)) !== 'ready')
        throw Object.assign(new HttpError(409, 'Antes de pagar necesitamos activar tu cuenta. Vuelve a intentar.'), { code: 'buyer_wallet_not_ready' });
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
