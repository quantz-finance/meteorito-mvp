// (24) On-chain: monto bruto de grossUsdc(PRICE) (7 decimales) se despliega/fondea/libera y el vendedor recibe ≈ ₡15 000 (no ₡15 005).
import { Horizon, Keypair } from '@stellar/stellar-sdk';
import { makeEscrow, type T, type Testnet } from './setup';
import { __setDbForTests } from '../../api/_lib/db';
import { approveAndRelease, grossUsdc } from '../../api/_lib/escrow';
import { env } from '../../api/_lib/env';
import { fakeDb } from './fakedb';

const PRICE = 2500; // CRC; chico para no agotar el USDC de la tesorería de CI (la lógica de redondeo es idéntica a ₡15 000)
export async function run(t: T, N: Testnet) {
  const db = fakeDb(); __setDbForTests(db);
  const amount = grossUsdc(PRICE);
  const e = await makeEscrow(N, 'round', { fund: true, ship: true, amount });
  const id = '66666666-6666-4666-8666-666666666666';
  const order = { id, slug: 'rnd001', status: 'enviado', contract_id: e.contractId, amount_usdc: amount };
  db.tables.orders.push({ ...order });
  const seller = Keypair.fromSecret(N.S.TESTNET_SELLER_SECRET).publicKey();
  const usdc = async () => Number(((await new Horizon.Server(env.horizon()).loadAccount(seller)).balances as any[]).find((b) => b.asset_code === 'USDC')?.balance ?? 0);
  const b0 = await usdc();
  const r = await approveAndRelease({ ...order }, 'timeout');
  const crc = (await usdc() - b0) * env.crcUsdcRate();
  console.log(`    amount=${amount} vendedor recibió ≈ ₡${crc.toFixed(3)}`);
  t.check('release con monto de 7 decimales ok', !!r.releasedTx && db.tables.orders[0].status === 'liberado');
  t.check('vendedor recibe ₡2 500 (±₡0.05)', Math.abs(crc - PRICE) < 0.05, `crc=${crc}`);
}
