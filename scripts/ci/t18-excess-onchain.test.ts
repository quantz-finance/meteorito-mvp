// (18) On-chain: escrow con excedente (1 + 0.01). El release paga al vendedor solo el monto del pedido (menos fee TW).
import { Horizon, Keypair } from '@stellar/stellar-sdk';
import { makeEscrow, type T, type Testnet } from './setup';
import { __setDbForTests } from '../../api/_lib/db';
import { approveAndRelease } from '../../api/_lib/escrow';
import { env } from '../../api/_lib/env';
import { fakeDb } from './fakedb';

export async function run(t: T, N: Testnet) {
  const tw = await import('../../api/_lib/tw');
  const db = fakeDb(); __setDbForTests(db);
  const e = await makeEscrow(N, 'excess');
  await tw.fundEscrow(e.contractId, 0.01, N.S.TESTNET_TREASURY_SECRET);
  t.check('saldo con excedente = 1.01', Math.abs((await tw.getBalance(e.contractId)) - 1.01) < 1e-6);
  const id = '55555555-5555-4555-8555-555555555555';
  const order = { id, slug: 'exc001', status: 'enviado', contract_id: e.contractId, amount_usdc: 1,
    shipped_at: new Date(Date.now() - 8 * 86_400_000).toISOString(), auto_release_at: new Date(Date.now() - 86_400_000).toISOString() }; // plazo de 7 días vencido
  db.tables.orders.push({ ...order });
  const seller = Keypair.fromSecret(N.S.TESTNET_SELLER_SECRET).publicKey();
  const usdc = async () => Number(((await new Horizon.Server(env.horizon()).loadAccount(seller)).balances as any[]).find((b) => b.asset_code === 'USDC')?.balance ?? 0);
  const b0 = await usdc();
  const r = await approveAndRelease({ ...order }, 'timeout');
  t.check('auto-release con excedente -> se libera (escrow.amount)', !!r.releasedTx && db.tables.orders[0].status === 'liberado');
  const delta = Math.round((await usdc() - b0) * 1e7) / 1e7, left = await tw.getBalance(e.contractId);
  console.log(`    release: vendedor recibió ${delta} USDC, quedó en contrato ${left}`);
  t.check('vendedor recibe ≤ monto del pedido (1, neto de fee TW); excedente 0.01 queda en el contrato', delta <= 1 && delta >= 0.99 && Math.abs(left - 0.01) < 1e-6, `delta=${delta} left=${left}`);
}
