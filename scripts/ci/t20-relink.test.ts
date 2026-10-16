// (20) Re-link sub -> wallet: solo 404 explícito; sin items activos (409 wallet_has_active_items);
// token fresco + nonce de un uso; auditoría wallet_relinks. Cancelación solo de links nunca fondeados.
import { Keypair } from '@stellar/stellar-sdk';
import type { T } from './setup';
import { installTestJwks, req, res, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { __setHorizonForTests } from '../../api/_lib/wallet';
import { relinkMessage } from '../../api/_lib/relink';
import { fakeDb } from './fakedb';
import activate from '../../api/wallet/activate';

const pre = (m: string) => Buffer.concat([Buffer.from('Cavos Signed Message:\n'), Buffer.from(String(Buffer.byteLength(m))), Buffer.from('\n'), Buffer.from(m)]);
const sign = (kp: Keypair, m: string) => kp.sign(pre(m)).toString('base64');

export async function run(t: T) {
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  const now = Math.floor(Date.now() / 1000);
  const oldW = Keypair.random(), newW = Keypair.random();
  let horizon: 'missing' | 'exists' | 'timeout' | '503' = 'missing';
  __setHorizonForTests(() => ({ loadAccount: async () => {
    if (horizon === 'missing') throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
    if (horizon === 'timeout') throw new Error('ETIMEDOUT');
    if (horizon === '503') throw Object.assign(new Error('Service Unavailable'), { response: { status: 503 } });
    return { balances: [] };
  } }) as any);
  const db = fakeDb(); db.tables.user_wallets = [{ sub: 'u1', wallet_address: oldW.publicKey(), source: 'backfill_orders' }]; db.tables.session_nonces = []; db.tables.wallet_relinks = [];
  __setDbForTests(db as any);
  const act = async (tok: string, body: any) => { const r = res(); await activate(req(tok, body), r); return r; };
  const fresh = await token({ sub: 'u1' });
  const relink = async (tok = fresh, kp = newW, n?: string) => { n ??= (await act(tok, { step: 'nonce' })).body.nonce as string;
    return { r: await act(tok, { step: 'relink', proof: { address: kp.publicKey(), publicKey: kp.publicKey(), signature: sign(kp, relinkMessage('u1', n)), nonce: n } }), n }; };
  const bound = () => db.tables.user_wallets.find((w: any) => w.sub === 'u1').wallet_address;

  for (const h of ['timeout', '503', 'exists'] as const) {
    horizon = h; const { r } = await relink();
    t.check(`Horizon ${h} -> 409 y NO se reemplaza`, r.code === 409 && r.body.code === 'old_wallet_not_confirmed_missing' && bound() === oldW.publicKey(), JSON.stringify(r.body));
  }
  horizon = 'missing';
  let { r } = await relink(await token({ sub: 'u1', exp: now - 600 }));
  t.check('token vencido (renovado) -> nunca re-liga', r.code === 401 && bound() === oldW.publicKey(), JSON.stringify(r.body));

  db.tables.orders.push({ id: 'a1', slug: 'oabqoi', status: 'creado', seller_user_id: 'u1', seller_address: oldW.publicKey(), contract_id: null });
  db.tables.orders.push({ id: 'a2', slug: 'fund01', status: 'fondeado', seller_user_id: 'u1', seller_address: oldW.publicKey(), contract_id: 'C1', funded_tx: 'h' });
  db.tables.orders.push({ id: 'a3', slug: 'done01', status: 'liberado', seller_user_id: 'u1', seller_address: oldW.publicKey() });
  ({ r } = await relink());
  t.check('link/pedido activo con la wallet anterior -> 409 wallet_has_active_items (lista slugs)', r.code === 409 && r.body.code === 'wallet_has_active_items' && r.body.missing.join() === 'oabqoi:creado:seller,fund01:fondeado:seller' && bound() === oldW.publicKey(), JSON.stringify(r.body));
  let c = await act(fresh, { step: 'cancel_listing', slug: 'fund01' });
  t.check('pedido fondeado -> no cancelable (409 not_cancellable)', c.code === 409 && c.body.code === 'not_cancellable' && db.tables.orders[1].status === 'fondeado');
  c = await act(await token({ sub: 'otro' }), { step: 'cancel_listing', slug: 'oabqoi' });
  t.check('cancelar link ajeno -> 403', c.code === 403);
  c = await act(fresh, { step: 'cancel_listing', slug: 'oabqoi' });
  t.check('link nunca fondeado (creado, sin escrow) -> cancelado', c.code === 200 && db.tables.orders[0].status === 'cancelado', JSON.stringify(c.body));
  db.tables.orders[1].status = 'liberado'; // simula pedido cerrado por admin
  const first = await relink();
  t.check('sin items activos + 404 explícito + token fresco + nonce -> re-ligado', first.r.code === 200 && bound() === newW.publicKey(), JSON.stringify(first.r.body));
  t.check('auditoría wallet_relinks escrita (sub, old, new)', db.tables.wallet_relinks.length === 1 && db.tables.wallet_relinks[0].sub === 'u1' && db.tables.wallet_relinks[0].old_wallet === oldW.publicKey() && db.tables.wallet_relinks[0].new_wallet === newW.publicKey());
  db.tables.user_wallets.find((w: any) => w.sub === 'u1').wallet_address = oldW.publicKey();
  ({ r } = await relink(fresh, newW, first.n));
  t.check('reusar nonce -> 401 y sin cambio', r.code === 401 && r.body.code === 'relink_invalid' && bound() === oldW.publicKey() && db.tables.wallet_relinks.length === 1, JSON.stringify(r.body));
  const n = (await act(fresh, { step: 'nonce' })).body.nonce;
  r = await act(fresh, { step: 'relink', proof: { address: newW.publicKey(), publicKey: newW.publicKey(), signature: sign(newW, `meteorito:bind:u1:${n}`), nonce: n } });
  t.check('firma de bind (otro mensaje) no sirve para relink -> 401', r.code === 401 && bound() === oldW.publicKey());
}
