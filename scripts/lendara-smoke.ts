// Smoke en vivo del pago con tarjeta in-app: Lendara sandbox + Stellar testnet con la tarjeta 4242 (escenario approved).
// Usa el código REAL del servidor (api/_lib/lendara.ts: cardPay -> card_confirm, con la verificación Lendara + Horizon) sobre
// una tesorería testnet DESECHABLE (friendbot). Sin navegador. El fondeo del escrow (Trustless Work) se reemplaza por un
// registro; la DB es en memoria. También es el health check diario (.github/workflows/lendara-health.yml).
// Uso: LENDARA_API_KEY=lnd_test_… npx tsx scripts/lendara-smoke.ts        (SMOKE_ALL=1: además la tarjeta rechazada)
import { Keypair } from '@stellar/stellar-sdk';
import { baseEnv } from './ci/setup';
import { fakeDb } from './ci/fakedb';
import { __setDbForTests } from '../api/_lib/db';
import { __setLendaraDepsForTests, cardConfirm, cardPay } from '../api/_lib/lendara';

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
(async () => {
  if (!process.env.LENDARA_API_KEY) throw new Error('falta LENDARA_API_KEY');
  baseEnv();
  const t = Keypair.random();
  for (let i = 0; ; i++) { // friendbot a veces responde 5xx: 3 intentos
    const fb = await fetch(`https://friendbot.stellar.org/?addr=${t.publicKey()}`).catch(() => null);
    if (fb?.ok) break; if (i >= 2) throw new Error('friendbot ' + fb?.status); await sleep(3000);
  }
  process.env.TREASURY_SECRET = t.secret();
  console.log('tesorería desechable', t.publicKey());
  const db = fakeDb(); __setDbForTests(db as any);
  const mk = (n: number) => ({ id: `8888888${n}-8888-4888-8888-888888888888`, slug: 'smk' + Math.random().toString(36).slice(2, 6), status: 'escrow_creado', contract_id: 'CSMOKE', price_crc: 5000, amount_usdc: 9.83, buyer_user_id: 'guest:smoke' });
  let fundedMeta: any = null;
  __setLendaraDepsForTests({ fund: async (_id, meta) => { fundedMeta = meta; return { fundedTx: 'smoke-no-escrow', pin: '000000' }; } });

  const order = mk(1); db.tables.orders.push(order);
  const t0 = Date.now(); const ms = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
  let r: any = await cardPay(order, { name: 'Ana Prueba', email: 'ana@example.com', scenario: 'approved' });
  console.log(`card_pay -> ${JSON.stringify(r)} (${ms()})`);
  for (let i = 0; i < 40 && r.pending; i++) { await sleep(3000); r = await cardConfirm(order).catch((e) => ({ error: e.message, code: e.code })); process.stdout.write('.'); }
  console.log(`\ncard_confirm -> ${JSON.stringify(r)} (${ms()})`);
  console.log('fondeo (meta) ->', JSON.stringify(fundedMeta));
  if (fundedMeta?.lendaraTx) console.log(`https://stellar.expert/explorer/testnet/tx/${fundedMeta.lendaraTx}`);
  let ok = !!fundedMeta?.lendaraTx;

  if (process.env.SMOKE_ALL) {
    const o2 = mk(2); db.tables.orders.push(o2);
    const e: any = await cardPay(o2, { name: 'Ana Prueba', email: 'ana@example.com', scenario: 'kyc_rejected' }).catch((x) => x);
    console.log('rechazada ->', e?.code, e?.message);
    ok = ok && e?.code === 'card_kyc_rejected';
  }
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e?.code ?? '', e?.message ?? e); process.exit(1); });
