// Test automatizado (testnet): "liberar con disputa abierta se rechaza" + resolución en ambos sentidos.
// Uso: SECRETS_DIR=/workspace/meteorito-secrets npx tsx scripts/test-dispute.ts
// Solo testnet. Usa wallets de prueba del archivo de secretos local (nunca commiteado).
import { readFileSync } from 'node:fs';
import { Horizon, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';

const dir = process.env.SECRETS_DIR ?? '/workspace/meteorito-secrets';
const W = JSON.parse(readFileSync(`${dir}/testnet-wallets.json`, 'utf8')).wallets;
const envFile = Object.fromEntries(readFileSync(`${dir}/vercel.env`, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
Object.assign(process.env, {
  STELLAR_NETWORK: 'testnet', TW_API_KEY: readFileSync(`${dir}/tw_api_key.txt`, 'utf8').trim(),
  SUPABASE_URL: envFile.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: readFileSync(`${dir}/supabase_service_key.txt`, 'utf8').trim(),
  DEPLOYER_SECRET: W.deployer.secret, TREASURY_SECRET: W.treasury.secret, APPROVER_SECRET: W.approver.secret,
  RELEASE_SIGNER_SECRET: W.release_signer.secret, PLATFORM_PUBLIC: W.platform.public, PLATFORM_SECRET: W.platform.secret,
  DISPUTE_RESOLVER_PUBLIC: W.dispute_resolver.public,
});
const H = new Horizon.Server('https://horizon-testnet.stellar.org');
const usdc = async (a: string) => Number((await H.loadAccount(a)).balances.find((b: any) => b.asset_code === 'USDC')?.balance ?? 0);
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) failed++; };
const refused = async (f: () => Promise<unknown>) => { try { await f(); return ''; } catch (e: any) { return String(e.message); } };

(async () => {
  if (!(globalThis as any).WebSocket) (globalThis as any).WebSocket = (await import('ws')).default; // Node 20 local
  const tw = await import('../api/_lib/tw');
  const { approveAndRelease, disputeOnChain } = await import('../api/_lib/escrow');
  const seller = Keypair.fromSecret(W.smoke_seller.secret);
  const mk = async (tag: string) => {
    const { contractId, hash } = await tw.deploySingleRelease({ signerSecret: W.deployer.secret, engagementId: `test-${tag}-${Date.now()}`, title: 'Meteorito dispute test', description: tag, amount: 1,
      roles: { approver: W.approver.public, serviceProvider: seller.publicKey(), releaseSigner: W.release_signer.public, receiver: seller.publicKey(), disputeResolver: W.dispute_resolver.public, platformAddress: W.platform.public } });
    const f = await tw.fundEscrow(contractId, 1, W.treasury.secret);
    const x = await tw.changeMilestoneStatusXdr(contractId, seller.publicKey(), 'Enviado', 'sha256:test');
    const t = TransactionBuilder.fromXDR(x.unsignedTransaction, Networks.TESTNET); t.sign(seller);
    const sh = await tw.submitSignedXdr(t.toXDR());
    console.log(`[${tag}] contract ${contractId}\n  deploy ${hash}\n  fund   ${f.hash}\n  ship   ${sh.hash}`);
    return contractId;
  };
  const fake = (cid: string, status: string) => ({ id: '00000000-0000-0000-0000-000000000000', slug: 'test00', contract_id: cid, status, amount_usdc: 1 });

  // 1) Disputa abierta -> liberar rechazado (cron/timeout, PIN, Recibí), on-chain
  const a = await mk('A');
  const dA = await disputeOnChain(a); console.log(`  dispute (fee-bump) ${dA}`);
  const g = await tw.releaseGuard(a);
  check('on-chain flags.disputed=true tras disputa', g.disputed);
  for (const reason of ['timeout', 'pin', 'buyer_confirm'] as const) {
    const m = await refused(() => approveAndRelease(fake(a, 'enviado'), reason));
    check(`release (${reason}, status enviado) rechazado`, /disputa/.test(m), m);
  }
  const m2 = await refused(() => approveAndRelease(fake(a, 'entregado'), 'timeout'));
  check('release (status entregado) rechazado', /disputa/.test(m2), m2);
  const m3 = await refused(() => approveAndRelease({ ...fake(a, 'enviado'), dispute_tx: dA }, 'timeout'));
  check('release rechazado por DB (dispute_tx)', /disputa/.test(m3), m3);
  const m4 = await refused(() => tw.releaseFunds(a, W.release_signer.secret));
  check('release directo a TW rechazado por el contrato', !!m4, m4.slice(0, 120));
  check('fondos siguen en el escrow', (await tw.getBalance(a)) >= 1 - 1e-7);

  // 2) Resolver 100% comprador
  const b0 = await usdc(W.smoke_buyer.public);
  const rA = await tw.resolveDispute(a, W.dispute_resolver.secret, [{ address: W.smoke_buyer.public, amount: await tw.getBalance(a) }]);
  const b1 = await usdc(W.smoke_buyer.public);
  console.log(`  resolve 100% buyer ${rA.hash}  buyer ${b0} -> ${b1}`);
  check('100% comprador recibe el saldo', b1 - b0 > 0.99);
  check('flags.resolved=true', (await tw.releaseGuard(a)).resolved);
  const m5 = await refused(() => approveAndRelease(fake(a, 'entregado'), 'timeout'));
  check('release tras resolución rechazado', /cerrado|disputa/.test(m5), m5);

  // 3) Resolver 100% vendedor
  const b = await mk('B');
  const dB = await disputeOnChain(b); console.log(`  dispute (fee-bump) ${dB}`);
  const s0 = await usdc(seller.publicKey());
  const rB = await tw.resolveDispute(b, W.dispute_resolver.secret, [{ address: seller.publicKey(), amount: await tw.getBalance(b) }]);
  const s1 = await usdc(seller.publicKey());
  console.log(`  resolve 100% seller ${rB.hash}  seller ${s0} -> ${s1}`);
  check('100% vendedor recibe el saldo', s1 - s0 > 0.99);

  console.log(failed ? `\n${failed} FALLARON` : '\nTODO OK');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERROR', String(e.message).slice(0, 800)); process.exit(1); });
