// (99) Regla v1 "Reembolso si no se envía" (PR 1/3). Sin red, reloj inyectable. Cubre:
//  - Plazos: 3 días FIJOS desde el pago para "Ya lo envié" (aparte del plazo acordado), aviso el día 2, cancelar desde
//    el día 3, reembolso solo desde el día 5. Límites exactos al milisegundo.
//  - NO retroactivo: pedidos sin rules_version (0, anteriores al deploy) o cara a cara nunca entran.
//  - Idempotencia: cancelar dos veces, cron dos veces, cancelar + cron -> UN dispute-escrow, UNA resolución, UNA decisión.
//  - Reembolso = camino de las disputas (dispute-escrow + resolución 100% al comprador, decisión 'auto_rule'/'sin_envio').
//  - Sin DISPUTE_RESOLVER_SECRET: queda 'pending_onchain' (panel de disputas) y no se duplica.
//  - Sin la migración 033: el cron no hace nada (skipped 'sin_033') y la app funciona igual.
//  - Avisos: día 2 a quien vende (texto exacto, una vez); cancelación/reembolso a las dos partes.
//  - Endpoint: solo quien compró puede cancelar; "Ya lo envié" no corre mientras se cancela (lock).
import { readFileSync } from 'node:fs';
import { Keypair } from '@stellar/stellar-sdk';
import { join } from 'node:path';
import type { T } from './setup';
import { baseEnv } from './setup';
import { installTestJwks, req, res, token } from './jwt';
import { fakeDb } from './fakedb';
import { __setDbForTests } from '../../api/_lib/db';
import { __setChainForTests } from '../../api/_lib/escrow';
import { guestSubFromReq } from '../../api/_lib/guest';
import { CURRENT_RULES_VERSION, RULE_VERSION, SHIP_REMINDER_TEXT, shipDeadline, stampVersion } from '../../api/_lib/orderRules';
import { refundUnshipped, remindSeller, shipRulePass } from '../../api/_lib/shipRefund';
import { shipRuleMessages } from '../../api/_lib/push';
import { childRow } from '../../api/_lib/listings';

const ROOT = join(__dirname, '../..');
const H = 3_600_000, D = 24 * H;
const T0 = Date.parse('2026-11-02T15:00:00.000Z');
const KEY = 'c'.repeat(64), OTHER = 'd'.repeat(64);
const BUYER = guestSubFromReq({ headers: { 'x-guest-key': KEY } })!;
const SECRET = Keypair.random().secret(); // llave efímera (nunca se usa en red: la cadena está simulada)

function stubChain() {
  const calls: string[] = []; let disputed = false, resolved = false; const dist: any[] = [];
  __setChainForTests({
    releaseGuard: async () => ({ esc: null, disputed, released: false, resolved, approved: false } as any),
    disputeOnChain: async () => { calls.push('dispute'); disputed = true; return 'd'.repeat(64); },
    getBalance: async () => 10,
    resolveDispute: async (_c: string, _s: string, d: any[]) => { calls.push('resolve'); resolved = true; dist.push(...d); return { hash: 'z'.repeat(64) } as any; },
  } as any);
  return { calls, dist };
}
function pushSpy() {
  const sent: { to: string; title: string; body: string }[] = [];
  return { sent, deps: { enabled: () => true, load: async (ids: string[]) => ids.map((id) => ({ user_id: id, endpoint: `https://push.invalid/${id}`, p256dh: 'x', auth: 'y' })),
    send: async (sub: any, raw: string) => { const p = JSON.parse(raw); sent.push({ to: sub.user_id, title: p.title, body: p.body }); return 201; } } as any };
}
let n = 0;
const mk = (db: any, over: any = {}) => {
  n++; const row = { id: `99999999-0000-4000-8000-${String(n).padStart(12, '0')}`, slug: `sr99${n}`, status: 'fondeado', delivery_mode: 'envio', rules_version: 1,
    seller_user_id: 'seller-99', buyer_user_id: BUYER, buyer_address: 'GBUYER99', contract_id: `C99${n}`, amount_usdc: 10, title: 'Bici',
    funded_tx: 'f'.repeat(64), funded_at: new Date(T0).toISOString(), protection_minutes: 1440, shipped_at: null, ship_reminded_at: null, ship_cancel: null, ...over };
  db.tables.orders.push(row); return row;
};
const decisions = (db: any, id: string) => db.tables.order_events.filter((e: any) => e.order_id === id && e.kind === 'dispute_decision');

export async function run(t: T) {
  baseEnv();
  process.env.APPROVER_SECRET ||= SECRET;
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  const savedPub = process.env.DISPUTE_RESOLVER_PUBLIC;
  const warn = console.warn, err = console.error; console.warn = () => {}; console.error = () => {};
  try {
    /* ---------- 1) Plazos (reloj inyectable) ---------- */
    const o: any = { status: 'fondeado', delivery_mode: 'envio', rules_version: 1, funded_at: new Date(T0).toISOString() };
    const ph = (ms: number, over: any = {}) => shipDeadline({ ...o, ...over }, T0 + ms).phase;
    t.check('día 0-2: waiting (2 d - 1 ms incluido)', ph(0) === 'waiting' && ph(2 * D - 1) === 'waiting');
    t.check('día 2 exacto: aviso a quien vende', ph(2 * D) === 'reminder' && ph(3 * D - 1) === 'reminder');
    t.check('día 3 exacto: quien compra puede cancelar', ph(3 * D) === 'cancelable' && ph(5 * D - 1) === 'cancelable');
    t.check('día 5 exacto (3 + 2): reembolso automático', ph(5 * D) === 'auto_due' && ph(30 * D) === 'auto_due');
    const sd = shipDeadline(o, T0);
    t.check('fechas: aviso +2 d, cancelar +3 d, automático +5 d desde el pago', sd.remindAt === new Date(T0 + 2 * D).toISOString() && sd.cancelAt === new Date(T0 + 3 * D).toISOString() && sd.autoAt === new Date(T0 + 5 * D).toISOString());
    t.check('plazo FIJO: no depende del plazo acordado (protection_minutes / auto_release_at)', ph(3 * D, { protection_minutes: 43200, auto_release_at: new Date(T0 + 40 * D).toISOString() }) === 'cancelable' && ph(3 * D, { protection_minutes: 1440 }) === 'cancelable');
    t.check('"Ya lo envié" / disputa / cancelación cortan la regla', ['shipped_at', 'shipped_tx', 'disputed_at', 'dispute_tx'].every((k) => ph(6 * D, { [k]: 'x' }) === 'na') && ph(6 * D, { ship_cancel: { by: 'buyer' } }) === 'na' && ph(6 * D, { status: 'enviado' }) === 'na');
    t.check('NO retroactivo: rules_version 0 / null / ausente -> nunca aplica', [0, null, undefined].every((v) => ph(10 * D, { rules_version: v }) === 'na'));
    t.check('cara a cara excluido', ph(10 * D, { delivery_mode: 'cara_a_cara' }) === 'na');
    t.check('sin funded_at -> no aplica (no inventa plazo)', ph(10 * D, { funded_at: null }) === 'na');
    t.check('versión: vigente >= regla; sello desde el ack del cliente (0..vigente)', CURRENT_RULES_VERSION >= RULE_VERSION.shipRefund && stampVersion(undefined) === 0 && stampVersion('x') === 0 && stampVersion(-3) === 0 && stampVersion(1) === 1 && stampVersion(999) === CURRENT_RULES_VERSION);
    t.check('producto permanente: el pedido hijo copia rules_version del producto', childRow({ id: 'p', slug: 'pp', rules_version: 1, seller_user_id: 's', amount_crc: 1, amount_usdc: 1 }, 'b', 'ch1').rules_version === 1);

    /* ---------- 2) Avisos ---------- */
    const m = shipRuleMessages({ seller_user_id: 'S', buyer_user_id: 'B', title: 'Bici', slug: 'x' } as any, 'reminder');
    t.check(`aviso día 2 solo a quien vende con el texto exacto "${SHIP_REMINDER_TEXT}"`, m.length === 1 && m[0].to === 'S' && m[0].body.startsWith("Te queda 1 día para marcar 'Ya lo envié'"), JSON.stringify(m));
    const mc = shipRuleMessages({ seller_user_id: 'S', buyer_user_id: 'B', title: 'Bici', slug: 'x' } as any, 'cancel_auto');
    t.check('reembolso automático: aviso a las dos partes', mc.map((x) => x.to).sort().join() === 'B,S');

    let db = fakeDb(); __setDbForTests(db as any); let row = mk(db); let ps = pushSpy(); stubChain();
    let sent1 = await remindSeller({ ...row }, { now: T0 + 2 * D + H, push: ps.deps });
    let sent2 = await remindSeller({ ...row, ship_reminded_at: row.ship_reminded_at }, { now: T0 + 2 * D + 2 * H, push: ps.deps });
    t.check('aviso día 2: una sola vez (ship_reminded_at)', sent1 && !sent2 && ps.sent.length === 1 && ps.sent[0].to === 'seller-99' && !!row.ship_reminded_at, JSON.stringify(ps.sent));
    t.check('aviso antes del día 2: no se manda', !(await remindSeller({ ...mk(db) }, { now: T0 + 2 * D - 1, push: ps.deps })));

    /* ---------- 3) Quien compra cancela (día 3) ---------- */
    db = fakeDb(); __setDbForTests(db as any); row = mk(db); ps = pushSpy(); let ch = stubChain();
    const early: any = await refundUnshipped({ ...row }, 'buyer', { now: T0 + 3 * D - 1, secret: SECRET, push: ps.deps }).catch((e) => e);
    t.check('cancelar antes de 3 días -> 409 not_yet, sin tocar la custodia', early?.status === 409 && early?.code === 'not_yet' && ch.calls.length === 0 && row.status === 'fondeado', `${early?.status} ${early?.code}`);
    let r: any = await refundUnshipped({ ...row }, 'buyer', { now: T0 + 3 * D, secret: SECRET, push: ps.deps });
    t.check('día 3: cancelar -> reembolso 100% desde la custodia', r.refunded && row.status === 'resuelto' && row.resolution?.buyerPct === 100 && ch.dist.length === 1 && ch.dist[0].address === 'GBUYER99' && ch.dist[0].amount === 10, JSON.stringify(r));
    t.check("camino de las disputas: dispute-escrow + resolución, ship_cancel.by='buyer', motivo no_llego", ch.calls.join() === 'dispute,resolve' && row.ship_cancel?.by === 'buyer' && db.tables.disputes[0]?.reason === 'no_llego' && db.tables.disputes[0]?.state === 'resolved');
    const dec = decisions(db, row.id);
    t.check("decisión auditada: source 'auto_rule', regla 'sin_envio', 100% al comprador", dec.length === 1 && dec[0].detail.source === 'auto_rule' && dec[0].detail.rule_id === 'sin_envio' && dec[0].detail.buyer_pct === 100, JSON.stringify(dec.map((e: any) => e.detail)));
    t.check('avisos: cancelación a las dos partes (sin el push genérico duplicado)', ps.sent.map((x) => x.to).sort().join() === `${BUYER},seller-99`, JSON.stringify(ps.sent));
    r = await refundUnshipped({ ...row }, 'buyer', { now: T0 + 3 * D + H, secret: SECRET, push: ps.deps });
    let pass: any = await shipRulePass({ now: T0 + 6 * D, secret: SECRET, push: ps.deps });
    t.check('idempotente: cancelar otra vez + cron -> nada nuevo', r.already && ch.calls.join() === 'dispute,resolve' && decisions(db, row.id).length === 1 && !pass.refunded.length && ps.sent.length === 2, JSON.stringify({ r, pass }));
    t.check('evento ship_cancel con la versión de reglas', db.tables.order_events.some((e: any) => e.kind === 'ship_cancel' && e.detail?.by === 'buyer' && e.detail?.rules_version === 1));

    /* ---------- 4) Reembolso automático (cron, día 5) ---------- */
    db = fakeDb(); __setDbForTests(db as any); ps = pushSpy(); ch = stubChain();
    const due = mk(db);
    const old = mk(db, { rules_version: 0 });                // anterior al deploy
    const f2f = mk(db, { delivery_mode: 'cara_a_cara' });   // cara a cara
    const shipped = mk(db, { status: 'enviado', shipped_at: new Date(T0 + D).toISOString() });
    const young = mk(db, { funded_at: new Date(T0 + 2 * D).toISOString() }); // a los 6 d del T0 lleva 4 d: cancelable, no automático
    pass = await shipRulePass({ now: T0 + 5 * D - 1, secret: SECRET, push: ps.deps });
    t.check('cron 1 ms antes del día 5: no reembolsa', !pass.refunded.length && due.status === 'fondeado' && !ch.calls.includes('dispute'), JSON.stringify(pass));
    pass = await shipRulePass({ now: T0 + 6 * D, secret: SECRET, push: ps.deps });
    t.check('cron día 5+: reembolsa solo el pedido vencido', pass.refunded.join() === due.slug && due.status === 'resuelto' && due.ship_cancel?.by === 'auto' && due.resolution?.buyerPct === 100, JSON.stringify(pass));
    t.check('NO retroactivo: pedido sin rules_version intacto', old.status === 'fondeado' && !old.ship_cancel && !old.ship_reminded_at);
    t.check('cara a cara / enviado / aún cancelable: intactos', f2f.status === 'fondeado' && shipped.status === 'enviado' && young.status === 'fondeado' && !young.ship_cancel);
    t.check('aviso automático a las dos partes', ps.sent.filter((x) => x.title === 'Reembolso automático' || (x.title === 'Compra cancelada' && /5 días/.test(x.body))).map((x) => x.to).sort().join() === `${BUYER},seller-99`, JSON.stringify(ps.sent));
    const before = ch.calls.length;
    pass = await shipRulePass({ now: T0 + 7 * D, secret: SECRET, push: ps.deps });
    t.check('cron otra vez: idempotente (sin otra tx ni decisión)', ch.calls.length === before && !pass.refunded.length && decisions(db, due.id).length === 1, JSON.stringify(pass));

    /* ---------- 5) Sin secreto del resolver: queda pendiente en el panel, sin duplicar ---------- */
    db = fakeDb(); __setDbForTests(db as any); ps = pushSpy(); ch = stubChain();
    row = mk(db);
    r = await refundUnshipped({ ...row }, 'auto', { now: T0 + 5 * D, secret: null, push: ps.deps });
    t.check("sin DISPUTE_RESOLVER_SECRET: en disputa + decisión 'pending_onchain'", r.pending && row.status === 'en_disputa' && decisions(db, row.id)[0]?.detail.status === 'pending_onchain', JSON.stringify(r));
    pass = await shipRulePass({ now: T0 + 6 * D, secret: null, push: ps.deps });
    t.check('cron con la decisión pendiente: no duplica', decisions(db, row.id).length === 1 && ch.calls.join() === 'dispute', JSON.stringify(pass));

    /* ---------- 6) Sin la migración 033 ---------- */
    const missing = fakeDb(); const base = missing.from;
    (missing as any).from = (tb: string) => { const q = base(tb); if (tb !== 'orders') return q; const g = q.gte; q.gte = (c: string, v: any) => (c === 'rules_version' ? Object.assign(q, { then: (ok: any) => Promise.resolve({ data: null, error: { code: '42703', message: 'column orders.rules_version does not exist' } }).then(ok) }) : g(c, v)); return q; };
    __setDbForTests(missing as any);
    pass = await shipRulePass({ now: T0 + 6 * D });
    t.check("sin 033: el cron no hace nada (skipped 'sin_033') y no lanza", pass.skipped === 'sin_033', JSON.stringify(pass));
    const create = readFileSync(join(ROOT, 'api/orders/create.ts'), 'utf8');
    t.check('sin 033: crear pedido reintenta sin rules_version', /stampVersion\(b\.rules_ack\)/.test(create) && /missingColumn/.test(create) && /rules_version/.test(create));

    /* ---------- 7) Endpoint ---------- */
    const { default: confirm } = await import('../../api/escrow/confirm');
    const { default: ship } = await import('../../api/escrow/ship');
    db = fakeDb(); __setDbForTests(db as any); ch = stubChain();
    row = mk(db, { funded_at: new Date(Date.now() - 3 * D - H).toISOString() });
    const g = (key: string) => { const q: any = req(null, { slug: row.slug, reason: 'cancel_unshipped' }); q.headers = { 'x-guest-key': key }; return q; };
    let rs = res(); await confirm(g(OTHER), rs);
    t.check('otra persona no puede cancelar (403)', rs.code === 403 && row.status === 'fondeado', `${rs.code}`);
    const seller = await token({ sub: 'seller-99' });
    rs = res(); await confirm(req(seller, { slug: row.slug, reason: 'cancel_unshipped' }), rs);
    t.check('quien vende no puede cancelar por quien compra', rs.code >= 400 && row.status === 'fondeado', `${rs.code}`);
    row.release_lock_until = new Date(Date.now() + 60_000).toISOString();
    rs = res(); await ship(req(seller, { slug: row.slug, photo: 'x' }), rs);
    t.check('"Ya lo envié" mientras se cancela -> 409 order_locked', rs.code === 409 && rs.body?.code === 'order_locked' && row.status === 'fondeado', `${rs.code} ${JSON.stringify(rs.body)}`);
    row.release_lock_until = null;
    process.env.DISPUTE_RESOLVER_SECRET = SECRET; delete process.env.DISPUTE_RESOLVER_PUBLIC;
    rs = res(); await confirm(g(KEY), rs);
    t.check('quien compró (invitado) cancela -> 200 reembolsado', rs.code === 200 && rs.body?.refunded && row.status === 'resuelto', `${rs.code} ${JSON.stringify(rs.body)}`);
    rs = res(); await confirm(g(KEY), rs);
    t.check('segundo toque -> 200 already (idempotente)', rs.code === 200 && rs.body?.already && ch.calls.join() === 'dispute,resolve', `${rs.code} ${JSON.stringify(rs.body)}`);

    /* ---------- 8) Cron y migración ---------- */
    const vj = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
    t.check('vercel.json: cron diario a /api/escrow/cron (además del tick de pg_cron)', (vj.crons ?? []).some((c: any) => c.path === '/api/escrow/cron' && /^\d+ \d+ \* \* \*$/.test(c.schedule)));
    const sql = readFileSync(join(ROOT, 'supabase/migrations/033_reglas_reembolso_sin_envio.sql'), 'utf8');
    t.check('033: rules_version default 0 (nada retroactivo) + ship_reminded_at + ship_cancel', /rules_version integer not null default 0/.test(sql) && /ship_reminded_at timestamptz/.test(sql) && /ship_cancel jsonb/.test(sql));
    t.check('033: public_orders expone funded_at/rules_version/ship_cancel y el tick despierta al cron', /create or replace view public\.public_orders/.test(sql) && /rules_version/.test(sql.slice(sql.indexOf('public_orders'))) && /function public\.meteorito_release_tick/.test(sql));
  } finally { console.warn = warn; console.error = err; __setChainForTests(null); delete process.env.DISPUTE_RESOLVER_SECRET; if (savedPub) process.env.DISPUTE_RESOLVER_PUBLIC = savedPub; }
}
