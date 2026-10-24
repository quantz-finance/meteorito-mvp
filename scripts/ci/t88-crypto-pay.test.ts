// (88) Pago con cripto (USDC o XLM en Stellar testnet): crypto_quote / crypto_status en /api/escrow/pay. Sin red: Horizon simulado;
// el fondeo del escrow (mockRampFund on-chain), la conversión XLM->USDC y las devoluciones se reemplazan por dobles.
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import type { T } from './setup';
import { req, res } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { fakeDb } from './fakedb';
import { guestSubFromReq } from '../../api/_lib/guest';
import { __setCryptoDepsForTests, cryptoCronPass, cryptoMemo, sep7Pay } from '../../api/_lib/crypto';
import pay from '../../api/escrow/pay';

const KEY_A = 'c'.repeat(64), KEY_B = 'd'.repeat(64);
const TREASURY = Keypair.random().publicKey();
const BUYER = Keypair.random().publicKey();
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const withGuest = (r: any, key: string) => { r.headers = { 'x-guest-key': key }; return r; };

export async function run(t: T) {
  const subA = guestSubFromReq({ headers: { 'x-guest-key': KEY_A } })!;
  const created = '2026-10-24T10:00:00.000Z';
  const base = { id: '88888888-8888-4888-8888-888888888888', slug: 'cry001', contract_id: 'CESCROW', seller_user_id: 'seller', buyer_user_id: subA,
    seller_address: 'GSELLER', buyer_address: 'GPLATFORM', amount_usdc: 9.8336874, price_crc: 5000, sp_mode: 'seller', pin_attempts: 0, status: 'escrow_creado', created_at: created };

  let now = Date.parse('2026-10-24T10:05:00.000Z');
  let pays: any[] = []; let route: { source_amount: string; path: any[] } | null = { source_amount: '11.2000000', path: [] };
  let funded: any[] = []; let converts: any[] = []; let refunds: any[] = []; let convertFail = false; let spent: number | null = null; let seqs: Record<string, string> = { [BUYER]: '123' };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fakeFetch = async (url: any) => {
    const u = String(url);
    if (u.includes('/paths/strict-receive')) return reply(200, { _embedded: { records: route ? [{ source_asset_type: 'native', source_amount: route.source_amount, path: route.path }, { source_asset_type: 'native', source_amount: '99', path: [] }] : [] } });
    if (u.includes(`/accounts/${TREASURY}/payments`)) return reply(200, { _embedded: { records: [...pays].reverse() }, _links: { next: { href: '' } } });
    return reply(599, { error: 'unexpected ' + u });
  };
  let opId = 1;
  const payment = (asset: 'USDC' | 'XLM' | 'OTHER', amount: string, o: { memo?: string; from?: string; to?: string; type?: string; at?: string } = {}) => pays.push({
    id: String(opId++), type: o.type ?? 'payment', from: o.from ?? BUYER, to: o.to ?? TREASURY, amount, transaction_successful: true, transaction_hash: 'h'.repeat(63) + (opId % 10),
    created_at: o.at ?? new Date(now).toISOString(), ...(asset === 'XLM' ? { asset_type: 'native' } : { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: asset === 'USDC' ? ISSUER : 'GOTHERISSUERXXXX' }),
    transaction: { memo_type: 'text', memo: o.memo ?? cryptoMemo('cry001') } });

  const setup = (orders: any[] = [base]) => {
    const db = fakeDb(); __setDbForTests(db as any); orders.forEach((o) => db.tables.orders.push({ ...o }));
    pays = []; funded = []; converts = []; refunds = []; convertFail = false; spent = null; route = { source_amount: '11.2000000', path: [] };
    __setCryptoDepsForTests({
      fetch: fakeFetch as any, treasury: () => TREASURY, now: () => now,
      sequence: async (a) => seqs[a] ?? null,
      fund: async (orderId, meta) => {
        const o = db.tables.orders.find((x: any) => x.id === orderId);
        if (o.funded_tx) return { fundedTx: o.funded_tx, pin: null };
        funded.push({ orderId, meta }); Object.assign(o, { funded_tx: 'f'.repeat(64), status: 'fondeado' });
        db.tables.order_events.push({ order_id: orderId, kind: 'funded', detail: { ramp: 'mock', ...meta } });
        return { fundedTx: o.funded_tx, pin: '654321' };
      },
      convert: async (p) => { if (convertFail) throw new Error('op_over_source_max'); converts.push(p); return { hash: 'c'.repeat(64), xlmSpent: spent ?? Number(p.sendMax) }; },
      refund: async (p) => { refunds.push(p); return { hash: 'r'.repeat(64) }; },
    });
    return db;
  };
  const call = async (key: string, body: any) => { const r = res(); await pay(withGuest(req(null, body), key), r); return r; };
  const saved = Object.fromEntries(['TREASURY_SECRET', 'CRYPTO_PAY', 'CRYPTO_QUOTE_MINUTES', 'CRYPTO_XLM_SLIPPAGE'].map((k) => [k, process.env[k]]));
  Object.assign(process.env, { TREASURY_SECRET: Keypair.random().secret() }); delete process.env.CRYPTO_PAY; delete process.env.CRYPTO_QUOTE_MINUTES; delete process.env.CRYPTO_XLM_SLIPPAGE;
  try {
    // --- SEP-7
    { const u = sep7Pay({ destination: TREASURY, amount: '9.8336874', asset: 'USDC', memo: 'MET-CRY001', msg: 'Meteorito' });
      t.check('SEP-7 pay: destino, monto, USDC + emisor, memo de texto y red testnet', u.startsWith('web+stellar:pay?destination=' + TREASURY) && u.includes('amount=9.8336874') && u.includes('asset_code=USDC') && u.includes(`asset_issuer=${ISSUER}`) && u.includes('memo=MET-CRY001') && u.includes('memo_type=MEMO_TEXT') && u.includes('network_passphrase=' + encodeURIComponent(Networks.TESTNET)), u);
      const x = sep7Pay({ destination: TREASURY, amount: '11', asset: 'XLM', memo: 'MET-CRY001', msg: 'm' });
      t.check('SEP-7 pay XLM: sin asset_code (nativo)', !x.includes('asset_code') && x.includes('amount=11'), x); }

    // --- cotización USDC (invitado)
    { const db = setup();
      const r = await call(KEY_A, { slug: 'cry001', step: 'crypto_quote', asset: 'USDC', amount: 1 });
      t.check('USDC: monto exacto del pedido en DB (no del cliente), destino tesorería, memo MET-<PEDIDO>', r.code === 200 && r.body.amount === '9.8336874' && r.body.destination === TREASURY && r.body.memo === 'MET-CRY001' && r.body.issuer === ISSUER, `${r.code} ${JSON.stringify(r.body)}`);
      t.check('USDC: QR/deep link SEP-7 + vence en 15 min', /^web\+stellar:pay\?/.test(r.body.uri) && Date.parse(r.body.expiresAt) - now === 15 * 60_000, r.body.expiresAt);
      t.check('cotización guardada en la bitácora (sin migración)', db.tables.order_events.some((e: any) => e.kind === 'crypto_quote' && e.detail.asset === 'USDC'));
      const r2 = await call(KEY_B, { slug: 'cry001', step: 'crypto_quote', asset: 'USDC' });
      t.check('otro invitado -> 403', r2.code === 403, `${r2.code}`);
      const r3 = await call(KEY_A, { slug: 'cry001', step: 'crypto_quote', asset: 'BTC' });
      t.check('solo USDC o XLM -> 400 crypto_asset en español', r3.code === 400 && r3.body.code === 'crypto_asset' && /USDC o XLM/.test(r3.body.error), JSON.stringify(r3.body));
      db.tables.orders[0].status = 'creado';
      const r4 = await call(KEY_A, { slug: 'cry001', step: 'crypto_quote', asset: 'USDC' });
      t.check('sin escrow desplegado -> 409 crypto_state', r4.code === 409 && r4.body.code === 'crypto_state', JSON.stringify(r4.body)); }

    // --- cotización XLM
    { setup();
      const r = await call(KEY_A, { slug: 'cry001', step: 'crypto_quote', asset: 'XLM' });
      t.check('XLM: mejor ruta del DEX × (1 + 3 %) hacia arriba al stroop', r.code === 200 && r.body.amount === '11.5360000' && r.body.slippage === 0.03, `${r.code} ${JSON.stringify(r.body)}`);
      t.check('XLM: deep link sin USDC (paga XLM nativo), mismo memo', r.body.uri.includes('amount=11.5360000') && !r.body.uri.includes('asset_code') && r.body.memo === 'MET-CRY001');
      route = null;
      const r2 = await call(KEY_A, { slug: 'cry001', step: 'crypto_quote', asset: 'XLM' });
      t.check('sin ruta XLM->USDC -> 503 crypto_no_route (sugiere USDC o tarjeta)', r2.code === 503 && r2.body.code === 'crypto_no_route', JSON.stringify(r2.body)); }

    // --- path payment firmado por el wallet del comprador (SEP-7 tx)
    { setup();
      const r = await call(KEY_A, { slug: 'cry001', step: 'crypto_quote', asset: 'XLM', buyer: BUYER });
      const tx: any = TransactionBuilder.fromXDR(r.body.pathTx?.xdr ?? '', Networks.TESTNET); const op = tx.operations[0];
      t.check('XDR: un path payment strict-receive XLM -> USDC exacto a la tesorería, máximo = cotización', tx.source === BUYER && tx.operations.length === 1 && op.type === 'pathPaymentStrictReceive' && op.destination === TREASURY && op.destAmount === '9.8336874' && op.destAsset.code === 'USDC' && op.destAsset.issuer === ISSUER && op.sendAsset.isNative() && op.sendMax === '11.5360000', JSON.stringify(op));
      t.check('XDR: memo del pedido y vence con la cotización; deep link web+stellar:tx en testnet', tx.memo.value?.toString() === 'MET-CRY001' && Number(tx.timeBounds.maxTime) === Math.floor(Date.parse(r.body.expiresAt) / 1000) && /^web\+stellar:tx\?xdr=/.test(r.body.pathTx.uri) && r.body.pathTx.uri.includes('network_passphrase='), r.body.pathTx?.uri?.slice(0, 60));
      const bad = await call(KEY_A, { slug: 'cry001', step: 'crypto_quote', asset: 'XLM', buyer: 'GABC' });
      t.check('dirección inválida -> 400 crypto_address', bad.code === 400 && bad.body.code === 'crypto_address', JSON.stringify(bad.body));
      const none = await call(KEY_A, { slug: 'cry001', step: 'crypto_quote', asset: 'XLM', buyer: Keypair.random().publicKey() });
      t.check('cuenta que no existe en Stellar -> 400 crypto_no_account', none.code === 400 && none.body.code === 'crypto_no_account', JSON.stringify(none.body)); }

    // --- estado: esperando / vencido
    { setup();
      const r0 = await call(KEY_A, { slug: 'cry001', step: 'crypto_status' });
      t.check('sin cotización -> expired (no consulta Horizon)', r0.code === 200 && r0.body.state === 'expired', JSON.stringify(r0.body));
      await call(KEY_A, { slug: 'cry001', step: 'crypto_quote', asset: 'USDC' });
      const r = await call(KEY_A, { slug: 'cry001', step: 'crypto_status' });
      t.check('cotizado sin pago -> waiting', r.body.state === 'waiting' && funded.length === 0, JSON.stringify(r.body));
      payment('USDC', '9.8336874', { memo: 'MET-OTRO01' }); payment('OTHER', '9.8336874'); payment('USDC', '9.8336874', { from: TREASURY }); payment('USDC', '9.8336874', { at: '2026-10-24T09:00:00.000Z' });
      const r1 = await call(KEY_A, { slug: 'cry001', step: 'crypto_status' });
      t.check('ignora otro memo, otro emisor, la propia tesorería y pagos anteriores al pedido', r1.body.state === 'waiting' && funded.length === 0, JSON.stringify(r1.body));
      now += 16 * 60_000;
      const r2 = await call(KEY_A, { slug: 'cry001', step: 'crypto_status' });
      t.check('pasados 15 min sin pago -> expired (pide cotizar de nuevo)', r2.body.state === 'expired', JSON.stringify(r2.body));
      now -= 16 * 60_000; }

    // --- USDC exacto -> fondea (mismo camino que la tarjeta)
    { const db = setup(); await call(KEY_A, { slug: 'cry001', step: 'crypto_quote', asset: 'USDC' });
      payment('USDC', '9.8336874');
      const r = await call(KEY_A, { slug: 'cry001', step: 'crypto_status' });
      t.check('USDC exacto -> funded, PIN una vez, sin devoluciones', r.body.state === 'funded' && r.body.pin === '654321' && funded.length === 1 && refunds.length === 0, JSON.stringify(r.body));
      t.check('fondeo registra ramp=crypto, asset, wallet que pagó y el pago usado', funded[0].meta.ramp === 'crypto' && funded[0].meta.asset === 'USDC' && funded[0].meta.payer === BUYER && funded[0].meta.payIds.length === 1, JSON.stringify(funded[0].meta));
      t.check('lock de fondeo = fila en ramp_mock_payments (como SINPE/tarjeta)', db.tables.ramp_mock_payments.length === 1);
      const r2 = await call(KEY_A, { slug: 'cry001', step: 'crypto_status' });
      t.check('idempotente: no fondea de nuevo ni re-emite el PIN', r2.body.state === 'funded' && r2.body.pin == null && funded.length === 1 && refunds.length === 0, JSON.stringify(r2.body));
      payment('USDC', '9.8336874');
      const r3 = await call(KEY_A, { slug: 'cry001', step: 'crypto_status' });
      t.check('pago doble después de pagado -> se devuelve completo al mismo wallet', refunds.length === 1 && refunds[0].to === BUYER && refunds[0].amount === '9.8336874' && refunds[0].asset === 'USDC' && r3.body.state === 'funded', JSON.stringify(refunds));
      await call(KEY_A, { slug: 'cry001', step: 'crypto_status' });
      t.check('la devolución no se repite', refunds.length === 1, String(refunds.length)); }

    // --- USDC de menos: suma pagos
    { setup(); await call(KEY_A, { slug: 'cry001', step: 'crypto_quote', asset: 'USDC' });
      payment('USDC', '5');
      const r = await call(KEY_A, { slug: 'cry001', step: 'crypto_status' });
      t.check('USDC de menos -> underpaid con lo que falta, sin fondear', r.body.state === 'underpaid' && r.body.missing?.asset === 'USDC' && r.body.missing?.amount === '4.8336874' && funded.length === 0, JSON.stringify(r.body));
      payment('USDC', '4.8336874');
      const r2 = await call(KEY_A, { slug: 'cry001', step: 'crypto_status' });
      t.check('segundo pago completa -> funded con los dos pagos', r2.body.state === 'funded' && funded[0]?.meta.payIds.length === 2, JSON.stringify(r2.body)); }

    // --- USDC de más
    { setup(); await call(KEY_A, { slug: 'cry001', step: 'crypto_quote', asset: 'USDC' });
      payment('USDC', '12');
      const r = await call(KEY_A, { slug: 'cry001', step: 'crypto_status' });
      t.check('USDC de más -> funded + devuelve el excedente exacto al wallet que pagó', r.body.state === 'funded' && refunds.length === 1 && refunds[0].amount === '2.1663126' && refunds[0].to === BUYER && /MET-CRY001/.test(refunds[0].memo), JSON.stringify(refunds)); }

    // --- XLM suficiente: convierte y devuelve lo que sobró
    { const db = setup(); await call(KEY_A, { slug: 'cry001', step: 'crypto_quote', asset: 'XLM' });
      payment('XLM', '11.5360000'); spent = 11.21;
      const r = await call(KEY_A, { slug: 'cry001', step: 'crypto_status' });
      t.check('XLM -> la tesorería convierte a USDC exacto del pedido (máximo = XLM recibido)', converts.length === 1 && converts[0].usdc === '9.8336874' && converts[0].sendMax === '11.5360000' && converts[0].memo === 'MET-CRY001', JSON.stringify(converts));
      t.check('XLM -> funded (escrow en USDC) y devuelve el XLM que sobró', r.body.state === 'funded' && funded.length === 1 && funded[0].meta.asset === 'XLM' && funded[0].meta.convertTx && refunds.length === 1 && refunds[0].asset === 'XLM' && refunds[0].amount === '0.3260000', JSON.stringify({ b: r.body, refunds }));
      t.check('conversión registrada en la bitácora', db.tables.order_events.some((e: any) => e.kind === 'crypto_converted' && e.detail.xlmSpent === 11.21)); }

    // --- XLM de menos
    { const db = setup(); await call(KEY_A, { slug: 'cry001', step: 'crypto_quote', asset: 'XLM' });
      payment('XLM', '10');
      const r = await call(KEY_A, { slug: 'cry001', step: 'crypto_status' });
      t.check('XLM de menos -> underpaid con el XLM que falta (con colchón), sin convertir ni tomar el lock', r.body.state === 'underpaid' && r.body.missing?.asset === 'XLM' && r.body.missing?.amount === '1.5360000' && converts.length === 0 && db.tables.ramp_mock_payments.length === 0, JSON.stringify(r.body)); }

    // --- conversión falla (precio se movió): libera el lock, se puede reintentar
    { const db = setup(); await call(KEY_A, { slug: 'cry001', step: 'crypto_quote', asset: 'XLM' });
      payment('XLM', '11.5360000'); convertFail = true;
      const r = await call(KEY_A, { slug: 'cry001', step: 'crypto_status' });
      t.check('conversión fallida -> underpaid, sin fondear, lock liberado', r.body.state === 'underpaid' && funded.length === 0 && db.tables.ramp_mock_payments.length === 0, JSON.stringify(r.body));
      convertFail = false; payment('XLM', '1');
      const r2 = await call(KEY_A, { slug: 'cry001', step: 'crypto_status' });
      t.check('reintento con más XLM -> funded', r2.body.state === 'funded' && funded.length === 1, JSON.stringify(r2.body)); }

    // --- lock tomado por otro request
    { const db = setup(); await call(KEY_A, { slug: 'cry001', step: 'crypto_quote', asset: 'USDC' });
      db.tables.ramp_mock_payments.push({ order_id: base.id, amount_usdc: base.amount_usdc, state: 'pending' }); payment('USDC', '9.8336874');
      const r = await call(KEY_A, { slug: 'cry001', step: 'crypto_status' });
      t.check('fondeo en curso en otro request -> processing, sin fondear dos veces', r.body.state === 'processing' && funded.length === 0, JSON.stringify(r.body)); }

    // --- path payment del comprador llega como USDC
    { setup(); await call(KEY_A, { slug: 'cry001', step: 'crypto_quote', asset: 'XLM', buyer: BUYER });
      payment('USDC', '9.8336874', { type: 'path_payment_strict_receive' });
      const r = await call(KEY_A, { slug: 'cry001', step: 'crypto_status' });
      t.check('path payment del wallet del comprador (entrega USDC) -> funded sin conversión', r.body.state === 'funded' && converts.length === 0 && funded[0].meta.asset === 'USDC', JSON.stringify(r.body)); }

    // --- cron
    { const db = setup(); await call(KEY_A, { slug: 'cry001', step: 'crypto_quote', asset: 'USDC' });
      db.tables.order_events.forEach((e: any) => { e.created_at = new Date(now).toISOString(); });
      payment('USDC', '9.8336874');
      const out = await cryptoCronPass();
      t.check('cron: fondea un pedido pagado aunque el comprador cerró la pantalla', out.length === 1 && out[0].state === 'funded' && funded.length === 1, JSON.stringify(out)); }

    // --- start anuncia cripto; apagado con CRYPTO_PAY=0
    { setup(); process.env.CRYPTO_PAY = '0';
      const r = await call(KEY_A, { slug: 'cry001', step: 'crypto_quote', asset: 'USDC' });
      t.check('CRYPTO_PAY=0 -> 503 crypto_unavailable', r.code === 503 && r.body.code === 'crypto_unavailable', JSON.stringify(r.body));
      delete process.env.CRYPTO_PAY; }
  } finally {
    __setCryptoDepsForTests(null);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
