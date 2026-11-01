// (99b) Regla v1 "Reembolso si no se envía" contra TESTNET: escrow fondeado SIN "Ya lo envié", 5 días después el cron
// reembolsa solo: dispute-escrow (approver, fee-bump) + resolución 100% al comprador (dispute resolver). Idempotente:
// una segunda pasada no manda otra tx. Solo testnet.
import { Horizon } from '@stellar/stellar-sdk';
import { makeEscrow, type T, type Testnet } from './setup';
import { __setDbForTests } from '../../api/_lib/db';
import { __setChainForTests } from '../../api/_lib/escrow';
import { shipRulePass } from '../../api/_lib/shipRefund';
import { fakeDb } from './fakedb';

const H = new Horizon.Server('https://horizon-testnet.stellar.org');
const usdc = async (a: string) => Number((await H.loadAccount(a)).balances.find((b: any) => b.asset_code === 'USDC')?.balance ?? 0);
const D = 86_400_000;

export async function run(t: T, N: Testnet) {
  __setChainForTests(null);
  const tw = await import('../../api/_lib/tw');
  const db = fakeDb(); __setDbForTests(db as any);
  const e = await makeEscrow(N, 'ship-refund', { fund: true, ship: false });
  const buyer = N.pub('TESTNET_BUYER_SECRET');
  const now = Date.now();
  const o: any = { id: '99b99b99-0000-4000-8000-000000000001', slug: 'sr99b1', status: 'fondeado', delivery_mode: 'envio', rules_version: 1, amount_usdc: 1,
    contract_id: e.contractId, buyer_address: buyer, buyer_user_id: 'buyer-99b', seller_user_id: 'seller-99b', funded_tx: e.fund, funded_at: new Date(now - 5 * D - 60_000).toISOString(), shipped_at: null };
  db.tables.orders.push(o);
  const b0 = await usdc(buyer);
  const opts = { now, secret: N.S.TESTNET_DISPUTE_RESOLVER_SECRET, push: { enabled: () => false } };
  const p1: any = await shipRulePass(opts);
  console.log(`    pass1 ${JSON.stringify(p1)} dispute=${o.dispute_tx} resolve=${o.resolved_tx}`);
  t.check('día 5 sin envío: el cron reembolsa solo (resuelto, 100% comprador)', p1.refunded?.includes('sr99b1') && o.status === 'resuelto' && o.resolution?.buyerPct === 100 && o.ship_cancel?.by === 'auto', JSON.stringify(p1));
  const g = await tw.releaseGuard(e.contractId);
  t.check('on-chain: disputa registrada y resuelta', g.disputed && g.resolved, JSON.stringify({ disputed: g.disputed, resolved: g.resolved }));
  t.check('quien compra recibe todo su pago de vuelta (≥ 0,99 USDC)', (await usdc(buyer)) - b0 > 0.99);
  const p2: any = await shipRulePass({ ...opts, now: now + D });
  t.check('segunda pasada: idempotente (sin otra tx)', !p2.refunded?.length && !p2.errors?.length, JSON.stringify(p2));
}
