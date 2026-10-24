// POST /api/tx/submit { slug, action, signedXdr }  (Bearer JWT Cavos)
// XDR de Trustless Work firmado por el usuario con Cavos signXdr. Validamos que sea UNA llamada a NUESTRO contrato,
// con la función permitida para esa acción y source = la dirección del rol; la wallet platform lo envuelve en fee-bump.
// El usuario nunca necesita XLM. (signXdr de @cavos/kit no expone relayer: firma y no envía.)
import { json, fail, orderBySlug, advance, logEvent } from '../_lib/db';
import { requireCavosUser, HttpError } from '../_lib/auth';
import { env, releaseDueAt } from '../_lib/env';
import { validateEscrowTx, feeBumpAndSend } from '../_lib/feebump';

const ACTIONS: Record<string, { fn: string; role: 'seller' | 'buyer'; from: string }> = {
  ship: { fn: 'change_milestone_status', role: 'seller', from: 'fondeado' },
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method' });
  try {
    const user = await requireCavosUser(req);
    const { slug, action, signedXdr } = req.body ?? {};
    const a = ACTIONS[action];
    if (!a) throw new HttpError(400, 'acción no permitida');
    if (typeof signedXdr !== 'string' || signedXdr.length > 20000) throw new HttpError(400, 'XDR inválido');
    const order = await orderBySlug(slug);
    if (!order.contract_id) throw new HttpError(409, 'pedido sin escrow');
    if (order.status !== a.from) throw new HttpError(409, `status ${order.status}`);
    const ownerId = a.role === 'seller' ? order.seller_user_id : order.buyer_user_id;
    const source = a.role === 'seller' ? order.seller_address : order.buyer_address;
    if (ownerId !== user.sub) throw new HttpError(403, 'no te corresponde esta acción');
    if (action === 'ship' && order.sp_mode !== 'seller') throw new HttpError(400, 'modo backend: el envío lo firma el servidor');

    const inner = validateEscrowTx(signedXdr, { contractId: order.contract_id, fns: [a.fn], source });
    if (action === 'ship') {
      // La evidencia firmada debe ser exactamente el hash que guardamos.
      if (!order.ship_evidence_hash || !Buffer.from(signedXdr, 'base64').includes(Buffer.from(order.ship_evidence_hash)))
        throw new HttpError(400, 'la evidencia del XDR no coincide con la guardada');
    }
    const sent = await feeBumpAndSend(inner);
    if (action === 'ship') {
      const at = new Date().toISOString(); // plazo acordado del pedido desde "Ya lo envié"
      await advance(order.id, 'fondeado', { shipped_tx: sent.hash, shipped_at: at, auto_release_at: releaseDueAt({ ...order, shipped_at: at, auto_release_at: null }), status: 'enviado' });
    }
    await logEvent(order.id, `tx_${action}`, { hash: sent.hash, innerHash: sent.innerHash, feeBump: true });
    return json(res, 200, { hash: sent.hash });
  } catch (e) { return fail(res, e); }
}
