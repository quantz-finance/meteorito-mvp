// (90) Revisión legal (Neo) de #105/#106:
//  A) SOLO TESTNET en el pago con cripto: passphrase de testnet, Horizon testnet, USDC del emisor de testnet; con otra red u otro
//     emisor (USDC de Circle en mainnet) se apaga; un pago con USDC de mainnet nunca cuenta ni fondea; nunca sigue links fuera de testnet.
//  B) Cuenta IBAN / SINPE en la beta: lo enviado se DESCARTA y se guarda el dato de ejemplo; nunca aparece en la base, la cola,
//     la respuesta ni los logs; los campos son de solo lectura y llevan ph-no-capture; PostHog sin autocapture ni grabación.
import { readFileSync } from 'node:fs';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import type { T } from './setup';
import { installTestJwks, req, res, token } from './jwt';
import { fakeDb } from './fakedb';
import { __setDbForTests } from '../../api/_lib/db';
import { guestSubFromReq } from '../../api/_lib/guest';
import { __setCryptoDepsForTests, cryptoEnabled, cryptoMemo, sep7Pay, sep7Tx, testnetOnly, TESTNET_HORIZON, TESTNET_PASSPHRASE, TESTNET_USDC_ISSUER } from '../../api/_lib/crypto';
import { HOLDER_PLACEHOLDER, IBAN_PLACEHOLDER, SINPE_PLACEHOLDER } from '../../api/_lib/payout';
import { enqueueIbanPayout } from '../../api/_lib/payoutChoice';
import pay from '../../api/escrow/pay';
import store from '../../api/store/index';

const MAINNET_USDC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'; // Circle, red pública
const REAL = { iban: 'CR05015202001026284066', holder: 'Valeria Mora Solís', sinpe: '88881234' };

export async function run(t: T) {
  /* ---------------- A) solo testnet ---------------- */
  t.check('constantes fijas: passphrase testnet, Horizon testnet, USDC GBBD47…', TESTNET_PASSPHRASE === Networks.TESTNET && (TESTNET_PASSPHRASE as string) !== Networks.PUBLIC
    && TESTNET_HORIZON === 'https://horizon-testnet.stellar.org' && TESTNET_USDC_ISSUER === 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
  const KEY = 'e'.repeat(64); const sub = guestSubFromReq({ headers: { 'x-guest-key': KEY } })!;
  const TREASURY = Keypair.random().publicKey(); const BUYER = Keypair.random().publicKey();
  const order = { id: '90909090-9090-4090-8090-909090909090', slug: 'neo001', contract_id: 'CESCROW', seller_user_id: 'seller', buyer_user_id: sub, seller_address: 'GSELLER',
    buyer_address: 'GPLATFORM', amount_usdc: 2.0060181, price_crc: 1020, pin_attempts: 0, status: 'escrow_creado', created_at: new Date(Date.now() - 60_000).toISOString() };
  const urls: string[] = []; let pays: any[] = []; let next = ''; const funded: any[] = [];
  const reply = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const db = fakeDb(); __setDbForTests(db as any); db.tables.orders.push({ ...order });
  __setCryptoDepsForTests({
    fetch: (async (u: any) => { urls.push(String(u)); if (String(u).includes('/paths/strict-receive')) return reply({ _embedded: { records: [{ source_asset_type: 'native', source_amount: '2.4', path: [] }] } });
      return reply({ _embedded: { records: pays }, _links: { next: { href: next } } }); }) as any,
    treasury: () => TREASURY, now: () => Date.now(), sequence: async () => '1',
    fund: async (id, meta) => { funded.push({ id, meta }); return { fundedTx: 'f'.repeat(64), pin: '1' }; },
    convert: async () => ({ hash: 'c'.repeat(64), xlmSpent: 1 }), refund: async () => ({ hash: 'r'.repeat(64) }),
  });
  const call = async (body: any) => { const r = res(); const q: any = req(null, body); q.headers = { 'x-guest-key': KEY }; await pay(q, r); return r; };
  const saved = Object.fromEntries(['TREASURY_SECRET', 'CRYPTO_PAY', 'USDC_ISSUER', 'STELLAR_NETWORK'].map((k) => [k, process.env[k]]));
  process.env.TREASURY_SECRET = Keypair.random().secret(); delete process.env.CRYPTO_PAY; delete process.env.USDC_ISSUER; process.env.STELLAR_NETWORK = 'testnet';
  try {
    t.check('por defecto: testnetOnly y cripto encendido', testnetOnly() && cryptoEnabled());
    let r = await call({ slug: 'neo001', step: 'crypto_quote', asset: 'USDC' });
    t.check('cotización USDC: red testnet, emisor de testnet, SEP-7 con passphrase testnet', r.code === 200 && r.body.network === 'testnet' && r.body.issuer === TESTNET_USDC_ISSUER
      && r.body.uri.includes(`asset_issuer=${TESTNET_USDC_ISSUER}`) && r.body.uri.includes('network_passphrase=' + encodeURIComponent(Networks.TESTNET)) && !r.body.uri.includes(MAINNET_USDC_ISSUER), JSON.stringify(r.body).slice(0, 200));
    r = await call({ slug: 'neo001', step: 'crypto_quote', asset: 'XLM', buyer: BUYER });
    const tx = r.body.pathTx ? TransactionBuilder.fromXDR(r.body.pathTx.xdr, Networks.TESTNET) as any : null;
    const op = tx?.operations?.[0];
    t.check('path payment XLM: firmado para testnet, XLM nativo -> USDC de testnet', r.code === 200 && tx?.networkPassphrase === Networks.TESTNET && op?.sendAsset?.isNative?.() && op?.destAsset?.getIssuer?.() === TESTNET_USDC_ISSUER
      && r.body.pathTx.uri.includes('network_passphrase=' + encodeURIComponent(Networks.TESTNET)), JSON.stringify(r.body).slice(0, 160));
    t.check('SEP-7 tx y pay siempre con passphrase de testnet', sep7Tx('AAAA', 'm').includes(encodeURIComponent(Networks.TESTNET)) && !sep7Pay({ destination: TREASURY, amount: '1', asset: 'XLM', memo: 'x', msg: 'm' }).includes(encodeURIComponent(Networks.PUBLIC)));
    // Pago con USDC de MAINNET (otro emisor), memo y monto correctos: no cuenta.
    const memo = cryptoMemo('neo001'); let id = 1;
    const p = (issuer: string | null, amount: string) => ({ id: String(id++), type: 'payment', from: BUYER, to: TREASURY, amount, transaction_successful: true, transaction_hash: 'a'.repeat(64), created_at: new Date().toISOString(),
      ...(issuer ? { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: issuer } : { asset_type: 'native' }), transaction: { memo_type: 'text', memo } });
    pays = [p(MAINNET_USDC_ISSUER, '2.0060181')];
    r = await call({ slug: 'neo001', step: 'crypto_status' });
    t.check('pago con USDC de mainnet (emisor Circle) -> NO cuenta: sigue esperando y no fondea', r.code === 200 && r.body.state === 'waiting' && funded.length === 0, JSON.stringify(r.body));
    pays = [p('GOTHERISSUER', '2.0060181')];
    r = await call({ slug: 'neo001', step: 'crypto_status' });
    t.check('USDC de cualquier otro emisor -> no cuenta', r.body.state === 'waiting' && funded.length === 0);
    t.check('todas las consultas fueron a Horizon testnet', urls.length > 0 && urls.every((u) => u.startsWith(TESTNET_HORIZON + '/')), urls.find((u) => !u.startsWith(TESTNET_HORIZON)) ?? '');
    pays = []; next = 'https://horizon.stellar.org/accounts/x/payments?cursor=1'; const before = urls.length;
    // 200 registros fuerzan seguir el link "next": si apunta a mainnet no se sigue.
    pays = Array.from({ length: 200 }, () => ({ ...p(TESTNET_USDC_ISSUER, '0.0000001'), transaction: { memo_type: 'text', memo: 'otro' } }));
    await call({ slug: 'neo001', step: 'crypto_status' });
    t.check('nunca sigue un link "next" fuera de Horizon testnet', urls.slice(before).every((u) => u.startsWith(TESTNET_HORIZON + '/')), urls.slice(before).join(' '));
    next = ''; pays = [p(TESTNET_USDC_ISSUER, '2.0060181')];
    r = await call({ slug: 'neo001', step: 'crypto_status' });
    t.check('control: el mismo pago con USDC de testnet SÍ fondea', r.body.state === 'funded' && funded.length === 1, JSON.stringify(r.body));
    // Entorno apuntando a mainnet -> apagado
    process.env.USDC_ISSUER = MAINNET_USDC_ISSUER;
    t.check('USDC_ISSUER de mainnet -> testnetOnly false y cripto apagado', !testnetOnly() && !cryptoEnabled());
    db.tables.orders[0].funded_tx = null; db.tables.orders[0].status = 'escrow_creado';
    r = await call({ slug: 'neo001', step: 'crypto_quote', asset: 'USDC' });
    t.check('… cotizar -> 503 crypto_unavailable', r.code === 503 && r.body.code === 'crypto_unavailable', `${r.code}`);
    r = await call({ slug: 'neo001', step: 'crypto_status' });
    t.check('… estado -> 503 (no se detecta ni fondea nada)', r.code === 503 && funded.length === 1, `${r.code}`);
    delete process.env.USDC_ISSUER; process.env.STELLAR_NETWORK = 'public';
    t.check('STELLAR_NETWORK=public -> cripto apagado', !testnetOnly() && !cryptoEnabled());
    process.env.STELLAR_NETWORK = 'testnet';
    const src = readFileSync('api/_lib/crypto.ts', 'utf8');
    t.check('crypto.ts no usa Networks.PUBLIC ni Horizon de mainnet', !/Networks\.PUBLIC/.test(src) && !/horizon\.stellar\.org/.test(src.replace(/horizon-testnet\.stellar\.org/g, '')));
  } finally {
    __setCryptoDepsForTests(null as any);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }

  /* ---------------- B) IBAN / SINPE: dato de ejemplo ---------------- */
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app';
  const seller = await token({ sub: 'seller-neo' });
  const logs: string[] = []; const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  const grab = (...a: any[]) => { logs.push(a.map((x) => { try { return typeof x === 'string' ? x : JSON.stringify(x, Object.getOwnPropertyNames(x ?? {})); } catch { return String(x); } }).join(' ')); };
  Object.assign(console, { log: grab, warn: grab, error: grab, info: grab, debug: grab });
  const later: (() => void)[] = [];
  const leaks = (s: string) => s.includes(REAL.iban) || s.includes('CR05 0152') || s.includes(REAL.holder) || s.includes(REAL.sinpe) || s.includes('8888 1234');
  try {
    const db2 = fakeDb(); __setDbForTests(db2 as any);
    const r = res(); await store(req(seller, { action: 'payout_set', method: 'iban', iban: REAL.iban, holder_name: REAL.holder, sinpe_phone: REAL.sinpe }), r);
    const row = db2.tables.seller_payout?.[0] ?? {};
    later.push(() => t.check('IBAN real enviado -> se guarda el dato de ejemplo CR00000000000000000000', r.code === 200 && row.iban === IBAN_PLACEHOLDER && /^CR[0-9]{20}$/.test(row.iban), JSON.stringify(row)));
    later.push(() => t.check('titular real -> "Dato de ejemplo" (3..80, cumple el check)', row.holder_name === HOLDER_PLACEHOLDER && row.holder_name.length >= 3));
    later.push(() => t.check('SINPE real -> 00000000 (cumple ^[0-9]{8}$)', row.sinpe_phone === SINPE_PLACEHOLDER && /^[0-9]{8}$/.test(row.sinpe_phone)));
    later.push(() => t.check('cumple seller_payout_complete_chk (método iban con IBAN y titular)', row.payout_method === 'iban' && !!row.iban && !!row.holder_name));
    later.push(() => t.check('nada del dato real en la base ni en la respuesta', !leaks(JSON.stringify(db2.tables)) && !leaks(JSON.stringify(r.body))));
    // La base falla y el error trae la fila (como Postgres "Failing row contains …"): el log tampoco puede tener el dato real.
    const failing = fakeDb(); const from0 = failing.from;
    (failing as any).from = (tb: string) => { const q = from0(tb); if (tb !== 'seller_payout') return q;
      let payload: any = null; const up = q.upsert; q.upsert = (p: any, o: any) => { payload = p; up(p, o); return q; };
      q.then = (ok: any) => Promise.resolve({ data: null, error: { code: '23514', message: 'new row violates check constraint', details: `Failing row contains (${JSON.stringify(payload)})` } }).then(ok);
      return q; };
    __setDbForTests(failing as any);
    const r2 = res(); await store(req(seller, { action: 'payout_set', method: 'iban', iban: REAL.iban, holder_name: REAL.holder, sinpe_phone: REAL.sinpe }), r2);
    later.push(() => t.check('error de la base -> 500 y el log NO contiene IBAN/titular/SINPE reales', r2.code === 500 && logs.some((l) => l.includes('[api] 500')) && !logs.some(leaks), logs.find(leaks) ?? ''));
    later.push(() => t.check('ninguna línea de log en todo el flujo contiene el dato real', !logs.some(leaks)));
    // La cola manual nunca copia una cuenta real aunque la fila vieja la tenga.
    const db3 = fakeDb(); __setDbForTests(db3 as any);
    db3.tables.seller_payout = [{ sub: 'seller-neo', payout_method: 'iban', iban: REAL.iban, holder_name: REAL.holder, sinpe_phone: REAL.sinpe }];
    await enqueueIbanPayout({ id: 'o9', slug: 'neo009', seller_user_id: 'seller-neo', payout_method: 'iban' }, { amountUsdc: 1, amountCrc: 510, tx: 't' });
    const q = db3.tables.payout_queue?.[0] ?? {};
    later.push(() => t.check('cola IBAN: siempre el dato de ejemplo (no copia el IBAN de la fila)', q.iban === IBAN_PLACEHOLDER && q.holder_name === HOLDER_PLACEHOLDER && !leaks(JSON.stringify(q)), JSON.stringify(q)));
    later.push(() => t.check('no modifica datos existentes de seller_payout al encolar', db3.tables.seller_payout[0].iban === REAL.iban));
  } finally { Object.assign(console, orig); }
  later.forEach((f) => f());
  // App: campos de solo lectura, prellenados y fuera de PostHog; el cliente no manda datos de cuenta.
  const ui = readFileSync('components/Payout.tsx', 'utf8'); const lib = readFileSync('lib/payout.ts', 'utf8'); const an = readFileSync('lib/analytics.ts', 'utf8');
  t.check('campos IBAN/titular/SINPE: PrivateInput de solo lectura (editable=false, readOnly)', /function PrivateInput[\s\S]*editable=\{false\} readOnly/.test(ui) && (ui.match(/<PrivateInput /g) ?? []).length === 3 && !/onChangeText=\{\(v\) => setIban|setSinpe\(/.test(ui));
  t.check('marcador ph-no-capture: clase y data-ph-no-capture', /classList\?\.add\?\.\('ph-no-capture'\)/.test(ui) && /dataSet: \{ phNoCapture: 'true' \}/.test(ui));
  t.check('el cliente no manda IBAN/titular/SINPE (solo method)', /action: 'payout_set', method: 'iban' \}/.test(lib) && !/iban: raw|holder_name: holder|sinpe_phone: sinpe/.test(ui));
  t.check('PostHog: autocapture apagado, sin grabación de sesión, maskAllInputs', /autocapture: false/.test(an) && /disable_session_recording: true/.test(an) && /maskAllInputs: true/.test(an));
  t.check('copy exacto del campo y de la ayuda', ui.includes('IBAN_LABEL') && readFileSync('api/_lib/payout.ts', 'utf8').includes("'Cuenta bancaria (IBAN) - en la beta es un dato de ejemplo'")
    && readFileSync('api/_lib/payout.ts', 'utf8').includes("'Beta en testnet: no escribas tu IBAN real. No hacemos pagos al banco ni guardamos tu cuenta; en la beta se cobra solo en USDC de testnet, que no es dinero real.'"));
  t.check('sin "Lo hacemos a mano, en días hábiles" ni "Pendiente pagar al banco" para el vendedor', !/Lo hacemos a mano|días hábiles|Pendiente pagar al banco/.test(ui));
  t.check('"Marcar como pagado" solo registra la nota (sin proveedor de pagos)', (() => { const pc = readFileSync('api/_lib/payoutChoice.ts', 'utf8'); const fn = pc.slice(pc.indexOf('export async function markPayoutPaid')); return !/fetch\(|lendara|Operation\.|submitTransaction|tw\./i.test(fn); })());
}
