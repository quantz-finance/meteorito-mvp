// (1) doble fondeo rechazado + (5) webhook/confirmación SINPE duplicada idempotente. TESTNET.
import { makeEscrow, type T, type Testnet } from './setup';
import { installTestJwks, req, res, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { mockRampFund } from '../../api/_lib/escrow';
import { fakeDb } from './fakedb';
import pay from '../../api/escrow/pay';

export async function run(t: T, N: Testnet) {
  const tw = await import('../../api/_lib/tw');
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app';
  const db = fakeDb(); __setDbForTests(db);
  const e = await makeEscrow(N, 'fund', { fund: false, ship: false });
  const id = '33333333-3333-4333-8333-333333333333';
  db.tables.orders.push({ id, slug: 'fnd001', status: 'escrow_creado', contract_id: e.contractId, amount_usdc: 1, buyer_user_id: 'buyer', seller_user_id: 'seller' });

  // (1) dos fondeos simultáneos: uno pasa, el otro se rechaza por el lock (PK ramp_mock_payments)
  const [a, b] = await Promise.allSettled([mockRampFund(id), mockRampFund(id)]);
  const ok = [a, b].filter((x) => x.status === 'fulfilled') as PromiseFulfilledResult<any>[];
  const bad = [a, b].filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
  t.check('doble fondeo simultáneo: 1 OK + 1 rechazado (409)', ok.length === 1 && bad.length === 1 && bad[0].reason?.status === 409, bad[0]?.reason?.message ?? '');
  const fundedTx = ok[0]?.value?.fundedTx; console.log(`    fund tx ${fundedTx}`);
  const bal1 = await tw.getBalance(e.contractId);
  t.check('saldo on-chain = 1 USDC (no 2)', Math.abs(bal1 - 1) < 1e-6, String(bal1));
  t.check('una sola fila de pago mock', db.tables.ramp_mock_payments.length === 1);

  // (5) confirmación duplicada ("Ya pagué" / webhook del ramp) vía handler: idempotente, sin fondear de nuevo
  const buyer = await token({ sub: 'buyer' });
  const r1 = res(); await pay(req(buyer, { slug: 'fnd001', step: 'confirm_sinpe' }), r1);
  const r2 = res(); await pay(req(buyer, { slug: 'fnd001', step: 'confirm_sinpe' }), r2);
  t.check('webhook duplicado #1 -> 200 mismo fundedTx', r1.code === 200 && r1.body.fundedTx === fundedTx, `${r1.code}`);
  t.check('webhook duplicado #2 -> 200 mismo fundedTx', r2.code === 200 && r2.body.fundedTx === fundedTx, `${r2.code}`);
  t.check('PIN no se re-emite en duplicados', r1.body.pin === null && r2.body.pin === null);
  t.check('saldo on-chain sigue en 1 USDC', Math.abs((await tw.getBalance(e.contractId)) - 1) < 1e-6);
  const rs = res(); await pay(req(await token({ sub: 'seller' }), { slug: 'fnd001', step: 'confirm_sinpe' }), rs);
  t.check('confirmación por alguien que no es el comprador -> 403', rs.code === 403, `${rs.code}`);
}
