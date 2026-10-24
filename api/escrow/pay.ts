// POST /api/escrow/pay { slug, step: 'start'|'confirm_sinpe'|'shipment'|'card_pay'|'card_session'|'card_confirm', proof }  (Bearer JWT Cavos o llave de invitado)
// start: despliega el escrow (si no existe) y devuelve los datos del SINPE simulado (monto desde DB).
// confirm_sinpe ("Ya pagué"): ramp-provider.mock fondea el escrow. Devuelve el PIN de entrega UNA vez.
// card_pay (formulario propio, Lendara headless) / card_session (widget, respaldo) / card_confirm: pago con tarjeta vía Lendara (api/_lib/lendara.ts, docs/lendara-card.md). Verificado en
// Lendara + Horizon antes de fondear por el mismo camino que confirm_sinpe.
import { json, fail, orderBySlug } from '../_lib/db';
import { requireAddressProof, HttpError, bindWalletIfFresh } from '../_lib/auth';
import { deployFor, mockRampFund, fundDirectXdr, fundDirect } from '../_lib/escrow';
import { walletState } from '../_lib/wallet';
import { requireBuyerIdentity, isBuyerOf, isGuestSub } from '../_lib/guest';
import { env } from '../_lib/env';
import { inviteForOrder } from '../_lib/invites';
import { db } from '../_lib/db';
import { orderForBuyer } from '../_lib/listings';
import { cardConfirm, cardEnabled, cardMode, cardPay, cardSession } from '../_lib/lendara';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  try {
    const who = await requireBuyerIdentity(req);
    const { slug, step, proof } = req.body ?? {};
    let order = await orderBySlug(slug);
    if (step === 'start' && who.guest) {
      // Link creado a partir de una invitación: queda reservado para quien invitó (su llave de invitado).
      const reserved = await inviteForOrder(order.slug);
      if (reserved && reserved.buyer_user_id !== who.guest) throw Object.assign(new HttpError(403, 'Este link de pago está reservado para quien inició la compra. Abre el link desde el mismo navegador donde creaste la invitación.'), { code: 'invite_reserved' });
      if (who.cavos && who.cavos.sub === order.seller_user_id) throw Object.assign(new HttpError(409, 'No puedes comprar tu propio artículo.'), { code: 'self_purchase' });
      order = await orderForBuyer(db(), order, who.guest); // producto permanente: pedido propio de este comprador
      // Compra como INVITADO: sin cuenta ni wallet. El escrow queda con la wallet platform como buyer_address (docs/guest-checkout.md).
      if (order.contract_id && order.buyer_user_id !== who.guest) throw new HttpError(403, 'este pedido ya tiene comprador');
      if (who.cavos && who.cavos.sub === order.seller_user_id) throw Object.assign(new HttpError(409, 'No puedes comprar tu propio artículo.'), { code: 'self_purchase' });
      await deployFor(order, env.platformPublic(), who.guest);
      order = await orderBySlug(order.slug);
      return json(res, 200, { slug: order.slug, contractId: order.contract_id, amountUsdc: Number(order.amount_usdc), priceCrc: Number(order.price_crc), sinpe: { simulated: true, reference: `MET-${order.slug.toUpperCase()}` }, card: cardEnabled(), cardMode: cardMode(), guest: true });
    }
    if (step === 'start') {
      const user = who.cavos; if (!user) throw new HttpError(401, 'Inicia sesión para continuar.');
      const reservedFor = await inviteForOrder(order.slug);
      if (reservedFor && reservedFor.buyer_user_id !== user.sub) throw Object.assign(new HttpError(403, 'Este link de pago está reservado para quien inició la compra.'), { code: 'invite_reserved' });
      // Pedido ya tomado: solo su comprador puede re-consultarlo (no exponer datos de pago a otro sub).
      if (order.contract_id && order.buyer_user_id !== user.sub) throw new HttpError(403, 'este pedido ya tiene comprador');
      const buyer = await requireAddressProof(proof, 'pay', order.slug);
      await bindWalletIfFresh(user, buyer);
      if (order.seller_user_id === user.sub || order.seller_address === buyer)
        throw Object.assign(new HttpError(409, 'No puedes comprar tu propio artículo.'), { code: 'self_purchase' });
      order = await orderForBuyer(db(), order, user.sub); // producto permanente: pedido propio (la prueba firmó el slug pedido)
      // Fondeo testnet: lo hace el ramp simulado desde la treasury (confirm_sinpe); el comprador NO necesita saldo.
      // Su wallet sí debe poder recibir USDC (reembolso si hay disputa): misma activación patrocinada que el vendedor.
      if (!order.contract_id && (await walletState(buyer)) !== 'ready')
        throw Object.assign(new HttpError(409, 'Antes de pagar necesitamos activar tu cuenta. Vuelve a intentar.'), { code: 'buyer_wallet_not_ready' });
      await deployFor(order, buyer, user.sub);
      order = await orderBySlug(order.slug);
      return json(res, 200, { slug: order.slug, contractId: order.contract_id, amountUsdc: Number(order.amount_usdc), priceCrc: Number(order.price_crc), sinpe: { simulated: true, reference: `MET-${order.slug.toUpperCase()}` }, card: cardEnabled(), cardMode: cardMode() });
    }
    if (step === 'confirm_sinpe') {
      if (!isBuyerOf(order, who)) throw new HttpError(403, 'no eres el comprador de este pedido');
      const r = await mockRampFund(order.id);
      return json(res, 200, r);
    }
    if (step === 'card_pay' || step === 'card_session' || step === 'card_confirm') {
      if (!isBuyerOf(order, who)) throw new HttpError(403, 'no eres el comprador de este pedido');
      // card_pay: formulario propio (default). card_session: widget de Lendara (respaldo, LENDARA_MODE=widget).
      if (step === 'card_pay') return json(res, 200, await cardPay(order, req.body));
      return json(res, 200, step === 'card_session' ? await cardSession(order) : await cardConfirm(order));
    }
    // Pago directo en USDC desde una wallet Stellar (sin SINPE): el comprador firma fund-escrow; platform paga el fee.
    if (step === 'fund_xdr' || step === 'fund_direct') {
      if (!isBuyerOf(order, who)) throw new HttpError(403, 'no eres el comprador de este pedido');
      if (isGuestSub(order.buyer_user_id)) throw new HttpError(400, 'El pago directo con USDC requiere cuenta propia; como invitado usa el pago simulado.');
      if (step === 'fund_xdr') return json(res, 200, await fundDirectXdr(order));
      const { signedXdr } = req.body ?? {};
      if (typeof signedXdr !== 'string' || signedXdr.length > 20000) throw new HttpError(400, 'XDR inválido');
      return json(res, 200, await fundDirect(order.id, signedXdr));
    }
    // shipment: el comprador ve la foto del envío y el número de guía (solo él: puede traer datos personales; no va a public_orders).
    if (step === 'shipment') {
      if (!isBuyerOf(order, who)) throw new HttpError(403, 'no eres el comprador de este pedido');
      const ev = order.shipped_at || ['enviado', 'entregado', 'liberado', 'en_disputa', 'resuelto'].includes(order.status) ? order.ship_evidence ?? {} : null;
      return json(res, 200, ev ? { shipped: true, at: ev.at ?? order.shipped_at ?? null, photo: ev.photo ?? null, note: ev.note ?? null } : { shipped: false });
    }
    throw new HttpError(400, 'step inválido');
  } catch (e) { return fail(res, e); }
}
