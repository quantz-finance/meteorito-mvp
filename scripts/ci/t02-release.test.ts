// (2) doble release rechazado. TESTNET.
import { makeEscrow, refused, type T, type Testnet } from './setup';
import { __setDbForTests } from '../../api/_lib/db';
import { approveAndRelease } from '../../api/_lib/escrow';
import { fakeDb } from './fakedb';

export async function run(t: T, N: Testnet) {
  const tw = await import('../../api/_lib/tw');
  const db = fakeDb(); __setDbForTests(db);
  const e = await makeEscrow(N, 'release');
  const id = '44444444-4444-4444-8444-444444444444';
  const order = { id, slug: 'rel001', status: 'enviado', contract_id: e.contractId, amount_usdc: 1 };
  db.tables.orders.push({ ...order });
  const r = await approveAndRelease({ ...order }, 'buyer_confirm');
  console.log(`    release tx ${r.releasedTx}`);
  t.check('primer release OK, pedido liberado', !!r.releasedTx && db.tables.orders[0].status === 'liberado');
  const again = await refused(() => approveAndRelease({ ...db.tables.orders[0] }, 'pin'));
  t.check('segundo release (status liberado) -> 409', again.status === 409, again.msg);
  const stale = await refused(() => approveAndRelease({ ...order, status: 'entregado' }, 'timeout'));
  t.check('release con copia vieja (entregado) -> rechazado on-chain', stale.status === 409 && /cerrado|disputa/.test(stale.msg), stale.msg);
  const direct = await refused(() => tw.releaseFunds(e.contractId, N.S.TESTNET_RELEASE_SIGNER_SECRET));
  t.check('release directo a TW tras liberar -> rechazado por el contrato', !!direct.msg, direct.msg.slice(0, 100));
  t.check('escrow vacío tras el release', (await tw.getBalance(e.contractId)) < 1e-6);
}
