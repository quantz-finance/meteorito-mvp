// (26) Comprador invitado: identidad por llave (sin login), ownership por pedido y sin escrituras de terceros. Sin red.
import type { T } from './setup';
import { installTestJwks, req, res, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { fakeDb } from './fakedb';
import { guestSubFromReq } from '../../api/_lib/guest';
import pay from '../../api/escrow/pay';
import confirm from '../../api/escrow/confirm';
import dispute from '../../api/escrow/dispute';

const KEY_A = 'a'.repeat(64), KEY_B = 'b'.repeat(64);
const withGuest = (r: any, key: string | null, tok?: string) => { r.headers = { ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(key ? { 'x-guest-key': key } : {}) }; return r; };

export async function run(t: T) {
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  const subA = guestSubFromReq({ headers: { 'x-guest-key': KEY_A } });
  t.check('identidad invitado = guest:<hash> (la llave nunca se guarda)', !!subA && /^guest:[a-f0-9]{40}$/.test(subA) && !subA.includes(KEY_A));
  t.check('llave inválida / ausente -> sin identidad', guestSubFromReq({ headers: { 'x-guest-key': 'zz' } }) === null && guestSubFromReq({ headers: {} }) === null);
  t.check('llaves distintas -> identidades distintas', subA !== guestSubFromReq({ headers: { 'x-guest-key': KEY_B } }));

  const order = { id: '55555555-5555-4555-8555-555555555555', slug: 'gst001', contract_id: 'CNOTUSED', seller_user_id: 'seller', buyer_user_id: subA,
    seller_address: 'GSELLER', buyer_address: 'GPLATFORM', amount_usdc: 1, price_crc: 5000, sp_mode: 'seller', pin_attempts: 0, delivery_pin_hash: 'x' };
  const go = async (h: any, key: string | null, body: any, st: string, tok?: string) => {
    const db = fakeDb(); __setDbForTests(db as any); db.tables.orders.push({ ...order, status: st });
    const before = JSON.stringify(db.tables);
    const r = res(); await h(withGuest(req(null, body), key, tok), r);
    return { code: r.code, err: r.body?.error, wrote: JSON.stringify(db.tables) !== before };
  };
  const want = async (name: string, h: any, key: string | null, body: any, st: string, code: number, tok?: string) => {
    const r = await go(h, key, body, st, tok);
    t.check(name, r.code === code && !r.wrote, `${r.code} ${r.err} wrote=${r.wrote}`);
  };
  await want('sin llave ni token -> 401', confirm, null, { slug: 'gst001', reason: 'buyer_confirm' }, 'enviado', 401);
  await want('otro invitado no confirma recepción -> 403', confirm, KEY_B, { slug: 'gst001', reason: 'buyer_confirm' }, 'enviado', 403);
  await want('otro invitado no abre disputa -> 403', dispute, KEY_B, { slug: 'gst001', reason: 'no_llego' }, 'enviado', 403);
  await want('otro invitado no fondea (confirm_sinpe) -> 403', pay, KEY_B, { slug: 'gst001', step: 'confirm_sinpe' }, 'escrow_creado', 403);
  await want('otro invitado no retoma un pedido ya tomado (start) -> 403', pay, KEY_B, { slug: 'gst001', step: 'start' }, 'escrow_creado', 403);
  await want('el invitado dueño sí pasa la auth (llega a la regla de estado: 409)', confirm, KEY_A, { slug: 'gst001', reason: 'buyer_confirm' }, 'creado', 409);
  await want('el dueño no puede disputar un pedido sin fondear (409, no 403)', dispute, KEY_A, { slug: 'gst001', reason: 'no_llego' }, 'creado', 409);
  await want('pago directo USDC no existe para invitados -> 400', pay, KEY_A, { slug: 'gst001', step: 'fund_xdr' }, 'escrow_creado', 400);
  // El vendedor (token Cavos válido) no puede comprar su propio link ni siquiera como invitado.
  const selfOrder = { ...order, contract_id: null, buyer_user_id: null };
  const db = fakeDb(); __setDbForTests(db as any); db.tables.orders.push({ ...selfOrder, status: 'creado' });
  const r = res(); await pay(withGuest(req(null, { slug: 'gst001', step: 'start' }), KEY_B, await token({ sub: 'seller' })), r);
  t.check('vendedor logueado + llave de invitado -> 409 self_purchase y sin escritura', r.code === 409 && r.body?.code === 'self_purchase' && !db.tables.orders[0].contract_id, `${r.code} ${r.body?.error}`);
  // El PIN solo lo usa el vendedor con cuenta: un invitado no puede liberar con 'pin'.
  await want('invitado no puede usar reason=pin (solo vendedor con cuenta) -> 401', confirm, KEY_A, { slug: 'gst001', reason: 'pin', pin: '000000' }, 'enviado', 401);
}
