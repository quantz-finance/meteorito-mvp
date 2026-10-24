// Smoke en vivo (manual, NO corre en CI): Lendara sandbox + Stellar testnet con la tarjeta 4242.
// Crea una cuenta testnet desechable como "tesorería", usa api/_lib/lendara.ts real (sesión + trustline + verificación
// Lendara/Horizon) y llena el widget real con Playwright. El fondeo del escrow se reemplaza por un registro (sin TW).
// Uso: LENDARA_API_KEY=lnd_test_… npx tsx scripts/lendara-smoke.ts [carpeta-capturas]
import { Keypair } from '@stellar/stellar-sdk';
import { chromium, devices } from 'playwright';
import { baseEnv } from './ci/setup';
import { fakeDb } from './ci/fakedb';
import { __setDbForTests } from '../api/_lib/db';
import { __setLendaraDepsForTests, cardConfirm, cardSession } from '../api/_lib/lendara';

(async () => {
  if (!process.env.LENDARA_API_KEY) throw new Error('falta LENDARA_API_KEY');
  const shots = process.argv[2] ?? '/tmp';
  baseEnv();
  const t = Keypair.random();
  const fb = await fetch(`https://friendbot.stellar.org/?addr=${t.publicKey()}`); if (!fb.ok) throw new Error('friendbot ' + fb.status);
  process.env.TREASURY_SECRET = t.secret();
  console.log('tesorería desechable', t.publicKey());
  const db = fakeDb(); __setDbForTests(db as any);
  const order = { id: '88888888-8888-4888-8888-888888888888', slug: 'smk' + Math.random().toString(36).slice(2, 5), status: 'escrow_creado', contract_id: 'CSMOKE', price_crc: 5000, amount_usdc: 9.83 };
  db.tables.orders.push(order);
  let fundedMeta: any = null;
  __setLendaraDepsForTests({ fund: async (_id, meta) => { fundedMeta = meta; return { fundedTx: 'smoke-no-escrow', pin: '000000' }; } });
  const t0 = Date.now();
  const s: any = await cardSession(order);
  console.log(`sesión ${s.sessionId} (${Date.now() - t0} ms)`);
  const b = await chromium.launch();
  const page = await (await b.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(s.url);
  const cont = () => page.getByRole('button', { name: /^Continuar$/ }).click();
  await page.waitForSelector('#amount', { timeout: 60_000 }); await page.screenshot({ path: `${shots}/lendara-live-1-monto.png` });
  await cont();
  await page.fill('#name', 'Ana Prueba'); await page.fill('#email', 'ana@example.com');
  await page.screenshot({ path: `${shots}/lendara-live-2-datos.png` }); await cont();
  await page.fill('#card-number', '4242 4242 4242 4242'); await page.fill('#expiry', '12/29'); await page.fill('#cvc', '123');
  if (await page.locator('#holder').count()) await page.fill('#holder', 'Ana Prueba');
  await page.screenshot({ path: `${shots}/lendara-live-3-tarjeta.png` }); await cont();
  await page.getByRole('button', { name: /^Pagar / }).click();
  let r: any = null;
  for (let i = 0; i < 40; i++) { await new Promise((ok) => setTimeout(ok, 3000)); r = await cardConfirm(order).catch((e) => ({ error: e.message, code: e.code })); if (!r.pending) break; process.stdout.write('.'); }
  await page.screenshot({ path: `${shots}/lendara-live-4-estado.png` });
  await b.close();
  console.log('\ncard_confirm ->', JSON.stringify(r));
  console.log('fondeo (meta) ->', JSON.stringify(fundedMeta));
  if (fundedMeta?.lendaraTx) console.log(`https://stellar.expert/explorer/testnet/tx/${fundedMeta.lendaraTx}`);
  process.exit(fundedMeta ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
