// Prueba manual de punta a punta del pago con cripto en TESTNET con el código real (handlers de /api/escrow/pay y
// /api/escrow/confirm, Trustless Work y Horizon reales; la base es fakeDb). Usa las wallets de CI (.ci-secrets.env).
// Tres pedidos de ~1 USDC, cada uno con un comprador invitado nuevo (Friendbot):
//   A) paga USDC directo   B) firma el path payment XLM -> USDC (SEP-7 tx)   C) paga XLM y la tesorería lo convierte
//   W) USDC + el vendedor cobra en SU wallet Stellar (029)   I) USDC + el vendedor cobra en Cuenta IBAN (libera a platform + cola)
// Cada uno: escrow fondeado en USDC (saldo on-chain = monto) -> "Recibí" (cara a cara) -> liberado al vendedor de prueba.
// La tesorería recibe el USDC del comprador y fondea el escrow: costo neto ~0 USDC (solo fees en XLM).
// Uso: npx tsx scripts/crypto-testnet-e2e.ts [A|B|C ...]
import { Asset, Horizon, Keypair, Memo, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { baseEnv, testnet } from './ci/setup';
import { fakeDb } from './ci/fakedb';
import { req, res } from './ci/jwt';

baseEnv(); const N = testnet(); if (!N) throw new Error('faltan secretos testnet (.ci-secrets.env)');
if (Networks.TESTNET !== 'Test SDF Network ; September 2015') throw new Error('solo testnet');
const H = new Horizon.Server('https://horizon-testnet.stellar.org');
const USDC = new Asset('USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function buyerWallet(withUsdc: number | null) {
  const kp = Keypair.random();
  const fb = await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`); if (!fb.ok) throw new Error(`friendbot ${fb.status}`);
  if (withUsdc != null) {
    const a = await H.loadAccount(kp.publicKey());
    const paths = await H.strictReceivePaths([Asset.native()], USDC, withUsdc.toFixed(7)).call();
    const tx = new TransactionBuilder(a, { fee: '10000', networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.changeTrust({ asset: USDC }))
      .addOperation(Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax: (Number(paths.records[0].source_amount) * 1.1).toFixed(7), destination: kp.publicKey(), destAsset: USDC, destAmount: withUsdc.toFixed(7), path: [] }))
      .setTimeout(60).build();
    tx.sign(kp); await H.submitTransaction(tx);
  }
  return kp;
}
async function send(kp: Keypair, to: string, asset: Asset, amount: string, memo: string) {
  const a = await H.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(a, { fee: '10000', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: to, asset, amount })).addMemo(Memo.text(memo)).setTimeout(60).build();
  tx.sign(kp); return ((await H.submitTransaction(tx)) as any).hash as string;
}

(async () => {
  const { __setDbForTests } = await import('../api/_lib/db');
  const pay = (await import('../api/escrow/pay')).default;
  const confirm = (await import('../api/escrow/confirm')).default;
  const tw = await import('../api/_lib/tw');
  const db = fakeDb(); __setDbForTests(db as any);
  const seller = N.pub('TESTNET_SELLER_SECRET');
  const cases = (process.argv.slice(2).length ? process.argv.slice(2) : ['A', 'B', 'C']).map((c) => c.toUpperCase());
  const out: any[] = [];
  for (const c of cases) {
    const key = Keypair.random().rawSecretKey().toString('hex');
    const call = async (h: any, body: any) => { const r = res(); const q: any = req(null, body); q.headers = { 'x-guest-key': key }; await h(q, r); if (r.code !== 200) throw new Error(`${body.step ?? body.reason} ${r.code} ${JSON.stringify(r.body)}`); return r.body; };
    const slug = `cr${c.toLowerCase()}${String(Date.now()).slice(-3)}`;
    // Dónde cobra el vendedor (029): W = wallet externa nueva con trustline USDC; I = Cuenta IBAN (receiver = platform).
    let payoutWallet: string | null = null;
    db.tables.seller_payout = [];
    if (c === 'W') {
      const kp = Keypair.random(); await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
      const a = await H.loadAccount(kp.publicKey());
      const tx = new TransactionBuilder(a, { fee: '10000', networkPassphrase: Networks.TESTNET }).addOperation(Operation.changeTrust({ asset: USDC })).setTimeout(60).build();
      tx.sign(kp); await H.submitTransaction(tx); payoutWallet = kp.publicKey();
      db.tables.seller_payout.push({ sub: 'seller-ci', payout_method: 'wallet', stellar_address: payoutWallet, iban: null, holder_name: null });
    }
    if (c === 'I') db.tables.seller_payout.push({ sub: 'seller-ci', payout_method: 'iban', stellar_address: null, iban: 'CR05015202001026284066', holder_name: 'Vendedor de prueba' });
    db.tables.orders.push({ id: crypto.randomUUID(), slug, status: 'creado', kind: 'single', seller_user_id: 'seller-ci', seller_address: seller, price_crc: 510, brand: 'CI', model: `cripto ${c}`,
      delivery_mode: 'cara_a_cara', protection_minutes: 1440, created_at: new Date(Date.now() - 5000).toISOString(), pin_attempts: 0 });
    const st = await call(pay, { slug, step: 'start' });
    const order = db.tables.orders.find((o: any) => o.slug === slug);
    console.log(`[${c}] pedido ${slug} escrow ${st.contractId} deploy ${order.deploy_tx} monto ${st.amountUsdc} USDC cripto=${st.crypto}`);
    let paidTx = '';
    if (c === 'A' || c === 'W' || c === 'I') {
      const q = await call(pay, { slug, step: 'crypto_quote', asset: 'USDC' });
      const kp = await buyerWallet(Number(q.amount));
      paidTx = await send(kp, q.destination, USDC, q.amount, q.memo);
    } else if (c === 'B') {
      const kp = await buyerWallet(null);
      const q = await call(pay, { slug, step: 'crypto_quote', asset: 'XLM', buyer: kp.publicKey() });
      const tx = TransactionBuilder.fromXDR(q.pathTx.xdr, Networks.TESTNET); tx.sign(kp);
      paidTx = ((await H.submitTransaction(tx)) as any).hash;
    } else {
      const kp = await buyerWallet(null);
      const q = await call(pay, { slug, step: 'crypto_quote', asset: 'XLM' });
      paidTx = await send(kp, q.destination, Asset.native(), q.amount, q.memo);
      console.log(`[${c}] cotización ${q.amount} XLM (colchón ${q.slippage})`);
    }
    console.log(`[${c}] pago del comprador ${paidTx}`);
    let s: any = null;
    for (let i = 0; i < 20; i++) { await sleep(4000); s = await call(pay, { slug, step: 'crypto_status' }); console.log(`[${c}] estado ${s.state}`); if (s.state === 'funded') break; }
    if (s?.state !== 'funded') throw new Error(`[${c}] no se fondeó: ${JSON.stringify(s)}`);
    const bal = await tw.getBalance(order.contract_id);
    const conv = db.tables.order_events.find((e: any) => e.order_id === order.id && e.kind === 'crypto_converted');
    console.log(`[${c}] fondeado ${s.fundedTx} saldo escrow ${bal} USDC${conv ? ` conversión ${conv.detail.hash} (${conv.detail.xlmSpent} XLM)` : ''}${s.refunded ? ` devolución ${JSON.stringify(s.refunded)}` : ''}`);
    const usdcOf = async (a: string) => Number((await H.loadAccount(a)).balances.find((b: any) => b.asset_code === 'USDC')?.balance ?? 0);
    const payee = order.payout_address ?? seller; const before = await usdcOf(payee);
    const rel = await call(confirm, { slug, reason: 'buyer_confirm' });
    const got = Math.round((await usdcOf(payee) - before) * 1e7) / 1e7;
    const q = (db.tables.payout_queue ?? []).find((r: any) => r.slug === slug);
    console.log(`[${c}] liberado ${rel.releasedTx} -> ${payee} (${order.payout_method ?? 'cavos'}) recibió ${got} USDC${q ? ` · cola IBAN: ${q.state} ${q.amount_usdc} USDC ₡${q.amount_crc}` : ''}`);
    out.push({ case: c, slug, contract: order.contract_id, deploy: order.deploy_tx, buyerPayment: paidTx, convert: conv?.detail?.hash ?? null, funded: s.fundedTx, escrowBalance: bal, refunded: s.refunded ?? [], released: rel.releasedTx, receiver: order.payout_address ?? seller, route: order.payout_method ?? 'cavos', payoutWallet, received: got, queue: q ? { state: q.state, amount_usdc: q.amount_usdc } : null });
  }
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
