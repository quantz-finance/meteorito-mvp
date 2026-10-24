// (57) Plazo de protección acordado + entrega cara a cara + extensión de mutuo acuerdo (TDD). Sin red.
//  - El vendedor elige entrega (cara a cara / envío) y plazo (24 h a 30 días), validado en el servidor; defaults 24 h / 7 días.
//  - Sin la migración 017 el link se crea igual (sin las columnas) y rige el default.
//  - Cara a cara: sin envío; el PIN libera desde 'fondeado'; auto_release_at desde el pago. Envío: desde "Ya lo envié".
//  - Extensión +1/+3/+7 días: la otra parte acepta o rechaza; tope 30 días desde el pago; pendiente congela el auto-release
//    (hasta respuesta o 24 h); solo comprador y vendedor.
import { Keypair } from '@stellar/stellar-sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { T } from './setup';
import { baseEnv } from './setup';
import { installTestJwks, req, res, token } from './jwt';
import { fakeDb } from './fakedb';
import { __setDbForTests } from '../../api/_lib/db';
import { proofMessage } from '../../api/_lib/auth';
import { __setHorizonForTests } from '../../api/_lib/wallet';
import { env } from '../../api/_lib/env';
import { publicPrefix } from '../../api/_lib/photos';
import { guestSubFromReq } from '../../api/_lib/guest';
import { pinHash, __setChainForTests } from '../../api/_lib/escrow';
import { releaseDueAt } from '../../api/_lib/env';
import { validateAgreement, agreementSummary, protectionLabel, DEFAULT_PROTECTION_MIN } from '../../api/_lib/agreement';
import { extensionMessages } from '../../api/_lib/push';

const ROOT = join(__dirname, '../..');
const DAY = 86_400_000, MIN = 60_000;
const KEY = 'e'.repeat(64), OTHER = 'f'.repeat(64);

function sellerProof() {
  const kp = Keypair.random(); const ts = Math.floor(Date.now() / 1000);
  const message = proofMessage('create', 'new', kp.publicKey(), ts);
  const pre = Buffer.concat([Buffer.from('Cavos Signed Message:\n'), Buffer.from(String(Buffer.byteLength(message))), Buffer.from('\n'), Buffer.from(message)]);
  return { address: kp.publicKey(), publicKey: kp.publicKey(), message, signature: kp.sign(pre).toString('base64') };
}
function stubChain() {
  const calls: string[] = []; let approved = false;
  __setChainForTests({
    releaseGuard: async () => { calls.push('guard'); return { esc: null, disputed: false, released: false, resolved: false, approved } as any; },
    approveMilestone: async () => { calls.push('approve'); approved = true; return { hash: 'a'.repeat(64) } as any; },
    getBalance: async () => 1,
    releaseFunds: async () => { calls.push('release'); return { hash: 'r'.repeat(64) } as any; },
  });
  return calls;
}

export async function run(t: T) {
  baseEnv();
  process.env.APPROVER_SECRET ||= 'SBMUIURQN7BHVZ6QRNNIB3VIKUM3ZZ2UVHJDLRBVULXA2VTIZVOYY7RN';
  process.env.RELEASE_SIGNER_SECRET ||= 'SBMUIURQN7BHVZ6QRNNIB3VIKUM3ZZ2UVHJDLRBVULXA2VTIZVOYY7RN';
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  __setHorizonForTests(() => ({ loadAccount: async (a: string) => ({ id: a, balances: [{ asset_code: 'USDC', asset_issuer: env.usdcIssuer() }] }) }) as any);
  const savedM = process.env.AUTO_RELEASE_MINUTES; process.env.AUTO_RELEASE_MINUTES = '10'; // env viejo de prod: no debe mandar
  const warn = console.warn, err = console.error; console.warn = () => {}; console.error = () => {};
  try {
    /* ---------- 1) Validación (pura, compartida por la app y la API) ---------- */
    t.check('defaults: envío 7 días, cara a cara 24 h', DEFAULT_PROTECTION_MIN.envio === 10080 && DEFAULT_PROTECTION_MIN.cara_a_cara === 1440);
    const ok = (v: any) => 'error' in v ? null : v;
    t.check('sin datos -> envío, 7 días', JSON.stringify(ok(validateAgreement({}))) === JSON.stringify({ delivery_mode: 'envio', protection_minutes: 10080 }));
    t.check('cara a cara sin plazo -> 24 h', ok(validateAgreement({ delivery_mode: 'cara_a_cara' }))?.protection_minutes === 1440);
    t.check('24 h, 3 días, 30 días válidos', [1440, 4320, 43200].every((m) => ok(validateAgreement({ delivery_mode: 'envio', protection_minutes: m }))?.protection_minutes === m));
    t.check('< 24 h, > 30 días, decimales y texto -> error', [60, 1439, 43201, 1440.5, 'abc', -1].every((m) => 'error' in validateAgreement({ protection_minutes: m as any })));
    t.check('tipo de entrega inválido -> error', 'error' in validateAgreement({ delivery_mode: 'dron' as any }));
    t.check('resumen para el comprador', agreementSummary('cara_a_cara', 1440) === 'Entrega: Cara a cara · Protección: 24 h' && agreementSummary('envio', 10080) === 'Entrega: Envío · Protección: 7 días desde el envío', agreementSummary('envio', 10080));
    t.check('etiquetas de plazo', protectionLabel(1440) === '24 h' && protectionLabel(4320) === '3 días' && protectionLabel(43200) === '30 días');

    /* ---------- 2) Crear link: se guarda, se valida en el servidor y tolera la columna ausente ---------- */
    const create = (await import('../../api/orders/create')).default;
    const seller = await token({ sub: 'seller-57' });
    const body = (over: any = {}) => ({ proof: sellerProof(), title: 'Bici de montaña', price_crc: 150000, photos: [publicPrefix('seller-57') + '44444444-4444-4444-8444-444444444444/0.jpg'], ...over });
    let db = fakeDb(); __setDbForTests(db as any);
    let r = res(); await create(req(seller, body({ delivery_mode: 'cara_a_cara', protection_minutes: 4320 })), r);
    t.check('crear con cara a cara y 3 días -> guardado', r.code === 200 && db.tables.orders[0]?.delivery_mode === 'cara_a_cara' && db.tables.orders[0]?.protection_minutes === 4320, `${r.code} ${r.body?.error}`);
    r = res(); await create(req(seller, body({ protection_minutes: 60 })), r);
    t.check('plazo de 1 h -> 400 (servidor)', r.code === 400 && db.tables.orders.length === 1, `${r.code}`);
    r = res(); await create(req(seller, body({ protection_minutes: 31 * 1440 })), r);
    t.check('plazo de 31 días -> 400 (servidor)', r.code === 400, `${r.code}`);
    // Sin la migración 017: PostgREST responde PGRST204 al insertar columnas desconocidas
    db = fakeDb(); const realFrom = db.from;
    (db as any).from = (tb: string) => { const q = realFrom(tb); const ins = q.insert; q.insert = (p: any) => (tb === 'orders' && ('delivery_mode' in p || 'protection_minutes' in p) ? { then: (ok: any) => Promise.resolve({ data: null, error: { code: 'PGRST204', message: "Could not find the 'delivery_mode' column of 'orders' in the schema cache" } }).then(ok) } : ins(p)); return q; };
    __setDbForTests(db as any);
    r = res(); await create(req(seller, body({ delivery_mode: 'cara_a_cara', protection_minutes: 1440 })), r);
    t.check('sin la migración 017 el link se crea igual (sin las columnas)', r.code === 200 && db.tables.orders.length === 1 && db.tables.orders[0].delivery_mode === undefined, `${r.code} ${r.body?.error}`);

    // Producto permanente: el pedido hijo copia el acuerdo
    const { childRow } = await import('../../api/_lib/listings');
    const child = childRow({ slug: 'prod57', delivery_mode: 'cara_a_cara', protection_minutes: 4320, price_crc: 1000 }, 'buyer', 'kid057');
    t.check('pedido hijo copia tipo de entrega y plazo', child.delivery_mode === 'cara_a_cara' && child.protection_minutes === 4320);

    /* ---------- 3) Liberación: cara a cara desde el pago, envío desde el envío ---------- */
    const now = Date.now();
    const f2f = { delivery_mode: 'cara_a_cara', protection_minutes: 1440, status: 'fondeado', funded_at: new Date(now - 2 * DAY).toISOString(), shipped_at: null, auto_release_at: null };
    t.check('cara a cara: vence 24 h después del pago', releaseDueAt(f2f) === new Date(now - DAY).toISOString(), releaseDueAt(f2f));
    const ship3 = { delivery_mode: 'envio', protection_minutes: 4320, status: 'enviado', funded_at: new Date(now - 9 * DAY).toISOString(), shipped_at: new Date(now - 2 * DAY).toISOString(), auto_release_at: new Date(now - 2 * DAY + 10 * MIN).toISOString() };
    t.check('envío con 3 días acordados: desde "Ya lo envié" (no los 7 fijos ni el env de 10 min)', releaseDueAt(ship3) === new Date(now + DAY).toISOString(), releaseDueAt(ship3));
    t.check('extensión aceptada suma al plazo', releaseDueAt({ ...ship3, release_ext_minutes: 3 * 1440 }) === new Date(now + 4 * DAY).toISOString());

    const confirm = (await import('../../api/escrow/confirm')).default;
    const cron = (await import('../../api/escrow/cron')).default;
    const buyerSub = guestSubFromReq({ headers: { 'x-guest-key': KEY } });
    const base = { id: '57575757-5757-4575-8575-575757575757', slug: 'win057', seller_user_id: 'seller-57', buyer_user_id: buyerSub, seller_address: 'GSELLER',
      contract_id: 'CNOTUSED', amount_usdc: 1, pin_attempts: 0, sp_mode: 'seller', delivery_pin_hash: '' };
    base.delivery_pin_hash = pinHash(base.id, '135791');
    const fresh = (over: any) => { const d = fakeDb(); __setDbForTests(d as any); d.tables.orders.push({ ...base, ...over }); return d; };

    db = fresh({ ...f2f, funded_at: new Date().toISOString(), auto_release_at: new Date(Date.now() + DAY).toISOString() }); let calls = stubChain();
    r = res(); await confirm(req(seller, { slug: 'win057', reason: 'pin', pin: '135791' }), r);
    t.check('cara a cara: PIN correcto en fondeado -> liberado al instante', r.code === 200 && db.tables.orders[0].status === 'liberado' && db.tables.orders[0].approval_reason === 'pin', `${r.code} ${r.body?.error}`);
    db = fresh({ ...f2f, delivery_mode: 'envio', funded_at: new Date().toISOString() }); calls = stubChain();
    r = res(); await confirm(req(seller, { slug: 'win057', reason: 'pin', pin: '135791' }), r);
    t.check('envío: PIN en fondeado (antes de "Ya lo envié") -> no libera', r.code === 409 && db.tables.orders[0].status === 'fondeado' && !calls.includes('release'), `${r.code}`);
    const cronRun = async () => { const x = res(); await cron({ method: 'GET', headers: { authorization: 'Bearer ci-cron' }, query: {} }, x); return x; };
    db = fresh({ ...f2f, auto_release_at: new Date(Date.now() - DAY).toISOString() }); calls = stubChain();
    await cronRun();
    t.check('cron: cara a cara vencido desde el pago -> liberado (timeout)', db.tables.orders[0].status === 'liberado' && db.tables.orders[0].approval_reason === 'timeout', db.tables.orders[0].status);

    /* ---------- 4) Extensión de mutuo acuerdo ---------- */
    const asBuyer = (bd: any, key = KEY) => { const q: any = req(null, bd); q.headers = { 'x-guest-key': key }; return q; };
    const shipping = (n = Date.now()) => ({ ...ship3, funded_at: new Date(n - 3 * DAY).toISOString(), shipped_at: new Date(n - DAY).toISOString(), auto_release_at: new Date(n + 2 * DAY).toISOString() });
    db = fresh(shipping()); calls = stubChain();
    r = res(); await confirm(asBuyer({ slug: 'win057', reason: 'extend', days: 3 }), r);
    const pend = db.tables.orders[0].release_ext;
    t.check('comprador pide +3 días -> pendiente (by buyer)', r.code === 200 && pend?.by === 'buyer' && pend?.days === 3, `${r.code} ${r.body?.error} ${JSON.stringify(pend)}`);
    t.check('se registra en order_events', db.tables.order_events.some((e: any) => e.kind === 'extension_requested'));
    r = res(); await confirm(asBuyer({ slug: 'win057', reason: 'extend_answer', accept: true }), r);
    t.check('quien pidió no puede aceptar su propia solicitud -> 403', r.code === 403, `${r.code}`);
    r = res(); await confirm(asBuyer({ slug: 'win057', reason: 'extend', days: 1 }, OTHER), r);
    t.check('un tercero no puede pedir extensión -> 403', r.code === 403, `${r.code}`);
    const before = Date.parse(db.tables.orders[0].auto_release_at);
    r = res(); await confirm(req(seller, { slug: 'win057', reason: 'extend_answer', accept: true }), r);
    const o = db.tables.orders[0];
    t.check('vendedor acepta -> auto_release_at +3 días y sin pendiente', r.code === 200 && Date.parse(o.auto_release_at) - before === 3 * DAY && !o.release_ext && o.release_ext_minutes === 3 * 1440, `${r.code} ${r.body?.error} ${o.auto_release_at}`);
    r = res(); await confirm(req(seller, { slug: 'win057', reason: 'extend', days: 7 }), r);
    r = res(); await confirm(asBuyer({ slug: 'win057', reason: 'extend_answer', accept: false }), r);
    t.check('comprador rechaza -> plazo igual y sin pendiente', r.code === 200 && !db.tables.orders[0].release_ext && db.tables.orders[0].release_ext_minutes === 3 * 1440, `${r.code} ${r.body?.error}`);
    // Tope 30 días desde el pago
    db = fresh({ ...shipping(), funded_at: new Date(Date.now() - 20 * DAY).toISOString(), shipped_at: new Date(Date.now() - 2 * DAY).toISOString(), protection_minutes: 10080, auto_release_at: new Date(Date.now() + 5 * DAY).toISOString() });
    r = res(); await confirm(asBuyer({ slug: 'win057', reason: 'extend', days: 7 }), r);
    t.check('+7 días pasaría los 30 desde el pago -> 409', r.code === 409 && !db.tables.orders[0].release_ext, `${r.code} ${r.body?.error}`);
    r = res(); await confirm(asBuyer({ slug: 'win057', reason: 'extend', days: 3 }), r);
    t.check('+3 días cabe en los 30 -> 200', r.code === 200, `${r.code} ${r.body?.error}`);
    r = res(); await confirm(asBuyer({ slug: 'win057', reason: 'extend', days: 5 }), r);
    t.check('días inválidos (5) o ya hay una pendiente -> 400/409', r.code === 400 || r.code === 409, `${r.code}`);
    // Pendiente congela el auto-release (hasta respuesta o 24 h)
    db = fresh({ ...shipping(), auto_release_at: new Date(Date.now() - MIN).toISOString(), shipped_at: new Date(Date.now() - 3 * DAY - MIN).toISOString(), release_ext: { by: 'buyer', days: 1, at: new Date(Date.now() - 2 * 3600_000).toISOString() } }); calls = stubChain();
    await cronRun();
    t.check('cron: con extensión pendiente (< 24 h) no libera', db.tables.orders[0].status === 'enviado' && !calls.includes('release'), db.tables.orders[0].status);
    db = fresh({ ...shipping(), auto_release_at: new Date(Date.now() - MIN).toISOString(), shipped_at: new Date(Date.now() - 3 * DAY - MIN).toISOString(), release_ext: { by: 'buyer', days: 1, at: new Date(Date.now() - 25 * 3600_000).toISOString() } }); calls = stubChain();
    await cronRun();
    t.check('cron: solicitud sin respuesta por 24 h ya no congela -> liberado', db.tables.orders[0].status === 'liberado', db.tables.orders[0].status);
    db = fresh({ ...shipping(), auto_release_at: new Date(Date.now() - MIN).toISOString(), shipped_at: new Date(Date.now() - 30 * DAY).toISOString(), disputed_at: new Date().toISOString() }); calls = stubChain();
    await cronRun();
    t.check('disputa sigue congelando sin límite', db.tables.orders[0].status === 'enviado' && !calls.includes('release'));
    const em = extensionMessages({ slug: 'win057', status: 'enviado', buyer_user_id: 'b', seller_user_id: 's', model: 'Bici' }, 'requested', 'buyer', 3);
    t.check('push a la otra parte: "El comprador pidió 3 días más"', em.length === 1 && em[0].role === 'seller' && /pidió 3 días más/.test(em[0].body), JSON.stringify(em));

    /* ---------- 5) Reglas, UI y demo ---------- */
    const rules = readFileSync(join(ROOT, 'lib/rules.ts'), 'utf8');
    t.check('reglas: plazo acordado, cara a cara y extensión', /acuerd/i.test(rules) && /cara a cara/i.test(rules) && /días más|extensión|extender/i.test(rules));
    const demo = readFileSync(join(ROOT, 'lib/demo.ts'), 'utf8');
    t.check('demo: cara a cara y extensión', /cara_a_cara/.test(demo) && /extend_answer/.test(demo));
    const { readdirSync, statSync } = await import('node:fs');
    const fns = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (n === '_lib' ? [] : fns(p)) : /\.ts$/.test(n) ? [p] : []; });
    // Línea de tiempo: cara a cara = Pagado, Entregado con PIN, Liberado (en 'fondeado' el paso actual nunca es "Enviado").
    const { moneyProgress, moneyStepKeys } = await import('../../lib/progress');
    t.check('timeline cara a cara: 3 pasos sin "enviado"', moneyStepKeys('cara_a_cara').join() === 'pagado,entregado_pin,liberado' && moneyStepKeys('envio').join() === 'pagado,enviado,entregado,liberado' && moneyStepKeys(undefined).length === 4);
    t.check('timeline cara a cara: fondeado=1 (actual: Entregado con PIN), entregado=2, liberado=3; envío sin cambios',
      moneyProgress('fondeado', false, 'cara_a_cara') === 1 && moneyProgress('entregado', false, 'cara_a_cara') === 2 && moneyProgress('liberado', false, 'cara_a_cara') === 3
      && moneyProgress('en_disputa', true, 'cara_a_cara') === 1 && moneyProgress('enviado') === 2 && moneyProgress('liberado') === 4);
    const ds = readFileSync(join(ROOT, 'components/ds.tsx'), 'utf8');
    t.check('MoneyTimeline usa los pasos cara a cara según mode', /label: 'Entregado con PIN'/.test(ds) && /mode === 'cara_a_cara' \? MONEY_STEPS_F2F : MONEY_STEPS/.test(ds));
    t.check('vendedor (Pedidos, fila y detalle) y comprador pasan delivery_mode a la línea de tiempo',
      ['app/(tabs)/pedidos.tsx', 'components/OrderRow.tsx', 'app/p/[slug].tsx'].every((f) => /<MoneyTimeline[^>]*mode=\{/.test(readFileSync(join(ROOT, f), 'utf8'))));
    const mig = readFileSync(join(ROOT, 'supabase/migrations/017_agreed_window.sql'), 'utf8');
    t.check('migración 017: columnas con checks (24 h-30 días), vista pública y tick para cara a cara', /delivery_mode text not null default 'envio'/.test(mig)
      && /between 1440 and 43200/.test(mig) && /release_ext jsonb/.test(mig) && /public_orders[\s\S]*delivery_mode, protection_minutes, release_ext, release_ext_minutes/.test(mig)
      && /status = 'fondeado' and delivery_mode = 'cara_a_cara' and auto_release_at <= now\(\)/.test(mig));
    t.check('sin funciones nuevas en /api (siguen 12)', fns(join(ROOT, 'api')).length === 12);
  } finally {
    if (savedM === undefined) delete process.env.AUTO_RELEASE_MINUTES; else process.env.AUTO_RELEASE_MINUTES = savedM;
    __setChainForTests(null); console.warn = warn; console.error = err;
  }
}
