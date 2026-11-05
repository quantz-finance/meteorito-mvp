// (110) Límites de riesgo (api/_lib/risk.ts, migración 050).
//  - Tope por pedido y gasto del comprador en 24 h (fondeado / en curso, por momento de pago).
//  - Velocity (037 o conteo de filas), ráfaga, cuenta nueva, monto atípico.
//  - Un solo intento sobre un tope: 403 genérico, sin rb_. La ráfaga sí bloquea a la persona. La IP nunca.
//  - Publicar con la base caída: fail-closed. Pagar: fail-open. Ya fondeado o pasado escrow_creado: sin riesgo.
//  - app_flags.risk_limits / risk_blocks y env pisan los defaults. RISK_LIMITS_DISABLED=1 apaga todo.
import { readFileSync } from 'node:fs';
import { Horizon, Keypair } from '@stellar/stellar-sdk';
import type { T } from './setup';
import { installTestJwks, res, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { proofMessage } from '../../api/_lib/auth';
import { publicPrefix } from '../../api/_lib/photos';
import { __setHorizonForTests } from '../../api/_lib/wallet';
import { env } from '../../api/_lib/env';
import { guestSubFromReq } from '../../api/_lib/guest';
import { fakeDb } from './fakedb';
import create from '../../api/orders/create';
import pay from '../../api/escrow/pay';
import invites from '../../api/invites/index';
import { DEFAULT_RISK, RISK_DENIED, RISK_IP_FACTOR, blockKey } from '../../api/_lib/risk';

const rd = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const LEAK = /risk_|fraude|at[ií]pic|velocity|burst|bloque|l[ií]mite|flag|score|hmac|\brb_/i;
const GUEST = 'a'.repeat(64);
const IP = '203.0.113.44';
const nowIso = () => new Date().toISOString();
const signProof = (kp: Keypair) => {
  const ts = Math.floor(Date.now() / 1000); const message = proofMessage('create', 'new', kp.publicKey(), ts);
  const pre = Buffer.concat([Buffer.from('Cavos Signed Message:\n'), Buffer.from(String(Buffer.byteLength(message))), Buffer.from('\n'), Buffer.from(message)]);
  return { address: kp.publicKey(), publicKey: kp.publicKey(), message, signature: kp.sign(pre).toString('base64') };
};
const photo = (sub: string) => publicPrefix(sub) + 'listing-44444444-4444-4444-8444-444444444444/0.jpg';
const readyHorizon = () => ({ loadAccount: async (a: string) => ({ id: a, balances: [{ asset_code: 'USDC', asset_issuer: env.usdcIssuer() }] }) });
function callCreate(sub: string, kp: Keypair, price: number, headers: Record<string, string> = {}) {
  return (async () => {
    const r = res();
    await create({ method: 'POST', headers: { authorization: `Bearer ${await token({ sub })}`, ...headers }, body: { proof: signProof(kp), title: 'Bici de montaña', price_crc: price, photos: [photo(sub)] }, query: {} }, r);
    return r;
  })();
}
const guestPay = async (dbSlug: string, step: string, key = GUEST, extra: Record<string, string> = {}) => {
  const r = res();
  await pay({ method: 'POST', headers: { 'x-guest-key': key, ...extra }, body: { slug: dbSlug, step }, query: {} }, r);
  return r;
};
const flag = (db: ReturnType<typeof fakeDb>, key: string, value: unknown) => { db.tables.app_flags ??= []; db.tables.app_flags.push({ key, value }); };
const blocks = (db: ReturnType<typeof fakeDb>) => (db.tables.app_flags ?? []).filter((r: any) => String(r.key).startsWith('rb_'));
const generic = (r: any) => r.code === 403 && r.body?.error === RISK_DENIED && r.body?.code === 'unavailable' && Object.keys(r.body).length === 2 && !LEAK.test(JSON.stringify(r.body)) && !('retryAfter' in r.body);
function withRpc(db: ReturnType<typeof fakeDb>) {
  const hits = new Map<string, number>();
  (db as any).rpc = async (fn: string, a: any) => {
    if (fn !== 'rate_limit_hit') return { data: null, error: { code: '42883', message: 'no existe' } };
    const n = (hits.get(a.p_key) ?? 0) + 1; hits.set(a.p_key, n);
    return { data: [{ allowed: n <= a.p_max, hit_count: n, retry_after_s: 5 }], error: null };
  };
  return hits;
}
function flagsDown(code = '08006') {
  const db = fakeDb(); const orig = db.from;
  (db as any).from = (t: string) => {
    if (t !== 'app_flags') return orig(t);
    const q: any = { select() { return q; }, in() { return q; }, eq() { return q; }, gte() { return q; }, limit() { return q; },
      maybeSingle: async () => ({ data: null, error: { code, message: 'db down' } }),
      then: (ok: any) => Promise.resolve({ data: null, error: { code, message: 'db down' } }).then(ok) };
    return q;
  };
  return db;
}
const ENV = ['RISK_LIMITS_DISABLED', 'RISK_MAX_ORDER_CRC', 'RISK_MAX_DAILY_CRC', 'RISK_ORDERS_PER_HOUR', 'RISK_PAYS_PER_HOUR', 'RISK_NEW_ACCOUNT_HOURS', 'RISK_NEW_ACCOUNT_MAX_CRC', 'RISK_ATYPICAL_CRC', 'RISK_BURST_COUNT', 'RISK_BURST_WINDOW_SEC', 'RISK_BLOCK_HOURS'];

export async function run(t: T) {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  const warn = console.warn;
  const logs: string[] = [];
  console.warn = (...a: any[]) => { logs.push(a.map(String).join(' ')); warn.apply(console, a as any); };
  __setHorizonForTests(readyHorizon);
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  try {
    const sql = rd('supabase/migrations/050_risk_flags.sql');
    const seed = sql.match(/'risk_limits',\s*'(\{.*?\})'::jsonb/);
    const parsed = seed ? JSON.parse(seed[1]) : null;
    const same = !!parsed && (Object.keys(DEFAULT_RISK) as (keyof typeof DEFAULT_RISK)[]).every((k) => parsed[k] === DEFAULT_RISK[k]) && Object.keys(parsed).length === Object.keys(DEFAULT_RISK).length;
    t.check('050: siembra risk_limits = defaults del código y risk_blocks vacío', same && sql.includes('{"subjects":[]}'));
    t.check('050: avisa que no la aplica el deploy y nombra a Vitalik; índices por persona', /NO la aplica el deploy/.test(sql) && /Vitalik/.test(sql) && /orders_seller_user_created_idx/.test(sql) && /orders_buyer_user_created_idx/.test(sql) && /invitations_buyer_idx/.test(sql));
    t.check('create, invites y pay llaman a assertRisk', ['api/orders/create.ts', 'api/invites/index.ts', 'api/escrow/pay.ts'].every((f) => rd(f).includes('assertRisk(')));
    const doc = rd('docs/riesgo.md');
    t.check('el mensaje al cliente no describe el motivo', !LEAK.test(RISK_DENIED) && doc.includes(RISK_DENIED));
    t.check('pay solo evalúa los pasos que inician un pago', /const PAY_START = new Set\(\['start', 'confirm_sinpe', 'card_pay', 'fund_direct'\]\)/.test(rd('api/escrow/pay.ts')));
    t.check('el sondeo del cliente se corta con unavailable', rd('components/CryptoSheet.tsx').includes("e?.code === 'unavailable'") && rd('components/PayBox.tsx').includes("e?.code === 'unavailable'"));
    t.check('docs: gasto por funded_at y el invitado es mejor esfuerzo', doc.includes('funded_at') && doc.includes('mejor esfuerzo'));

    const kp = Keypair.random(); const other = Keypair.random();
    // Camino permitido: un precio de todos los días publica.
    let db = fakeDb(); __setDbForTests(db as any);
    let r = await callCreate('seller1', kp, 85_000);
    t.check('permitido: ₡85 000 publica (200) y no bloquea', r.code === 200 && /^[a-z0-9]{6}$/.test(r.body?.slug) && blocks(db).length === 0, `${r.code} ${r.body?.error}`);

    // Tope por pedido: rechaza ese intento y no deja un bloqueo de 24 h ni liga la wallet.
    db = fakeDb(); __setDbForTests(db as any);
    r = await callCreate('seller1', kp, 6_000_000);
    t.check('tope por pedido: ₡6 000 000 -> 403 genérico, sin fila y sin rb_', generic(r) && db.tables.orders.length === 0 && blocks(db).length === 0 && !(db.tables.user_wallets ?? []).some((w: any) => w.sub === 'seller1'), `${r.code} ${JSON.stringify(r.body)} ${JSON.stringify(blocks(db))}`);
    t.check('el log anota risk_limit y no el monto en la respuesta', logs.some((l) => l.includes('risk_limit') && l.includes('order_amount')) && !JSON.stringify(r.body).includes('6000000'));
    r = await callCreate('seller1', kp, 85_000);
    t.check('un solo intento sobre el tope no deja bloqueada a la persona', r.code === 200 && db.tables.orders.length === 1, `${r.code} ${r.body?.error}`);
    r = await callCreate('seller2', other, 85_000);
    t.check('otra persona también publica', r.code === 200 && db.tables.orders.length === 2, `${r.code} ${r.body?.error}`);

    // Tope del día.
    db = fakeDb(); __setDbForTests(db as any);
    flag(db, 'risk_limits', { ...DEFAULT_RISK, max_daily_crc: 10_000 });
    db.tables.orders.push({ id: 'd1', seller_user_id: 'day1', price_crc: 8_000, created_at: nowIso(), status: 'creado', slug: 'day001' });
    const dayKp = Keypair.random();
    r = await callCreate('day1', dayKp, 1_500);
    t.check('dentro del tope del día -> 200', r.code === 200, `${r.code} ${r.body?.error}`);
    r = await callCreate('day1', dayKp, 3_000);
    t.check('suma del día vencida -> 403 sin bloqueo persistente', generic(r) && blocks(db).length === 0, `${r.code} ${JSON.stringify(blocks(db))}`);

    // Velocity por filas (sin 037) y ráfaga.
    db = fakeDb(); __setDbForTests(db as any);
    flag(db, 'risk_limits', { ...DEFAULT_RISK, orders_per_hour: 3, burst_count: 100 });
    for (let i = 0; i < 3; i++) db.tables.orders.push({ id: `v${i}`, seller_user_id: 'vel1', price_crc: 1_000, created_at: nowIso(), status: 'creado', slug: `vel00${i}` });
    r = await callCreate('vel1', Keypair.random(), 5_000);
    t.check('velocity por filas: el pedido 4 de la hora -> 403 sin rb_', generic(r) && blocks(db).length === 0, `${r.code} ${JSON.stringify(blocks(db))}`);
    db = fakeDb(); __setDbForTests(db as any);
    flag(db, 'risk_limits', { ...DEFAULT_RISK, orders_per_hour: 100, burst_count: 8 });
    for (let i = 0; i < 8; i++) db.tables.orders.push({ id: `b${i}`, seller_user_id: 'bur1', price_crc: 1_000, created_at: nowIso(), status: 'creado', slug: `bur00${i}` });
    r = await callCreate('bur1', Keypair.random(), 5_000);
    t.check('ráfaga: 8 en la ventana, el siguiente -> 403 burst', generic(r) && blocks(db).some((b: any) => b.value?.reason === 'burst'), `${r.code} ${JSON.stringify(blocks(db).map((b: any) => b.value?.reason))}`);

    // Velocity persistente (037) + IP, sin guardar la IP.
    db = fakeDb(); __setDbForTests(db as any); withRpc(db);
    flag(db, 'risk_limits', { ...DEFAULT_RISK, orders_per_hour: 2, burst_count: 100, new_account_max_crc: 50_000_000, atypical_crc: 50_000_000 });
    const vk = Keypair.random();
    r = await callCreate('rpc1', vk, 5_000);
    const r2 = await callCreate('rpc1', vk, 5_000);
    const r3 = await callCreate('rpc1', vk, 5_000);
    t.check('037: dos pedidos pasan y el tercero -> 403', r.code === 200 && r2.code === 200 && generic(r3), `${r.code} ${r2.code} ${r3.code} ${r3.body?.error}`);
    db = fakeDb(); __setDbForTests(db as any); withRpc(db);
    flag(db, 'risk_limits', { ...DEFAULT_RISK, orders_per_hour: 1, burst_count: 100, new_account_max_crc: 50_000_000, atypical_crc: 50_000_000 });
    let last: any = null; let allowed = 0;
    for (let i = 0; i < RISK_IP_FACTOR + 1; i++) { last = await callCreate(`ip${i}`, Keypair.random(), 5_000, { 'x-forwarded-for': IP }); if (last.code === 200) allowed++; }
    const dumped = JSON.stringify(db.tables) + logs.join('\n');
    t.check('IP: 4 personas pasan y la siguiente -> 403, sin bloqueo de IP ni de persona', allowed === RISK_IP_FACTOR && generic(last) && !dumped.includes(IP) && blocks(db).length === 0, `allowed=${allowed} ${last.code} ${last.body?.error} rb=${blocks(db).length}`);
    const otherIp = await callCreate('ipfresh', Keypair.random(), 5_000, { 'x-forwarded-for': '198.51.100.7' });
    t.check('otra IP no hereda un bloqueo', otherIp.code === 200 && !JSON.stringify(db.tables).includes('198.51.100.7'), `${otherIp.code} ${otherIp.body?.error}`);

    // Señales.
    db = fakeDb(); __setDbForTests(db as any);
    const fresh = Keypair.random();
    db.tables.user_wallets = [{ sub: 'fresh1', wallet_address: fresh.publicKey(), created_at: nowIso() }];
    flag(db, 'risk_limits', { ...DEFAULT_RISK, atypical_crc: 50_000_000 });
    r = await callCreate('fresh1', fresh, 2_000_000);
    t.check('cuenta nueva y monto alto -> 403, sin bloqueo por un solo intento', generic(r) && blocks(db).length === 0 && logs.some((l) => l.includes('risk_signal') && l.includes('new_account')), `${r.code} ${JSON.stringify(blocks(db))}`);
    r = await callCreate('fresh1', fresh, 85_000);
    t.check('la cuenta nueva puede publicar un monto menor enseguida', r.code === 200, `${r.code} ${r.body?.error}`);
    db = fakeDb(); __setDbForTests(db as any);
    const old = Keypair.random();
    db.tables.user_wallets = [{ sub: 'old1', wallet_address: old.publicKey(), created_at: new Date(Date.now() - 40 * 86_400_000).toISOString() }];
    logs.length = 0;
    r = await callCreate('old1', old, 2_500_000);
    t.check('monto atípico en cuenta con historia -> 200, solo se anota', r.code === 200 && blocks(db).length === 0 && logs.some((l) => l.includes('risk_signal') && l.includes('atypical') && l.includes('"decision":"allow"')), `${r.code} ${r.body?.error} ${logs.filter((l) => l.includes('[risk]')).join(' | ')}`);

    // Lista manual, bloqueo vencido y apagado.
    db = fakeDb(); __setDbForTests(db as any);
    flag(db, 'risk_blocks', { subjects: ['listed'] });
    r = await callCreate('listed', Keypair.random(), 5_000);
    t.check('lista manual -> 403', generic(r) && db.tables.orders.length === 0, `${r.code}`);
    db = fakeDb(); __setDbForTests(db as any);
    const exp = Keypair.random();
    flag(db, blockKey('expired1'), { until: new Date(Date.now() - 60_000).toISOString(), reason: 'velocity' });
    r = await callCreate('expired1', exp, 5_000);
    t.check('bloqueo vencido no estorba y la fila rb_ se borra', r.code === 200 && blocks(db).length === 0, `${r.code} ${r.body?.error} ${JSON.stringify(blocks(db))}`);
    db = fakeDb(); __setDbForTests(db as any);
    flag(db, 'risk_limits', { enabled: false });
    r = await callCreate('off1', Keypair.random(), 6_000_000);
    t.check('risk_limits.enabled false deja pasar el monto alto', r.code === 200, `${r.code} ${r.body?.error}`);
    db = fakeDb(); __setDbForTests(db as any);
    process.env.RISK_MAX_ORDER_CRC = '10000';
    r = await callCreate('env1', Keypair.random(), 85_000);
    delete process.env.RISK_MAX_ORDER_CRC;
    t.check('env RISK_MAX_ORDER_CRC pisa el default', generic(r), `${r.code} ${r.body?.error}`);

    // Fail-closed y la salida de emergencia.
    db = flagsDown('08006'); __setDbForTests(db as any);
    r = await callCreate('down1', Keypair.random(), 5_000);
    t.check('base caída al leer flags -> 403, sin el error interno', generic(r) && !/08006|db down/.test(JSON.stringify(r.body)), `${r.code} ${JSON.stringify(r.body)}`);
    db = flagsDown('42P01'); __setDbForTests(db as any);
    r = await callCreate('miss1', Keypair.random(), 5_000);
    t.check('sin tabla app_flags (027) el default deja pasar un monto normal', r.code === 200, `${r.code} ${r.body?.error}`);
    db = flagsDown('08006'); __setDbForTests(db as any);
    process.env.RISK_LIMITS_DISABLED = '1';
    r = await callCreate('skip1', Keypair.random(), 6_000_000);
    delete process.env.RISK_LIMITS_DISABLED;
    t.check('RISK_LIMITS_DISABLED=1 deja pasar aunque la base no responda', r.code === 200, `${r.code} ${r.body?.error}`);

    // Pago: rechazar antes de fondear. Un solo exceso no deja bloqueo.
    const guest = guestSubFromReq({ headers: { 'x-guest-key': GUEST } })!;
    db = fakeDb(); __setDbForTests(db as any);
    db.tables.orders.push({ id: '11111111-1111-4111-8111-111111111111', slug: 'payhi1', status: 'creado', seller_user_id: 'seller', seller_address: 'GSELLER', price_crc: 6_000_000 });
    r = await guestPay('payhi1', 'start');
    t.check('pagar sobre el tope -> 403, evento risk_limit, sin contrato ni rb_', generic(r) && !db.tables.orders[0].contract_id && blocks(db).length === 0 && db.tables.order_events.some((e: any) => e.kind === 'risk_limit' && e.detail?.reason === 'order_amount' && !JSON.stringify(e).includes(GUEST)), `${r.code} ${JSON.stringify(r.body)} ${JSON.stringify(db.tables.order_events)}`);
    db.tables.orders.push({ id: '22222222-2222-4222-8222-222222222222', slug: 'paylo1', status: 'escrow_creado', seller_user_id: 'seller', buyer_user_id: 'guest:other', seller_address: 'GSELLER', price_crc: 5_000, contract_id: 'CALREADY', amount_usdc: 1 });
    r = await guestPay('paylo1', 'start');
    t.check('el mismo invitado no quedó bloqueado (sigue hasta el dueño del pedido)', r.code === 403 && r.body?.error === 'este pedido ya tiene comprador' && !generic(r), `${r.code} ${r.body?.error}`);

    db = fakeDb(); __setDbForTests(db as any);
    const buyer = Keypair.random();
    db.tables.orders.push({ id: '33333333-3333-4333-8333-333333333333', slug: 'payok1', status: 'creado', seller_user_id: 'seller', seller_address: Keypair.random().publicKey(), price_crc: 5_000 });
    __setHorizonForTests(() => ({ loadAccount: async () => { throw Object.assign(new Error('not found'), { name: 'NotFoundError', response: { status: 404 } }); } }));
    const ts = Math.floor(Date.now() / 1000); const message = proofMessage('pay', 'payok1', buyer.publicKey(), ts);
    const pre = Buffer.concat([Buffer.from('Cavos Signed Message:\n'), Buffer.from(String(Buffer.byteLength(message))), Buffer.from('\n'), Buffer.from(message)]);
    const proof = { address: buyer.publicKey(), publicKey: buyer.publicKey(), message, signature: buyer.sign(pre).toString('base64') };
    r = res(); await pay({ method: 'POST', headers: { authorization: `Bearer ${await token({ sub: 'buyer-ok' })}` }, body: { slug: 'payok1', step: 'start', proof }, query: {} }, r);
    __setHorizonForTests(readyHorizon);
    t.check('pago dentro del tope sigue de largo (409: falta activar la cuenta del comprador)', r.code === 409 && r.body?.code === 'buyer_wallet_not_ready' && blocks(db).length === 0, `${r.code} ${r.body?.error} ${r.body?.code}`);

    db = fakeDb(); __setDbForTests(db as any);
    db.tables.orders.push({ id: '44444444-4444-4444-8444-444444444444', slug: 'paycf1', status: 'escrow_creado', seller_user_id: 'seller', buyer_user_id: guest, seller_address: 'GSELLER', price_crc: 5_000, contract_id: 'CNOTUSED', amount_usdc: 1 });
    flag(db, 'risk_blocks', { subjects: [guest] });
    r = await guestPay('paycf1', 'confirm_sinpe');
    t.check('confirm_sinpe de alguien en la lista no fondea', generic(r) && (db.tables.ramp_mock_payments ?? []).length === 0 && db.tables.orders[0].status === 'escrow_creado', `${r.code} ${r.body?.error}`);

    // Ya fondeado (sin price_crc) o pasado de escrow_creado: el webhook duplicado no es 403 de riesgo.
    db = fakeDb(); __setDbForTests(db as any);
    const fundedTx = 'ab'.repeat(32);
    db.tables.orders.push({ id: '55555555-5555-4555-8555-555555555555', slug: 'paydup', status: 'fondeado', buyer_user_id: guest, seller_user_id: 'seller', funded_tx: fundedTx, contract_id: 'CNOTUSED', amount_usdc: 1 });
    flag(db, 'risk_blocks', { subjects: [guest] });
    r = await guestPay('paydup', 'confirm_sinpe');
    t.check('confirm_sinpe duplicado (ya fondeado, sin price_crc, en la lista) -> 200', r.code === 200 && r.body?.fundedTx === fundedTx && r.body?.pin === null, `${r.code} ${JSON.stringify(r.body)}`);
    r = await guestPay('paydup', 'card_confirm');
    t.check('card_confirm de un pedido ya fondeado no evalúa riesgo', r.code === 200 && r.body?.fundedTx === fundedTx, `${r.code} ${JSON.stringify(r.body)}`);
    db.tables.orders.push({ id: '66666666-6666-4666-8666-666666666666', slug: 'payold', status: 'enviado', buyer_user_id: guest, seller_user_id: 'seller', contract_id: 'CNOTUSED', amount_usdc: 1 });
    r = await guestPay('payold', 'confirm_sinpe');
    t.check('confirm_sinpe pasado escrow_creado no es 403 de riesgo', r.code === 409 && r.body?.code !== 'unavailable', `${r.code} ${r.body?.code} ${r.body?.error}`);

    // Reabrir un escrow ya creado no suma velocity.
    db = fakeDb(); __setDbForTests(db as any);
    const hits = withRpc(db);
    flag(db, 'risk_limits', { ...DEFAULT_RISK, pays_per_hour: 1, burst_count: 100, new_account_max_crc: 50_000_000, atypical_crc: 50_000_000 });
    db.tables.orders.push({ id: '77777777-7777-4777-8777-777777777777', slug: 'payre1', status: 'escrow_creado', buyer_user_id: 'guest:other', seller_user_id: 'seller', price_crc: 5_000, contract_id: 'CREOPEN', amount_usdc: 1 });
    await guestPay('payre1', 'start'); await guestPay('payre1', 'start');
    // La ruta suma una llave (escrow.pay). El riesgo no debe sumar las suyas: serían cuatro más.
    t.check('start con contract_id no suma velocity de riesgo', hits.size === 1, `hits=${hits.size}`);

    // Gasto 24 h del comprador: funded_at / evento, no created_at, sin start abandonado ni invitación.
    db = fakeDb(); __setDbForTests(db as any);
    flag(db, 'risk_limits', { ...DEFAULT_RISK, max_daily_crc: 10_000, new_account_max_crc: 50_000_000, atypical_crc: 50_000_000 });
    const oldCreated = new Date(Date.now() - 5 * 86_400_000).toISOString();
    db.tables.orders.push(
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', slug: 'aban01', buyer_user_id: guest, price_crc: 9_000, status: 'creado', created_at: nowIso() },
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', slug: 'fund01', buyer_user_id: guest, price_crc: 8_000, status: 'fondeado', created_at: oldCreated, funded_at: nowIso(), funded_tx: 'cd'.repeat(32) },
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', slug: 'prog01', buyer_user_id: guest, price_crc: 1_500, status: 'escrow_creado', contract_id: 'C', created_at: nowIso() },
    );
    db.tables.invitations = [{ code: 'invabc1', buyer_user_id: guest, price_crc: 9_000, created_at: nowIso(), status: 'abierta' }];
    db.tables.orders.push({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', slug: 'payday', status: 'escrow_creado', buyer_user_id: 'guest:other', seller_user_id: 'seller', price_crc: 1_000, contract_id: 'CX', amount_usdc: 1 });
    r = await guestPay('payday', 'start');
    t.check('gasto: fondeado por funded_at + en curso; no el abandonado ni la invitación', generic(r), `${r.code} ${r.body?.error}`);
    db.tables.orders = db.tables.orders.filter((o: any) => o.slug !== 'fund01');
    r = await guestPay('payday', 'start');
    t.check('sin el fondeo de hoy el mismo monto no llega al tope', r.code === 403 && r.body?.error === 'este pedido ya tiene comprador', `${r.code} ${r.body?.error}`);
    db = fakeDb(); __setDbForTests(db as any);
    flag(db, 'risk_limits', { ...DEFAULT_RISK, max_daily_crc: 10_000, new_account_max_crc: 50_000_000, atypical_crc: 50_000_000 });
    db.tables.orders.push(
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', slug: 'evold1', buyer_user_id: guest, price_crc: 9_000, status: 'escrow_creado', contract_id: 'CE', created_at: oldCreated },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', slug: 'evpay1', status: 'escrow_creado', buyer_user_id: 'guest:other', seller_user_id: 'seller', price_crc: 2_000, contract_id: 'CY', amount_usdc: 1 },
    );
    db.tables.order_events.push({ order_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', kind: 'escrow_deployed', created_at: nowIso(), detail: {} });
    r = await guestPay('evpay1', 'start');
    t.check('en curso viejo cuenta por el evento escrow_deployed, no por created_at', generic(r), `${r.code} ${r.body?.error}`);

    // Pago con la base caída: no 403 de riesgo (el dinero en curso no se traba).
    db = flagsDown('08006'); __setDbForTests(db as any);
    db.tables.orders.push({ id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', slug: 'paydwn', status: 'escrow_creado', buyer_user_id: 'guest:other', seller_user_id: 'seller', price_crc: 5_000, contract_id: 'CD', amount_usdc: 1 });
    r = await guestPay('paydwn', 'start');
    t.check('pago con la base caída no es 403 de riesgo', r.code === 403 && r.body?.error === 'este pedido ya tiene comprador' && r.body?.code !== 'unavailable', `${r.code} ${r.body?.code} ${r.body?.error}`);

    // blockFor tiene tope de tiempo: un upsert colgado no deja el request esperando.
    db = fakeDb(); __setDbForTests(db as any);
    const origFrom = db.from.bind(db);
    db.from = (t: string) => { const q = origFrom(t); if (t === 'app_flags') q.upsert = () => new Promise(() => {}); return q; };
    flag(db, 'risk_limits', { ...DEFAULT_RISK, orders_per_hour: 100, burst_count: 2, new_account_max_crc: 50_000_000, atypical_crc: 50_000_000 });
    db.tables.orders.push(
      { id: 'bto1', seller_user_id: 'hang1', price_crc: 1_000, created_at: nowIso(), status: 'creado', slug: 'hang01' },
      { id: 'bto2', seller_user_id: 'hang1', price_crc: 1_000, created_at: nowIso(), status: 'creado', slug: 'hang02' },
    );
    const hung = await Promise.race([
      callCreate('hang1', Keypair.random(), 5_000),
      new Promise<any>((ok) => setTimeout(() => ok({ code: 0, body: { error: 'hang' } }), 5000)),
    ]);
    t.check('blockFor con la base colgada igual responde 403', generic(hung), `${hung.code} ${hung.body?.error}`);

    // Invitación: mismo tope por pedido, sin bloqueo persistente.
    db = fakeDb(); __setDbForTests(db as any);
    r = res(); await invites({ method: 'POST', headers: { 'x-guest-key': GUEST }, body: { op: 'create', title: 'Bici de montaña', price_crc: 18_000 }, query: {} }, r);
    t.check('invitación dentro del tope -> 200', r.code === 200 && (db.tables.invitations ?? []).length === 1, `${r.code} ${r.body?.error}`);
    db = fakeDb(); __setDbForTests(db as any);
    r = res(); await invites({ method: 'POST', headers: { 'x-guest-key': GUEST }, body: { op: 'create', title: 'Bici de montaña', price_crc: 6_000_000 }, query: {} }, r);
    t.check('invitación sobre el tope -> 403 y no se guarda', generic(r) && (db.tables.invitations ?? []).length === 0, `${r.code} ${JSON.stringify(r.body)}`);
  } finally {
    console.warn = warn;
    __setDbForTests(null);
    __setHorizonForTests(() => new Horizon.Server(env.horizon()));
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
