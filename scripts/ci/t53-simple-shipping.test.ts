// (53) Envío simple + liberación segura (TDD):
//  - "Ya lo envié" en un toque: la evidencia es opcional ({at, photo?, note?}) y se sigue hasheando.
//  - Foto del envío solo de la carpeta propia del vendedor; el comprador la ve por el API (no en la vista pública).
//  - El código de entrega (PIN) del comprador no se muestra antes del envío.
//  - Liberación: PIN correcto o confirmación del comprador. Si nadie hace nada, 7 días después del envío, salvo disputa o PIN bloqueado.
//  - Producción: AUTO_RELEASE_MINUTES < 1440 se ignora (10080). Pedidos viejos con plazo corto: el cron recalcula desde shipped_at.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { T } from './setup';
import { baseEnv } from './setup';
import { installTestJwks, req, res, token } from './jwt';
import { fakeDb } from './fakedb';
import { __setDbForTests } from '../../api/_lib/db';
import { env, autoReleaseAt, releaseDueAt } from '../../api/_lib/env';
import { approveAndRelease, evidenceHash, pinHash, __setChainForTests } from '../../api/_lib/escrow';
import { publicPrefix } from '../../api/_lib/photos';
import { guestSubFromReq } from '../../api/_lib/guest';
import { pushMessages, reminderMessages } from '../../api/_lib/push';
import { deliveryCodeVisible } from '../../lib/shipping';
import { formatWindow } from '../../lib/autorelease';

const ROOT = join(__dirname, '../..');
const src = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const DAY = 86_400_000;
const KEY = 'c'.repeat(64);

function stubChain() {
  const calls: string[] = [];
  let approved = false;
  __setChainForTests({
    releaseGuard: async () => { calls.push('guard'); return { esc: null, disputed: false, released: false, resolved: false, approved } as any; },
    approveMilestone: async () => { calls.push('approve'); approved = true; return { hash: 'a'.repeat(64) } as any; },
    getBalance: async () => { calls.push('balance'); return 1; },
    releaseFunds: async () => { calls.push('release'); return { hash: 'r'.repeat(64) } as any; },
    changeMilestoneStatus: async (_c: string, _s: string, _st: string, ev: string) => { calls.push('ship:' + ev); return { hash: 's'.repeat(64) } as any; },
    changeMilestoneStatusXdr: async (_c: string, _a: string, _st: string, ev: string) => { calls.push('shipxdr:' + ev); return { unsignedTransaction: 'XDR' } as any; },
  });
  return calls;
}

export async function run(t: T) {
  baseEnv();
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  const saved = { m: process.env.AUTO_RELEASE_MINUTES, h: process.env.AUTO_RELEASE_HOURS, v: process.env.VERCEL_ENV, n: process.env.NODE_ENV };
  const setEnv = (m?: string, v?: string, h?: string) => {
    if (m === undefined) delete process.env.AUTO_RELEASE_MINUTES; else process.env.AUTO_RELEASE_MINUTES = m;
    if (h === undefined) delete process.env.AUTO_RELEASE_HOURS; else process.env.AUTO_RELEASE_HOURS = h;
    if (v === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = v;
  };
  const warn = console.warn, err = console.error; console.warn = () => {}; console.error = () => {};
  try {
    /* ---------- 1) Plazo de liberación automática: 7 días y mínimo en producción ---------- */
    const now = Date.parse('2026-10-20T12:00:00Z');
    setEnv(undefined, undefined);
    t.check('default sin env = 10080 min (7 días)', env.autoReleaseMinutes() === 10080, String(env.autoReleaseMinutes()));
    t.check('default: auto_release_at = +7 días', autoReleaseAt(now) === '2026-10-27T12:00:00.000Z', autoReleaseAt(now));
    setEnv('10', 'production');
    t.check('producción con AUTO_RELEASE_MINUTES=10 (env viejo) -> 10080', env.autoReleaseMinutes() === 10080, String(env.autoReleaseMinutes()));
    setEnv('1439', 'production');
    t.check('producción con 1439 -> 10080 (mínimo 1440)', env.autoReleaseMinutes() === 10080);
    setEnv('1440', 'production');
    t.check('producción con 1440 -> 1440 (respeta valores ≥ 24 h)', env.autoReleaseMinutes() === 1440);
    setEnv(undefined, 'production', '1');
    t.check('producción con AUTO_RELEASE_HOURS=1 -> 10080', env.autoReleaseMinutes() === 10080);
    setEnv('10', 'preview');
    t.check('preview/CI pueden usar 10 min por env', env.autoReleaseMinutes() === 10);
    setEnv('10', undefined);
    t.check('sin VERCEL_ENV (local/CI) pueden usar 10 min', process.env.NODE_ENV === 'production' || env.autoReleaseMinutes() === 10);
    t.check('UI: 10080 min -> "7 días", 1440 -> "1 día"', formatWindow(10080) === '7 días' && formatWindow(1440) === '1 día', `${formatWindow(10080)} / ${formatWindow(1440)}`);

    // Pedido viejo: enviado con el plazo corto de antes (10 min). En producción vence 7 días después de shipped_at.
    setEnv('10', 'production');
    const shipped = new Date(now - DAY).toISOString();
    const old = { shipped_at: shipped, auto_release_at: new Date(now - DAY + 10 * 60_000).toISOString() };
    t.check('releaseDueAt: pedido viejo de 10 min -> shipped_at + 7 días', releaseDueAt(old) === new Date(now - DAY + 7 * DAY).toISOString(), releaseDueAt(old));
    t.check('releaseDueAt: nunca antes que auto_release_at', releaseDueAt({ shipped_at: shipped, auto_release_at: new Date(now + 30 * DAY).toISOString() }) === new Date(now + 30 * DAY).toISOString());

    /* ---------- 2) "Ya lo envié" sin nota obligatoria ---------- */
    const ship = (await import('../../api/escrow/ship')).default;
    const seller = await token({ sub: 'seller-53' });
    const base = { id: '53535353-5353-4535-8535-535353535353', slug: 'shp053', status: 'fondeado', seller_user_id: 'seller-53', buyer_user_id: guestSubFromReq({ headers: { 'x-guest-key': KEY } }),
      seller_address: 'GSELLER', contract_id: 'CNOTUSED', amount_usdc: 1, pin_attempts: 0, delivery_pin_hash: '' };
    base.delivery_pin_hash = pinHash(base.id, '246810');
    const shipWith = async (body: any, over: any = {}) => {
      const db = fakeDb(); __setDbForTests(db as any); db.tables.orders.push({ ...base, sp_mode: 'seller', ...over });
      const calls = stubChain();
      const r = res(); await ship(req(seller, { slug: 'shp053', ...body }), r);
      return { r, db, o: db.tables.orders[0], calls };
    };
    let s = await shipWith({});
    t.check('sin evidencia ni nota -> 200 (un toque)', s.r.code === 200, `${s.r.code} ${s.r.body?.error}`);
    t.check('evidencia mínima {at} guardada y hasheada', !!s.o.ship_evidence?.at && s.o.ship_evidence_hash === evidenceHash(s.o.ship_evidence) && s.r.body?.evidenceHash === s.o.ship_evidence_hash);
    t.check('el hash va al milestone "Enviado" (XDR del vendedor)', s.calls.includes('shipxdr:' + s.o.ship_evidence_hash), s.calls.join(','));
    s = await shipWith({ evidence: { note: '' } });
    t.check('nota vacía -> 200 y sin nota guardada', s.r.code === 200 && !('note' in (s.o.ship_evidence ?? {})), JSON.stringify(s.o.ship_evidence));
    const photo = publicPrefix('seller-53') + '0b6f1f0a-1111-4222-8333-444455556666/0.jpg';
    s = await shipWith({ evidence: { photo, note: '  Guía CR123456789  ' } });
    t.check('foto propia + número de guía opcional -> guardados', s.r.code === 200 && s.o.ship_evidence?.photo === photo && s.o.ship_evidence?.note === 'Guía CR123456789', JSON.stringify(s.o.ship_evidence));
    s = await shipWith({ evidence: { photo: 'https://evil.example/x.jpg' } });
    t.check('foto de otra URL -> 400 y no cambia nada', s.r.code === 400 && !s.o.ship_evidence && s.o.status === 'fondeado', `${s.r.code}`);
    s = await shipWith({ evidence: { photo: publicPrefix('otro-vendedor') + '0b6f1f0a-1111-4222-8333-444455556666/0.jpg' } });
    t.check('foto de la carpeta de otro usuario -> 400', s.r.code === 400);
    process.env.SERVICE_SECRET ??= 'SBMUIURQN7BHVZ6QRNNIB3VIKUM3ZZ2UVHJDLRBVULXA2VTIZVOYY7RN';
    s = await shipWith({}, { sp_mode: 'backend' });
    t.check('modo backend: enviado con auto_release_at = shipped_at + 7 días (aunque el env diga 10 min)', s.o.status === 'enviado' && Date.parse(s.o.auto_release_at) - Date.parse(s.o.shipped_at) === 7 * DAY, `${s.r.code} ${s.r.body?.error} ${s.o.shipped_at} -> ${s.o.auto_release_at}`);

    /* ---------- 3) Comprador: foto del envío por el API, código solo tras el envío ---------- */
    const pay = (await import('../../api/escrow/pay')).default;
    const shipment = async (status: string, key: string | null, evidence: any = { at: shipped, photo }) => {
      const db = fakeDb(); __setDbForTests(db as any); db.tables.orders.push({ ...base, status, ship_evidence: status === 'fondeado' ? null : evidence });
      const r = res(); const rq: any = req(null, { slug: 'shp053', step: 'shipment' }); rq.headers = key ? { 'x-guest-key': key } : {};
      await pay(rq, r); return r;
    };
    let r = await shipment('enviado', KEY);
    t.check('comprador ve la foto del envío (step shipment)', r.code === 200 && r.body?.shipped === true && r.body?.photo === photo, `${r.code} ${JSON.stringify(r.body)}`);
    r = await shipment('enviado', 'd'.repeat(64));
    t.check('otro navegador no ve la foto del envío -> 403', r.code === 403, `${r.code}`);
    r = await shipment('fondeado', KEY);
    t.check('antes del envío: shipped=false, sin foto', r.code === 200 && r.body?.shipped === false && !r.body?.photo, JSON.stringify(r.body));
    t.check('la foto del envío NO va a la vista pública (puede traer datos personales)', !/ship_evidence|ship_photo/.test(src('supabase/migrations/016_shipping_reminder.sql').replace(/^--.*$/gm, '')));
    t.check('deliveryCodeVisible: oculto en fondeado, visible en enviado', !deliveryCodeVisible('fondeado') && !deliveryCodeVisible('escrow_creado') && deliveryCodeVisible('enviado'));
    const paybox = src('components/PayBox.tsx');
    t.check('PayBox: sin "Ver mi PIN de entrega" antes del envío', !paybox.includes('Ver mi PIN de entrega'));
    t.check('PayBox: "Pagado. Esperando que el vendedor lo envíe"', paybox.includes('Pagado. Esperando que el vendedor lo envíe'));
    t.check('PayBox: "Va en camino" + "Dáselo al vendedor cuando lo recibas"', paybox.includes('Va en camino') && paybox.includes('Dáselo al vendedor cuando lo recibas'));
    const sa = src('components/SellerActions.tsx');
    t.check('Vendedor: botón "Ya lo envié" sin campo obligatorio', sa.includes('Ya lo envié') && !/disabled=\{!note/.test(sa) && !sa.includes('Marcar como enviado'));
    t.check('Vendedor: foto opcional con el pipeline de fotos (uploadCompressed)', /uploadCompressed|uploadPhoto/.test(sa) && /opcional/i.test(sa));

    /* ---------- 4) Liberación: PIN, confirmación, plazo de 7 días, disputa ---------- */
    setEnv('10', 'production');
    const enviado = (over: any = {}) => ({ ...base, status: 'enviado', shipped_at: new Date(Date.now() - DAY).toISOString(), auto_release_at: new Date(Date.now() - DAY + 600_000).toISOString(), ...over });
    let db = fakeDb(); __setDbForTests(db as any); let calls = stubChain();
    db.tables.orders.push(enviado());
    const e1 = await approveAndRelease(db.tables.orders[0], 'timeout').then(() => null, (e: any) => e);
    t.check('timeout a 1 día del envío (env viejo de 10 min) -> rechazado (not_due) sin tocar la red', e1?.code === 'not_due' && calls.length === 0 && db.tables.orders[0].status === 'enviado', `${e1?.status} ${e1?.code} ${calls}`);
    const cron = (await import('../../api/escrow/cron')).default;
    const cr = res(); await cron({ method: 'GET', headers: { authorization: 'Bearer ci-cron' }, query: {} }, cr);
    const o1 = db.tables.orders[0];
    t.check('cron: no libera antes de 7 días', o1.status === 'enviado' && !o1.released_tx && calls.length === 0, `${o1.status} ${calls}`);
    t.check('cron: corrige auto_release_at a shipped_at + 7 días', Date.parse(o1.auto_release_at) - Date.parse(o1.shipped_at) === 7 * DAY, o1.auto_release_at);
    const cs = res(); await cron({ method: 'GET', headers: {}, query: { slug: 'shp053' } }, cs);
    t.check('respaldo ?slug= tampoco libera antes de tiempo', db.tables.orders[0].status === 'enviado' && calls.length === 0);

    db = fakeDb(); __setDbForTests(db as any); calls = stubChain();
    db.tables.orders.push(enviado({ shipped_at: new Date(Date.now() - 7 * DAY - 60_000).toISOString(), auto_release_at: new Date(Date.now() - 60_000).toISOString() }));
    const cr2 = res(); await cron({ method: 'GET', headers: { authorization: 'Bearer ci-cron' }, query: {} }, cr2);
    t.check('cron: pasados 7 días sin disputa -> liberado (timeout)', db.tables.orders[0].status === 'liberado' && db.tables.orders[0].approval_reason === 'timeout', `${db.tables.orders[0].status} ${JSON.stringify(cr2.body)}`);

    db = fakeDb(); __setDbForTests(db as any); calls = stubChain();
    db.tables.orders.push(enviado({ shipped_at: new Date(Date.now() - 8 * DAY).toISOString(), auto_release_at: new Date(Date.now() - DAY).toISOString(), disputed_at: new Date().toISOString() }));
    await cron({ method: 'GET', headers: { authorization: 'Bearer ci-cron' }, query: {} }, res());
    t.check('disputa abierta congela la liberación aunque venció', db.tables.orders[0].status === 'enviado' && !calls.includes('release'));
    db = fakeDb(); __setDbForTests(db as any); calls = stubChain();
    db.tables.orders.push(enviado({ shipped_at: new Date(Date.now() - 8 * DAY).toISOString(), auto_release_at: new Date(Date.now() - DAY).toISOString(), pin_attempts: 3 }));
    await cron({ method: 'GET', headers: { authorization: 'Bearer ci-cron' }, query: {} }, res());
    t.check('PIN bloqueado: tampoco se libera solo', db.tables.orders[0].status === 'enviado' && !calls.includes('release'));

    const confirm = (await import('../../api/escrow/confirm')).default;
    db = fakeDb(); __setDbForTests(db as any); calls = stubChain(); db.tables.orders.push({ ...base });
    let rc = res(); await confirm(req(seller, { slug: 'shp053', reason: 'pin', pin: '246810' }), rc);
    t.check('PIN correcto ANTES de "Ya lo envié" -> no libera (409)', rc.code === 409 && db.tables.orders[0].status === 'fondeado' && !calls.includes('release'), `${rc.code}`);
    db = fakeDb(); __setDbForTests(db as any); calls = stubChain(); db.tables.orders.push(enviado({ shipped_at: new Date().toISOString(), auto_release_at: new Date(Date.now() + 7 * DAY).toISOString() }));
    rc = res(); await confirm(req(seller, { slug: 'shp053', reason: 'pin', pin: '246810' }), rc);
    t.check('PIN correcto tras el envío -> liberado al instante (sin esperar 7 días)', rc.code === 200 && db.tables.orders[0].status === 'liberado' && db.tables.orders[0].approval_reason === 'pin', `${rc.code} ${rc.body?.error}`);
    db = fakeDb(); __setDbForTests(db as any); calls = stubChain(); db.tables.orders.push(enviado({ shipped_at: new Date().toISOString(), auto_release_at: new Date(Date.now() + 7 * DAY).toISOString() }));
    rc = res(); const rq: any = req(null, { slug: 'shp053', reason: 'buyer_confirm' }); rq.headers = { 'x-guest-key': KEY };
    await confirm(rq, rc);
    t.check('comprador confirma "Recibí y está bien" -> liberado', rc.code === 200 && db.tables.orders[0].status === 'liberado' && db.tables.orders[0].approval_reason === 'buyer_confirm', `${rc.code} ${rc.body?.error}`);

    /* ---------- 5) Recordatorio ~24 h antes (best-effort, sin funciones nuevas) ---------- */
    db = fakeDb(); __setDbForTests(db as any); calls = stubChain();
    db.tables.orders.push(enviado({ shipped_at: new Date(Date.now() - 6.5 * DAY).toISOString(), auto_release_at: new Date(Date.now() + 0.5 * DAY).toISOString() }));
    await cron({ method: 'GET', headers: { authorization: 'Bearer ci-cron' }, query: {} }, res());
    await cron({ method: 'GET', headers: { authorization: 'Bearer ci-cron' }, query: {} }, res());
    t.check('recordatorio "¿Ya te llegó?" se registra una sola vez y no libera', db.tables.order_events.filter((e: any) => e.kind === 'release_reminder').length === 1 && db.tables.orders[0].status === 'enviado');
    const rm = reminderMessages({ slug: 'shp053', status: 'enviado', buyer_user_id: 'b', seller_user_id: 's', model: 'Bici' });
    t.check('recordatorio: solo al comprador, "¿Ya te llegó?"', rm.length === 1 && rm[0].role === 'buyer' && rm[0].title === '¿Ya te llegó?', JSON.stringify(rm));
    const pm = pushMessages({ slug: 'shp053', status: 'enviado', buyer_user_id: 'b', seller_user_id: 's', model: 'Bici' });
    t.check('push "enviado": menciona el código de entrega', pm.some((m) => m.role === 'buyer' && /código de entrega/.test(m.body)), JSON.stringify(pm));
    const pf = pushMessages({ slug: 'shp053', status: 'fondeado', buyer_user_id: 'b', seller_user_id: 's', model: 'Bici' });
    t.check('push "fondeado" al vendedor: "Ya lo envié"', pf.some((m) => m.role === 'seller' && /Ya lo envié/.test(m.body)));

    /* ---------- 6) Textos y demo ---------- */
    const ped = src('app/(tabs)/pedidos.tsx');
    t.check('Pedidos: el texto de "fondeado" habla de "Ya lo envié" y el de "enviado" del código y los 7 días', /Ya lo envié/.test(ped) && /código de entrega/.test(ped) && /7 días/.test(ped));
    const demo = src('lib/demo.ts');
    t.check('demo: plazo de 7 días como producción', /DEMO_AUTO_RELEASE_MINUTES = 10080/.test(demo));
    t.check('demo: step shipment para el comprador', /'shipment'/.test(demo));
    const { readdirSync, statSync } = await import('node:fs');
    const fns = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (n === '_lib' ? [] : fns(p)) : /\.ts$/.test(n) ? [p] : []; });
    t.check('sin funciones nuevas en /api (siguen 12)', fns(join(ROOT, 'api')).length === 12, String(fns(join(ROOT, 'api')).length));
  } finally {
    setEnv(saved.m, saved.v, saved.h); __setChainForTests(null);
    console.warn = warn; console.error = err;
  }
}
