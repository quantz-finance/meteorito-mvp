// (3) release con disputa abierta rechazado + (6b) resolución 100% comprador / 100% vendedor. TESTNET.
import { Horizon, Keypair } from '@stellar/stellar-sdk';
import { makeEscrow, refused, type T, type Testnet } from './setup';
import { __setDbForTests } from '../../api/_lib/db';
import { approveAndRelease, disputeOnChain } from '../../api/_lib/escrow';
import { fakeDb } from './fakedb';

const H = new Horizon.Server('https://horizon-testnet.stellar.org');
const usdc = async (a: string) => Number((await H.loadAccount(a)).balances.find((b: any) => b.asset_code === 'USDC')?.balance ?? 0);

export async function run(t: T, N: Testnet) {
  const tw = await import('../../api/_lib/tw');
  __setDbForTests(fakeDb());
  const fake = (cid: string, status: string) => ({ id: '55555555-5555-4555-8555-555555555555', slug: 'dsp002', contract_id: cid, status, amount_usdc: 1 });
  const a = await makeEscrow(N, 'dispute-A');
  const dA = await disputeOnChain(a.contractId); console.log(`    dispute (fee-bump) ${dA}`);
  t.check('on-chain disputed=true tras disputa', (await tw.releaseGuard(a.contractId)).disputed);
  for (const reason of ['timeout', 'pin', 'buyer_confirm'] as const) {
    const m = await refused(() => approveAndRelease(fake(a.contractId, 'enviado'), reason));
    t.check(`release (${reason}) con disputa abierta -> rechazado`, m.status === 409 && /disputa/.test(m.msg), m.msg);
  }
  const m2 = await refused(() => approveAndRelease(fake(a.contractId, 'entregado'), 'timeout'));
  t.check('release (entregado) con disputa abierta -> rechazado', m2.status === 409, m2.msg);
  const m3 = await refused(() => approveAndRelease({ ...fake(a.contractId, 'enviado'), dispute_tx: dA }, 'timeout'));
  t.check('release rechazado por DB (dispute_tx)', /disputa/.test(m3.msg), m3.msg);
  const m4 = await refused(() => tw.releaseFunds(a.contractId, N.S.TESTNET_RELEASE_SIGNER_SECRET));
  t.check('release directo a TW rechazado por el contrato', !!m4.msg, m4.msg.slice(0, 100));
  t.check('fondos siguen en el escrow', (await tw.getBalance(a.contractId)) >= 1 - 1e-7);

  const buyer = N.pub('TESTNET_BUYER_SECRET'); const seller = Keypair.fromSecret(N.S.TESTNET_SELLER_SECRET).publicKey();
  const b0 = await usdc(buyer);
  const rA = await tw.resolveDispute(a.contractId, N.S.TESTNET_DISPUTE_RESOLVER_SECRET, [{ address: buyer, amount: await tw.getBalance(a.contractId) }]);
  console.log(`    resolve 100% buyer ${rA.hash}`);
  t.check('resolución 100% comprador acredita el saldo', (await usdc(buyer)) - b0 > 0.99);
  const m5 = await refused(() => approveAndRelease(fake(a.contractId, 'entregado'), 'timeout'));
  t.check('release tras resolución -> rechazado', m5.status === 409, m5.msg);

  const b = await makeEscrow(N, 'dispute-B');
  console.log(`    dispute (fee-bump) ${await disputeOnChain(b.contractId)}`);
  const s0 = await usdc(seller);
  const rB = await tw.resolveDispute(b.contractId, N.S.TESTNET_DISPUTE_RESOLVER_SECRET, [{ address: seller, amount: await tw.getBalance(b.contractId) }]);
  console.log(`    resolve 100% seller ${rB.hash}`);
  t.check('resolución 100% vendedor acredita el saldo', (await usdc(seller)) - s0 > 0.99);
}
