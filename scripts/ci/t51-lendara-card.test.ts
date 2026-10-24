// (51) Pago con tarjeta (Lendara, sandbox testnet): card_session / card_confirm en /api/escrow/pay. Sin red: Lendara y
// Horizon simulados; el fondeo del escrow (mockRampFund, on-chain) se reemplaza por un doble que avanza el pedido.
import { Keypair } from '@stellar/stellar-sdk';
import type { T } from './setup';
import { req, res } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { fakeDb } from './fakedb';
import { guestSubFromReq } from '../../api/_lib/guest';
import { __setLendaraDepsForTests, LENDARA_USDC_ISSUER, cardMemo } from '../../api/_lib/lendara';
import pay from '../../api/escrow/pay';

const KEY_A = 'a'.repeat(64), KEY_B = 'b'.repeat(64);
const TREASURY = Keypair.random();
const OTHER = Keypair.random().publicKey();
const withGuest = (r: any, key: string) => { r.headers = { 'x-guest-key': key }; return r; };
const HASH = 'ab'.repeat(32);

type Lnd = { status: string; amount_in?: string; to?: string; memo?: string; amount_out?: string; message?: string; asset?: string };
export async function run(t: T) {
  const subA = guestSubFromReq({ headers: { 'x-guest-key': KEY_A } })!;
  const base = { id: '66666666-6666-4666-8666-666666666666', slug: 'crd001', contract_id: 'CESCROW', seller_user_id: 'seller', buyer_user_id: subA,
    seller_address: 'GSELLER', buyer_address: 'GPLATFORM', amount_usdc: 9.83, price_crc: 5000, sp_mode: 'seller', pin_attempts: 0, status: 'escrow_creado' };
  const otherOrder = { ...base, id: '77777777-7777-4777-8777-777777777777', slug: 'crd002' };

  // Estado del doble de Lendara/Horizon
  let lnd: Record<string, Lnd> = {}; let sessions: any[] = []; let horizonTx: any = null; let horizonOps: any[] = []; let down = false; let sessionErr: { status: number; error: string } | null = null;
  let funded: any[] = []; let trust = 0;
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fakeFetch = async (url: any, init: any = {}) => {
    const u = String(url);
    if (down) throw new TypeError('fetch failed');
    if (u.startsWith('https://lendara.test')) {
      if (init.headers?.Authorization !== 'Bearer lnd_test_ci') return reply(401, { error: 'invalid API key' });
      if (u.endsWith('/v1/sessions') && init.method === 'POST') {
        if (sessionErr) return reply(sessionErr.status, { error: sessionErr.error });
        const b = JSON.parse(init.body); const id = `lnd-${sessions.length + 1}`; sessions.push({ id, body: b });
        lnd[id] = { status: 'incomplete' };
        return reply(201, { id, url: `https://widget.lendara.test/widget/${id}?token=x`, expires_at: new Date(Date.now() + 9e5).toISOString() });
      }
      const m = u.match(/\/v1\/transactions\/([^/?]+)$/);
      if (m) {
        const x = lnd[decodeURIComponent(m[1])]; if (!x) return reply(404, { error: 'not found' });
        const s = sessions.find((y) => y.id === m[1]);
        return reply(200, { id: m[1], kind: 'deposit', status: x.status, started_at: new Date().toISOString(), message: x.message,
          amount_in: x.amount_in ?? '5000', amount_in_asset: 'iso4217:CRC', amount_out: x.amount_out ?? '9.3039215', amount_out_asset: `stellar:USDC:${x.asset ?? LENDARA_USDC_ISSUER}`,
          to: x.to ?? s?.body.account, deposit_memo: x.memo ?? s?.body.memo, deposit_memo_type: 'text', stellar_transaction_id: x.status === 'completed' ? HASH : undefined });
      }
    }
    if (u.startsWith('https://horizon-testnet.stellar.org/transactions/')) {
      if (u.endsWith('/operations?limit=200') || u.includes('/operations')) return reply(200, { _embedded: { records: horizonOps } });
      return horizonTx ? reply(200, horizonTx) : reply(404, { title: 'Resource Missing' });
    }
    return reply(599, { error: 'unexpected ' + u });
  };
  const okHorizon = (memo: string, amount = '9.3039215', to = TREASURY.publicKey(), issuer = LENDARA_USDC_ISSUER) => {
    horizonTx = { hash: HASH, successful: true, memo_type: 'text', memo };
    horizonOps = [{ type: 'payment', transaction_successful: true, to, asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: issuer, amount }];
  };

  const setup = (orders: any[] = [base]) => {
    const db = fakeDb(); __setDbForTests(db as any); orders.forEach((o) => db.tables.orders.push({ ...o }));
    lnd = {}; sessions = []; horizonTx = null; horizonOps = []; down = false; sessionErr = null; funded = []; trust = 0;
    __setLendaraDepsForTests({
      fetch: fakeFetch as any,
      ensureTrustline: async () => { trust++; },
      fund: async (orderId: string, meta: any) => {
        const o = db.tables.orders.find((x: any) => x.id === orderId);
        if (o.funded_tx) return { fundedTx: o.funded_tx, pin: null };
        funded.push({ orderId, meta }); Object.assign(o, { funded_tx: 'f'.repeat(64), status: 'fondeado' }); return { fundedTx: o.funded_tx, pin: '123456' };
      },
    });
    return db;
  };
  const call = async (key: string, body: any) => { const r = res(); await pay(withGuest(req(null, body), key), r); return r; };
  // Restaurar al final: en CI TREASURY_SECRET es la tesorería real de testnet que usan los tests on-chain (t01…).
  const saved = Object.fromEntries(['LENDARA_API_KEY', 'LENDARA_API_URL', 'TREASURY_SECRET'].map((k) => [k, process.env[k]]));
  Object.assign(process.env, { LENDARA_API_KEY: 'lnd_test_ci', LENDARA_API_URL: 'https://lendara.test', TREASURY_SECRET: TREASURY.secret() });

  // --- sin configurar
  { setup(); delete process.env.LENDARA_API_KEY;
    const r = await call(KEY_A, { slug: 'crd001', step: 'card_session' });
    t.check('sin LENDARA_API_KEY -> 503 card_unavailable en español', r.code === 503 && r.body?.code === 'card_unavailable' && /tarjeta/.test(r.body?.error), `${r.code} ${r.body?.error}`);
    process.env.LENDARA_API_KEY = 'lnd_test_ci'; }

  // --- card_session
  { const db = setup();
    const r0 = await call(KEY_B, { slug: 'crd001', step: 'card_session' });
    t.check('otro invitado no crea sesión de tarjeta -> 403, sin llamar a Lendara', r0.code === 403 && sessions.length === 0, `${r0.code}`);
    db.tables.orders[0].status = 'creado';
    const r1 = await call(KEY_A, { slug: 'crd001', step: 'card_session' });
    t.check('pedido sin escrow desplegado -> 409, sin sesión', r1.code === 409 && sessions.length === 0, `${r1.code} ${r1.body?.error}`);
    db.tables.orders[0].status = 'escrow_creado';
    const r = await call(KEY_A, { slug: 'crd001', step: 'card_session' });
    const b = sessions[0]?.body ?? {};
    t.check('sesión creada: url del widget + id', r.code === 200 && /^https:\/\/widget\.lendara\.test\//.test(r.body?.url) && r.body?.sessionId === 'lnd-1', `${r.code} ${JSON.stringify(r.body)}`);
    t.check('destino = tesorería (G) + memo del pedido; CRC; monto = precio del pedido en DB', b.account === TREASURY.publicKey() && b.memo === cardMemo('crd001') && b.memo_type === 'text' && b.fiat_currency === 'CRC' && b.amount === '5000', JSON.stringify(b));
    t.check('trustline USDC de Lendara asegurada en la tesorería', trust === 1);
    t.check('sesión guardada en la bitácora del pedido', db.tables.order_events.some((e: any) => e.kind === 'card_session' && e.order_id === base.id && e.detail?.lendaraId === 'lnd-1'));
    t.check('el monto NO viene del cliente', (await call(KEY_A, { slug: 'crd001', step: 'card_session', amount: 1 }), sessions[1]?.body.amount === '5000'));
  }

  // --- aprobado (4242)
  { setup(); await call(KEY_A, { slug: 'crd001', step: 'card_session' });
    lnd['lnd-1'].status = 'completed'; okHorizon(cardMemo('crd001'));
    const r = await call(KEY_A, { slug: 'crd001', step: 'card_confirm' });
    t.check('aprobado: verifica Lendara + Horizon y fondea el escrow una vez; devuelve PIN', r.code === 200 && r.body?.pin === '123456' && funded.length === 1, `${r.code} ${JSON.stringify(r.body)}`);
    t.check('fondeo registra el pago con tarjeta (ramp=card, id Lendara, hash Stellar)', funded[0]?.meta?.ramp === 'card' && funded[0]?.meta?.lendaraId === 'lnd-1' && funded[0]?.meta?.lendaraTx === HASH, JSON.stringify(funded[0]?.meta));
    const r2 = await call(KEY_A, { slug: 'crd001', step: 'card_confirm' });
    t.check('idempotente: confirmar otra vez no fondea de nuevo ni re-emite el PIN', r2.code === 200 && r2.body?.pin == null && funded.length === 1, `${r2.code} ${JSON.stringify(r2.body)}`);
    const r3 = await call(KEY_A, { slug: 'crd001', step: 'card_session' });
    t.check('pedido ya pagado: no crea otra sesión de tarjeta', r3.code === 409 && sessions.length === 1, `${r3.code} ${r3.body?.error}`);
  }

  // --- KYC rechazado (…0002)
  { setup(); await call(KEY_A, { slug: 'crd001', step: 'card_session' });
    Object.assign(lnd['lnd-1'], { status: 'error', message: 'KYC rejected (sandbox scenario).' });
    const r = await call(KEY_A, { slug: 'crd001', step: 'card_confirm' });
    t.check('KYC rechazado -> card_kyc_rejected ("Tu tarjeta fue rechazada"), sin fondeo', r.code === 402 && r.body?.code === 'card_kyc_rejected' && /rechazada/.test(r.body?.error) && funded.length === 0, `${r.code} ${r.body?.code} ${r.body?.error}`); }

  // --- pago no recibido / vencido (…9995)
  { setup(); await call(KEY_A, { slug: 'crd001', step: 'card_session' });
    Object.assign(lnd['lnd-1'], { status: 'expired', message: 'Payment not received (sandbox scenario).' });
    const r = await call(KEY_A, { slug: 'crd001', step: 'card_confirm' });
    t.check('vencido -> card_expired, sin fondeo', r.code === 402 && r.body?.code === 'card_expired' && /tarjeta/.test(r.body?.error) && funded.length === 0, `${r.code} ${r.body?.code} ${r.body?.error}`);
    // Un intento fallido no bloquea un intento nuevo
    await call(KEY_A, { slug: 'crd001', step: 'card_session' }); lnd['lnd-2'].status = 'completed'; okHorizon(cardMemo('crd001'));
    const r2 = await call(KEY_A, { slug: 'crd001', step: 'card_confirm' });
    t.check('tras un intento vencido, un segundo intento aprobado sí fondea', r2.code === 200 && funded.length === 1 && funded[0].meta.lendaraId === 'lnd-2', `${r2.code} ${JSON.stringify(r2.body)}`); }

  // --- demorado (…0077): 30 s en pending_anchor
  { setup(); await call(KEY_A, { slug: 'crd001', step: 'card_session' });
    lnd['lnd-1'].status = 'pending_anchor';
    const r = await call(KEY_A, { slug: 'crd001', step: 'card_confirm' });
    t.check('demorado -> 200 pending, sin fondeo', r.code === 200 && r.body?.pending === true && funded.length === 0, `${r.code} ${JSON.stringify(r.body)}`);
    const rs = await call(KEY_A, { slug: 'crd001', step: 'card_session' });
    t.check('demorado: tocar "Pagar con tarjeta" otra vez no abre un pago nuevo (pending)', rs.code === 200 && rs.body?.pending === true && sessions.length === 1, `${rs.code} ${JSON.stringify(rs.body)}`);
    lnd['lnd-1'].status = 'completed'; okHorizon(cardMemo('crd001'));
    const r2 = await call(KEY_A, { slug: 'crd001', step: 'card_confirm' });
    t.check('demorado -> luego aprobado: fondea', r2.code === 200 && r2.body?.pin === '123456' && funded.length === 1); }

  // --- montos / destino / memo / Horizon que no cuadran
  const mismatch = async (name: string, f: () => void) => {
    setup(); await call(KEY_A, { slug: 'crd001', step: 'card_session' }); lnd['lnd-1'].status = 'completed'; okHorizon(cardMemo('crd001')); f();
    const r = await call(KEY_A, { slug: 'crd001', step: 'card_confirm' });
    t.check(name, r.code === 409 && r.body?.code === 'card_mismatch' && funded.length === 0, `${r.code} ${r.body?.code} ${r.body?.error}`);
  };
  await mismatch('monto distinto (₡4 000 por un pedido de ₡5 000) -> rechazado, sin fondeo', () => { lnd['lnd-1'].amount_in = '4000'; });
  await mismatch('destino distinto a la tesorería -> rechazado', () => { lnd['lnd-1'].to = OTHER; });
  await mismatch('memo de otro pedido -> rechazado', () => { lnd['lnd-1'].memo = cardMemo('crd002'); });
  await mismatch('activo de otro emisor -> rechazado', () => { lnd['lnd-1'].asset = OTHER; });
  await mismatch('Horizon: pago por otro monto -> rechazado', () => okHorizon(cardMemo('crd001'), '1.0000000'));
  await mismatch('Horizon: pago a otra cuenta -> rechazado', () => okHorizon(cardMemo('crd001'), '9.3039215', OTHER));
  await mismatch('Horizon: memo distinto -> rechazado', () => okHorizon(cardMemo('crd002')));
  await mismatch('Horizon: tx inexistente -> rechazado', () => { horizonTx = null; });
  await mismatch('Horizon: tx fallida -> rechazado', () => { horizonTx.successful = false; });

  // --- una sesión de otro pedido no sirve
  { const db = setup([base, otherOrder]); await call(KEY_A, { slug: 'crd001', step: 'card_session' }); lnd['lnd-1'].status = 'completed'; okHorizon(cardMemo('crd001'));
    const r = await call(KEY_A, { slug: 'crd002', step: 'card_confirm', sessionId: 'lnd-1' });
    t.check('el pago con tarjeta de un pedido no fondea otro pedido', r.code === 409 && funded.length === 0 && db.tables.orders[1].status === 'escrow_creado', `${r.code} ${r.body?.code}`); }

  // --- Lendara caída / monto fuera de límites
  { setup(); down = true;
    const r = await call(KEY_A, { slug: 'crd001', step: 'card_session' });
    t.check('Lendara no responde -> 502 card_provider_down, mensaje claro', r.code === 502 && r.body?.code === 'card_provider_down' && /SINPE/.test(r.body?.error), `${r.code} ${r.body?.error}`); }
  { setup(); sessionErr = { status: 400, error: 'amount is below the minimum' };
    const r = await call(KEY_A, { slug: 'crd001', step: 'card_session' });
    t.check('monto fuera de los límites del proveedor -> card_amount', r.code === 400 && r.body?.code === 'card_amount' && /monto/.test(r.body?.error), `${r.code} ${r.body?.error}`); }

  // --- sesión previa completada: card_session fondea directo
  { setup(); await call(KEY_A, { slug: 'crd001', step: 'card_session' }); lnd['lnd-1'].status = 'completed'; okHorizon(cardMemo('crd001'));
    const r = await call(KEY_A, { slug: 'crd001', step: 'card_session' });
    t.check('si un pago anterior ya se completó, "Pagar con tarjeta" fondea en vez de cobrar otra vez', r.code === 200 && r.body?.pin === '123456' && sessions.length === 1 && funded.length === 1, `${r.code} ${JSON.stringify(r.body)}`); }

  __setLendaraDepsForTests(null);
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}
