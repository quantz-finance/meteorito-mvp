// (52) Pago con tarjeta in-app (formulario propio + Lendara headless desde el servidor). Sin red: Lendara (/v1 y
// /widget-api) y Horizon simulados con estado. Cubre lib/card.ts (Luhn, marca, vencimiento, CVC, tarjeta -> escenario),
// el cliente headless (token de un uso, 409 al confirmar/pagar dos veces, arranque en frío) y step=card_pay.
import { Keypair } from '@stellar/stellar-sdk';
import type { T } from './setup';
import { req, res } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { fakeDb } from './fakedb';
import { guestSubFromReq } from '../../api/_lib/guest';
import { __setLendaraDepsForTests, LENDARA_USDC_ISSUER, cardMemo, cardMode, headless } from '../../api/_lib/lendara';
import pay from '../../api/escrow/pay';
import { cardBrand, cvcValid, expiryValid, formatCardNumber, formatExpiry, luhn, NOT_ACCEPTED, scenarioFor, validateCard } from '../../lib/card';

const KEY_A = 'a'.repeat(64), KEY_B = 'b'.repeat(64);
const TREASURY = Keypair.random();
const HASH = 'cd'.repeat(32);
const withGuest = (r: any, key: string) => { r.headers = { 'x-guest-key': key }; return r; };
type Tx = { id: string; status: string; token: string; used: boolean; account: string; memo: string; amount_in?: string; message?: string };

export async function run(t: T) {
  /* ---------------- lib/card.ts ---------------- */
  t.check('Luhn: 4242… y las 4 tarjetas aceptadas son válidas', ['4242424242424242', '4000000000000002', '4000000000009995', '4000000000000077', '5555555555554444', '378282246310005'].every(luhn));
  t.check('Luhn: dígito cambiado / muy corta / vacía -> inválida', !luhn('4242424242424241') && !luhn('4242') && !luhn(''));
  t.check('marca: Visa / Mastercard (51-55 y 2221-2720) / Amex / otra', cardBrand('4242') === 'visa' && cardBrand('5555') === 'mastercard' && cardBrand('2221') === 'mastercard' && cardBrand('3782') === 'amex' && cardBrand('6011') === 'unknown');
  t.check('formato con espacios cada 4 (Amex 4-6-5) y corta al largo de la marca', formatCardNumber('4242424242424242999') === '4242 4242 4242 4242' && formatCardNumber('378282246310005') === '3782 822463 10005' && formatCardNumber('42 42-4') === '4242 4');
  t.check('vencimiento: autoformato MM/AA', formatExpiry('1229') === '12/29' && formatExpiry('4') === '04/' && formatExpiry('12') === '12/' && formatExpiry('12', '12/') === '12');
  const now = new Date(2026, 9, 23);
  t.check('vencimiento: mes actual vale, mes pasado no, mes 13 no, formato raro no', expiryValid('10/26', now) && !expiryValid('09/26', now) && !expiryValid('13/30', now) && !expiryValid('1/30', now) && expiryValid('12/29', now));
  t.check('CVC: 3 dígitos (Visa), 4 (Amex)', cvcValid('123', '4242') && !cvcValid('12', '4242') && !cvcValid('1234', '4242') && cvcValid('1234', '3782') && !cvcValid('12a', '4242'));
  t.check('tarjeta -> escenario (las 4 del procesador)', scenarioFor('4242 4242 4242 4242') === 'approved' && scenarioFor('4000000000000002') === 'kyc_rejected' && scenarioFor('4000 0000 0000 9995') === 'payment_not_received' && scenarioFor('4000000000000077') === 'delayed');
  t.check('otra tarjeta válida (Luhn) -> no aceptada', scenarioFor('5555555555554444') === null);
  const form = { name: 'Ana Pérez', email: 'ana@example.com', number: '4242 4242 4242 4242', expiry: '12/29', cvc: '123' };
  t.check('formulario completo y válido -> sin errores', Object.keys(validateCard(form, now)).length === 0, JSON.stringify(validateCard(form, now)));
  const bad = validateCard({ name: 'A', email: 'ana@', number: '4242 4242 4242 4241', expiry: '01/20', cvc: '1' }, now);
  t.check('errores por campo en español (nombre, correo, número, vencida, CVC)', !!(bad.name && bad.email && bad.number && /vencida/.test(bad.expiry!) && bad.cvc), JSON.stringify(bad));
  t.check('tarjeta válida pero no aceptada -> "Tarjeta no aceptada"', validateCard({ ...form, number: '5555 5555 5555 4444' }, now).number === NOT_ACCEPTED);

  /* ---------------- doble de Lendara + Horizon ---------------- */
  const subA = guestSubFromReq({ headers: { 'x-guest-key': KEY_A } })!;
  const base = { id: '52525252-5252-4252-8252-525252525252', slug: 'inp001', contract_id: 'CESCROW', seller_user_id: 'seller', buyer_user_id: subA,
    seller_address: 'GSELLER', buyer_address: 'GPLATFORM', amount_usdc: 9.83, price_crc: 5000, sp_mode: 'seller', pin_attempts: 0, status: 'escrow_creado' };
  let txs: Record<string, Tx> = {}; let log: { method: string; path: string; body: any }[] = []; let fail: Record<string, number> = {}; let lose: Record<string, number> = {};
  let funded: any[] = [];
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const view = (x: Tx) => ({ id: x.id, kind: 'deposit', status: x.status, message: x.message, amount_in: x.amount_in, amount_in_asset: 'iso4217:CRC', amount_out: '9.3039215',
    amount_out_asset: `stellar:USDC:${LENDARA_USDC_ISSUER}`, to: x.account, deposit_memo: x.memo, deposit_memo_type: 'text', stellar_transaction_id: x.status === 'completed' ? HASH : undefined });
  const fakeFetch = async (url: any, init: any = {}) => {
    const u = new URL(String(url)); const method = init.method ?? 'GET'; const body = init.body ? JSON.parse(init.body) : undefined;
    if (u.host === 'lendara.test') {
      log.push({ method, path: u.pathname, body });
      const key = `${method} ${u.pathname}`;
      if (fail[key]) { fail[key]--; throw new TypeError('fetch failed'); } // arranque en frío / timeout
      const auth = String(init.headers?.Authorization ?? '');
      if (u.pathname === '/v1/sessions') {
        if (auth !== 'Bearer lnd_test_ci') return reply(401, { error: 'invalid API key' });
        const id = `inapp-${Object.keys(txs).length + 1}`;
        txs[id] = { id, status: 'incomplete', token: `tok-${id}`, used: false, account: body.account, memo: body.memo };
        return reply(201, { id, url: `https://widget.lendara.test/widget/${id}?token=tok-${id}`, expires_at: new Date(Date.now() + 9e5).toISOString() });
      }
      const m = u.pathname.match(/^\/v1\/transactions\/(.+)$/);
      if (m) { const x = txs[m[1]]; return x ? reply(200, view(x)) : reply(404, { error: 'not found' }); }
      if (u.pathname === '/widget-api/sessions') {
        const x = txs[body.transaction_id];
        if (!x || x.token !== body.token || x.used) return reply(401, { error: 'the link is invalid, expired or was already used' });
        x.used = true;
        if (lose[key]) { lose[key]--; throw new TypeError('socket hang up'); } // se consumió pero la respuesta se perdió
        return reply(201, { access_token: `at-${x.id}`, expires_at: new Date(Date.now() + 18e5).toISOString() });
      }
      const x = Object.values(txs).find((y) => auth === `Bearer at-${y.id}`);
      if (!x) return reply(401, { error: 'unauthorized' });
      if (u.pathname === '/widget-api/transaction') return reply(200, { transaction: view(x) });
      if (u.pathname === '/widget-api/transaction/confirm') {
        if (x.status !== 'incomplete') return reply(409, { error: 'the amount of this transaction was already confirmed' });
        Object.assign(x, { status: 'pending_user_transfer_start', amount_in: body.amount }); return reply(200, { transaction: view(x) });
      }
      if (u.pathname === '/widget-api/transaction/simulate-payment') {
        if (x.status !== 'pending_user_transfer_start') return reply(409, { error: 'the transaction is not waiting for a payment' });
        if (body.scenario === 'kyc_rejected') Object.assign(x, { status: 'error', message: 'KYC rejected (sandbox scenario).' });
        else if (body.scenario === 'payment_not_received') Object.assign(x, { status: 'expired', message: 'Payment not received (sandbox scenario).' });
        else x.status = 'pending_anchor';
        return reply(200, { transaction: view(x) });
      }
    }
    if (u.host === 'horizon-testnet.stellar.org') {
      if (u.pathname.endsWith('/operations')) return reply(200, { _embedded: { records: [{ type: 'payment', to: TREASURY.publicKey(), asset_code: 'USDC', asset_issuer: LENDARA_USDC_ISSUER, amount: '9.3039215' }] } });
      return reply(200, { hash: HASH, successful: true, memo_type: 'text', memo: cardMemo('inp001') });
    }
    return reply(599, { error: 'unexpected ' + u });
  };
  const setup = () => {
    const db = fakeDb(); __setDbForTests(db as any); db.tables.orders.push({ ...base });
    txs = {}; log = []; fail = {}; lose = {}; funded = [];
    __setLendaraDepsForTests({
      fetch: fakeFetch as any, ensureTrustline: async () => {},
      fund: async (orderId: string, meta: any) => {
        const o = db.tables.orders.find((y: any) => y.id === orderId);
        if (o.funded_tx) return { fundedTx: o.funded_tx, pin: null };
        funded.push(meta); Object.assign(o, { funded_tx: 'f'.repeat(64), status: 'fondeado' }); return { fundedTx: o.funded_tx, pin: '654321' };
      },
    });
    return db;
  };
  const call = async (key: string, body: any) => { const r = res(); await pay(withGuest(req(null, body), key), r); return r; };
  const cardPay = (extra: any = {}, key = KEY_A) => call(key, { slug: 'inp001', step: 'card_pay', name: 'Ana Pérez', email: 'ana@example.com', scenario: 'approved', ...extra });
  const confirm = () => call(KEY_A, { slug: 'inp001', step: 'card_confirm' });
  const count = (path: string) => log.filter((l) => l.path === path).length;
  const saved = Object.fromEntries(['LENDARA_API_KEY', 'LENDARA_API_URL', 'TREASURY_SECRET', 'LENDARA_MODE', 'LENDARA_RETRY_WAIT_MS'].map((k) => [k, process.env[k]]));
  Object.assign(process.env, { LENDARA_API_KEY: 'lnd_test_ci', LENDARA_API_URL: 'https://lendara.test', TREASURY_SECRET: TREASURY.secret(), LENDARA_RETRY_WAIT_MS: '0' });
  delete process.env.LENDARA_MODE;

  /* ---------------- cliente headless ---------------- */
  { setup();
    const s = await headless.createSession({ account: TREASURY.publicKey(), amountCrc: 5000, memo: cardMemo('inp001') });
    const at = await headless.openWidgetSession(s.id, s.token);
    const c = await headless.confirm(at, 5000);
    const p = await headless.pay(at, 'approved');
    t.check('headless: sesión -> token -> confirmar -> pagar (aprobada) = pending_anchor', s.id === 'inapp-1' && s.token === 'tok-inapp-1' && at === 'at-inapp-1' && c.status === 'pending_user_transfer_start' && c.amount_in === '5000.00' && p.status === 'pending_anchor', JSON.stringify({ s, c, p }));
    let reuse: any = null; try { await headless.openWidgetSession(s.id, s.token); } catch (e) { reuse = e; }
    t.check('headless: token reutilizado -> 401 -> error controlado (no reintenta en bucle)', reuse?.code === 'card_provider_down' && log.filter((l) => l.path === '/widget-api/sessions').length === 2);
    const p2 = await headless.pay(at, 'approved');
    t.check('headless: pagar dos veces -> 409 -> devuelve el estado actual, sin segundo cobro', p2.status === 'pending_anchor' && log.filter((l) => l.path.endsWith('simulate-payment')).length === 2 && txs['inapp-1'].status === 'pending_anchor'); }
  { setup();
    const s = await headless.createSession({ account: TREASURY.publicKey(), amountCrc: 5000, memo: 'm' });
    const at = await headless.openWidgetSession(s.id, s.token);
    await headless.confirm(at, 5000); const again = await headless.confirm(at, 5000);
    t.check('headless: confirmar dos veces (mismo monto) -> 409 tolerado', again.status === 'pending_user_transfer_start');
    let e2: any = null; try { await headless.confirm(at, 9999); } catch (e) { e2 = e; }
    t.check('headless: 409 con otro monto -> error (no sigue)', e2?.code === 'card_failed', e2?.code); }
  { setup(); fail['POST /v1/sessions'] = 1; fail['POST /widget-api/sessions'] = 1;
    const s = await headless.createSession({ account: TREASURY.publicKey(), amountCrc: 5000, memo: 'm' });
    const at = await headless.openWidgetSession(s.id, s.token);
    t.check('headless: arranque en frío (red/timeout) en sesión y token -> reintenta y sigue', !!at && count('/v1/sessions') === 2 && count('/widget-api/sessions') === 2); }
  { setup(); fail['POST /v1/sessions'] = 5; let e: any = null;
    try { await headless.createSession({ account: TREASURY.publicKey(), amountCrc: 5000, memo: 'm' }); } catch (x) { e = x; }
    t.check('headless: Lendara caído -> card_provider_down tras 2 intentos', e?.code === 'card_provider_down' && count('/v1/sessions') === 2, `${e?.code} ${count('/v1/sessions')}`); }

  /* ---------------- step=card_pay ---------------- */
  t.check('modo por defecto: in-app; LENDARA_MODE=widget vuelve al widget', cardMode() === 'inapp' && ((process.env.LENDARA_MODE = 'widget'), cardMode() === 'widget'));
  delete process.env.LENDARA_MODE;

  { const db = setup();
    const r = await cardPay({ amount: 1, fiat_currency: 'USD' });
    const conf = log.find((l) => l.path === '/widget-api/transaction/confirm');
    const sess = log.find((l) => l.path === '/v1/sessions');
    t.check('aprobada: 200 pending (el cliente consulta card_confirm)', r.code === 200 && r.body?.pending === true, `${r.code} ${JSON.stringify(r.body)}`);
    t.check('monto forzado a price_crc de la DB aunque el cliente mande otro', conf?.body?.amount === '5000.00' && conf?.body?.fiat_currency === 'CRC' && sess?.body?.amount === '5000', JSON.stringify(conf?.body));
    t.check('sesión a la tesorería con memo met:<slug>', sess?.body?.account === TREASURY.publicKey() && sess?.body?.memo === 'met:inp001' && sess?.body?.memo_type === 'text');
    t.check('escenario de la tarjeta enviado a simulate-payment', log.find((l) => l.path.endsWith('simulate-payment'))?.body?.scenario === 'approved');
    t.check('el access_token ni la URL del widget llegan al navegador', !/at-inapp|tok-inapp|widget\.lendara/.test(JSON.stringify(r.body)));
    const ev = db.tables.order_events.find((e: any) => e.kind === 'card_session');
    t.check('id de Lendara + comprador (nombre, correo) en la bitácora del pedido', ev?.detail?.lendaraId === 'inapp-1' && ev?.detail?.mode === 'inapp' && ev?.detail?.buyer?.name === 'Ana Pérez' && ev?.detail?.buyer?.email === 'ana@example.com', JSON.stringify(ev?.detail));
    const again = await cardPay();
    t.check('idempotente: card_pay de nuevo con un cobro en curso -> pending, sin otra sesión', again.body?.pending === true && count('/v1/sessions') === 1);
    const p1 = await confirm();
    t.check('card_confirm mientras procesa -> pending', p1.code === 200 && p1.body?.pending === true);
    txs['inapp-1'].status = 'completed';
    const p2 = await confirm();
    t.check('card_confirm tras completed -> verifica Lendara + Horizon y fondea (PIN)', p2.code === 200 && p2.body?.pin === '654321' && funded.length === 1 && funded[0].lendaraId === 'inapp-1' && funded[0].lendaraTx === HASH, `${p2.code} ${JSON.stringify(p2.body)}`);
    const p3 = await cardPay();
    t.check('pedido pagado: card_pay -> 409, sin cobrar de nuevo', p3.code === 409 && count('/v1/sessions') === 1 && funded.length === 1); }

  { setup(); const r = await cardPay({ scenario: 'kyc_rejected' });
    t.check('kyc_rejected -> 402 "Tu tarjeta fue rechazada" + SINPE, sin fondeo', r.code === 402 && r.body?.code === 'card_kyc_rejected' && /Tu tarjeta fue rechazada/.test(r.body?.error) && /SINPE/.test(r.body?.error) && funded.length === 0, `${r.code} ${r.body?.error}`);
    const c = await confirm();
    t.check('card_confirm tras rechazo -> mismo error (estado error en Lendara)', c.code === 402 && c.body?.code === 'card_kyc_rejected');
    const retry = await cardPay({ scenario: 'approved' });
    t.check('tras un rechazo puede reintentar con otra tarjeta enseguida (nueva sesión)', retry.code === 200 && retry.body?.pending === true && count('/v1/sessions') === 2); }

  { setup(); const r = await cardPay({ scenario: 'payment_not_received' });
    t.check('payment_not_received -> expired -> 402 "No pudimos procesar el pago" + SINPE', r.code === 402 && r.body?.code === 'card_expired' && /No pudimos procesar el pago/.test(r.body?.error) && /SINPE/.test(r.body?.error), `${r.code} ${r.body?.error}`); }

  { setup(); const r = await cardPay({ scenario: 'delayed' });
    const c = await confirm();
    t.check('delayed -> pending en card_pay y en card_confirm', r.body?.pending === true && c.body?.pending === true && funded.length === 0);
    txs['inapp-1'].status = 'completed'; const c2 = await confirm();
    t.check('delayed -> luego completed -> fondea', c2.body?.pin === '654321' && funded.length === 1); }

  { setup(); const [a, b] = await Promise.all([cardPay(), cardPay()]);
    t.check('doble toque simultáneo: un solo cobro (simulate-payment una vez), ambos pending', a.body?.pending === true && b.body?.pending === true && count('/widget-api/transaction/simulate-payment') === 1, `${JSON.stringify(a.body)} ${JSON.stringify(b.body)} sim=${count('/widget-api/transaction/simulate-payment')}`); }

  { const db = setup(); lose['POST /widget-api/sessions'] = 1;
    const r = await cardPay();
    t.check('token consumido y respuesta perdida -> 502 claro, intento marcado abandonado, sin cobro', r.code === 502 && r.body?.code === 'card_provider_down' && /SINPE/.test(r.body?.error) && count('/widget-api/transaction/simulate-payment') === 0 && db.tables.order_events.some((e: any) => e.kind === 'card_abandoned'), `${r.code} ${r.body?.code}`);
    const c = await confirm();
    t.check('card_confirm tras intento abandonado -> error "No pudimos procesar" (no queda pending)', c.code === 402 && /No pudimos procesar/.test(c.body?.error), `${c.code} ${JSON.stringify(c.body)}`);
    const r2 = await cardPay();
    t.check('reintento tras abandono: crea otra sesión y cobra', r2.body?.pending === true && count('/v1/sessions') === 2 && count('/widget-api/transaction/simulate-payment') === 1); }

  { setup();
    const r1 = await cardPay({ cvc: '123' }); const r2 = await cardPay({ number: '4242424242424242' }); const r3 = await cardPay({ scenario: 'stolen' });
    const r4 = await cardPay({ email: 'no-es-correo' }); const r5 = await cardPay({}, KEY_B);
    t.check('el servidor rechaza cuerpos con número/CVC (nunca deben llegar) -> 400', r1.code === 400 && r2.code === 400 && !/123|4242/.test(JSON.stringify([r1.body, r2.body])));
    t.check('escenario desconocido -> 400 "Tarjeta no aceptada"; correo inválido -> 400', r3.code === 400 && /no aceptada/.test(r3.body?.error) && r4.code === 400);
    t.check('otro invitado -> 403', r5.code === 403);
    t.check('entradas inválidas: ninguna llamada a Lendara', log.length === 0, JSON.stringify(log.map((l) => l.path))); }

  { setup(); delete process.env.LENDARA_API_KEY; const r = await cardPay();
    t.check('sin LENDARA_API_KEY -> 503 card_unavailable', r.code === 503 && r.body?.code === 'card_unavailable'); process.env.LENDARA_API_KEY = 'lnd_test_ci'; }

  __setLendaraDepsForTests(null);
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}
