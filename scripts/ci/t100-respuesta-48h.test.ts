// (100) Regla v2 "Respuesta de quien vende en 48 h" (PR 2/3). Sin red, reloj inyectable. Cubre:
//  - Plazo: 48 h desde que se manda el aviso a quien vende (034), límites exactos; sin 034, desde el aviso/apertura.
//  - NO retroactivo: pedidos v0/v1 siguen como antes (sin versión obligatoria, sin plazo, sin reembolso automático).
//  - Abrir disputa (v2): versión de quien compra obligatoria y fotos salvo "No llegó"; aviso a las dos partes; el pago
//    sigue en custodia (disputa on-chain, sin resolver).
//  - Respuesta de quien vende: foto, guía de envío o texto; pasa a revisión humana (sin decisión automática, ni con el
//    flag de auto-resolución); fuera de plazo -> 409.
//  - Sin respuesta en 48 h: reembolso 100% por el cron (decisión 'auto_rule'/'vendedor_sin_respuesta'), idempotente;
//    sin DISPUTE_RESOLVER_SECRET queda pendiente sin duplicar; sin 027 o sin 033 no hace nada.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Keypair } from '@stellar/stellar-sdk';
import type { T } from './setup';
import { baseEnv } from './setup';
import { installTestJwks, req, res, token } from './jwt';
import { fakeDb } from './fakedb';
import { __setDbForTests } from '../../api/_lib/db';
import { __setChainForTests } from '../../api/_lib/escrow';
import { guestSubFromReq } from '../../api/_lib/guest';
import { CURRENT_RULES_VERSION, RULE_VERSION, replyDueAt, replyPhase, stampVersion } from '../../api/_lib/orderRules';
import { markReplied, refundNoReply, replyRulePass, startReplyWindow } from '../../api/_lib/replyRule';
import { autoResolvePass } from '../../api/_lib/disputeAdmin';

const ROOT = join(__dirname, '../..');
const H = 3_600_000;
const T0 = Date.parse('2026-11-03T15:00:00.000Z');
const KEY = 'e'.repeat(64);
const BUYER = guestSubFromReq({ headers: { 'x-guest-key': KEY } })!;
const SECRET = Keypair.random().secret();

function stubChain(already = false) {
  const calls: string[] = []; let disputed = already, resolved = false; const dist: any[] = [];
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
  n++; const row = { id: `10010010-0000-4000-8000-${String(n).padStart(12, '0')}`, slug: `rp10${n}x`.slice(0, 6), status: 'en_disputa', delivery_mode: 'envio', rules_version: 2,
    seller_user_id: 'seller-100', buyer_user_id: BUYER, buyer_address: 'GBUYER100', contract_id: `C100${n}`, amount_usdc: 10, title: 'Bici', funded_tx: 'f'.repeat(64),
    funded_at: new Date(T0 - 24 * H).toISOString(), shipped_at: new Date(T0 - 20 * H).toISOString(), shipped_tx: 's'.repeat(64), disputed_at: new Date(T0).toISOString(), dispute_tx: 'd'.repeat(64),
    dispute_reply_due_at: new Date(T0 + 48 * H).toISOString(), dispute_replied_at: null, ship_cancel: null, resolved_tx: null, ...over };
  db.tables.orders.push(row);
  db.tables.disputes.push({ order_id: row.id, reason: 'no_funciona', state: 'open', opened_at: row.disputed_at, seller_notified_at: row.disputed_at });
  return row;
};
const decisions = (db: any, id: string) => db.tables.order_events.filter((e: any) => e.order_id === id && e.kind === 'dispute_decision');

export async function run(t: T) {
  baseEnv();
  process.env.APPROVER_SECRET ||= SECRET;
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  const savedPub = process.env.DISPUTE_RESOLVER_PUBLIC;
  const warn = console.warn, err = console.error; console.warn = () => {}; console.error = () => {};
  try {
    /* ---------- 1) Plazos ---------- */
    t.check('versión vigente 2; regla en v2; sello acotado', CURRENT_RULES_VERSION === 2 && RULE_VERSION.sellerReply === 2 && stampVersion(2) === 2 && stampVersion(1) === 1 && stampVersion(9) === 2);
    const o: any = { status: 'en_disputa', rules_version: 2, disputed_at: new Date(T0).toISOString(), dispute_reply_due_at: new Date(T0 + 48 * H).toISOString() };
    t.check('48 h - 1 ms: corre el plazo', replyPhase(o, T0 + 48 * H - 1).phase === 'waiting');
    t.check('48 h exactas: vence', replyPhase(o, T0 + 48 * H).phase === 'due');
    t.check('respondió: revisión humana (nunca vence)', replyPhase({ ...o, dispute_replied_at: new Date(T0 + H).toISOString() }, T0 + 100 * H).phase === 'replied' && replyPhase(o, T0 + 100 * H, { replied: true }).phase === 'replied');
    t.check('NO retroactivo: v0 y v1 sin plazo', replyPhase({ ...o, rules_version: 1 }, T0 + 100 * H).phase === 'na' && replyPhase({ ...o, rules_version: 0 }, T0 + 100 * H).phase === 'na');
    t.check('cancelación por falta de envío (v1) no es una disputa con plazo', replyPhase({ ...o, ship_cancel: { by: 'buyer' } }, T0 + 100 * H).phase === 'na');
    t.check('sin 034: 48 h desde el aviso (o la apertura)', replyDueAt({ ...o, dispute_reply_due_at: null }, { seller_notified_at: new Date(T0 + H).toISOString() }) === new Date(T0 + 49 * H).toISOString()
      && replyDueAt({ ...o, dispute_reply_due_at: null }, { opened_at: new Date(T0).toISOString() }) === new Date(T0 + 48 * H).toISOString());

    /* ---------- 2) Abrir disputa ---------- */
    const { default: dispute } = await import('../../api/escrow/dispute');
    const open = async (body: any) => { const q: any = req(null, body); q.headers = { 'x-guest-key': KEY }; const r = res(); await dispute(q, r); return r; };
    let db = fakeDb(); __setDbForTests(db as any); let ch = stubChain();
    let row: any = mk(db, { status: 'enviado', disputed_at: null, dispute_tx: null, dispute_reply_due_at: null }); db.tables.disputes = [];
    let r = await open({ slug: row.slug, reason: 'no_llego', description: 'corto' });
    t.check('v2 sin versión (≥ 10) -> 400 version_required', r.code === 400 && r.body?.code === 'version_required' && row.status === 'enviado', `${r.code} ${JSON.stringify(r.body)}`);
    r = await open({ slug: row.slug, reason: 'no_funciona', description: 'No enciende, la pantalla queda negra' });
    t.check('v2 "No funciona" sin fotos -> 400 photo_required', r.code === 400 && r.body?.code === 'photo_required' && row.status === 'enviado', `${r.code} ${JSON.stringify(r.body)}`);
    const before = Date.now();
    r = await open({ slug: row.slug, reason: 'no_llego', description: 'Pasaron 10 días y no ha llegado nada' });
    const due = Date.parse(r.body?.reply_due_at ?? '');
    t.check('v2 "No llegó" con versión -> 200, en disputa on-chain, 48 h desde el aviso', r.code === 200 && row.status === 'en_disputa' && ch.calls.join() === 'dispute' && due - before >= 48 * H - 5000 && due - Date.now() <= 48 * H + 5000, `${r.code} ${JSON.stringify(r.body)}`);
    t.check('aviso registrado (disputes.seller_notified_at) y plazo guardado (orders.dispute_reply_due_at)', !!db.tables.disputes[0]?.seller_notified_at && row.dispute_reply_due_at === r.body.reply_due_at && db.tables.order_events.some((e: any) => e.kind === 'seller_reply_window'));
    t.check('versión de quien compra guardada en la disputa', db.tables.disputes[0]?.description === 'Pasaron 10 días y no ha llegado nada');
    t.check('el pago sigue en custodia (sin resolución)', !ch.calls.includes('resolve') && !row.resolved_tx);
    // v1: como antes
    db = fakeDb(); __setDbForTests(db as any); ch = stubChain();
    row = mk(db, { rules_version: 1, status: 'enviado', disputed_at: null, dispute_tx: null, dispute_reply_due_at: null }); db.tables.disputes = [];
    r = await open({ slug: row.slug, reason: 'no_llego' });
    t.check('v1 (anterior a la regla): sin versión obligatoria y sin plazo de 48 h', r.code === 200 && row.status === 'en_disputa' && !row.dispute_reply_due_at && !r.body?.reply_due_at, `${r.code} ${JSON.stringify(r.body)}`);

    let ps = pushSpy();
    await startReplyWindow({ ...row, rules_version: 2 }, { now: T0, push: ps.deps });
    t.check('aviso a quien vende (48 h; foto, guía o texto) y a quien compra (pago en custodia)', ps.sent.some((m) => m.to === 'seller-100' && /48 h/.test(m.body) && /guía/.test(m.body)) && ps.sent.some((m) => m.to === BUYER && /custodia/.test(m.body)), JSON.stringify(ps.sent));

    /* ---------- 3) Respuesta de quien vende ---------- */
    const { default: disputeApi } = await import('../../api/escrow/dispute');
    const seller = await token({ sub: 'seller-100' });
    const respond = async (body: any) => { const rr = res(); await disputeApi(req(seller, { action: 'seller_respond', ...body }), rr); return rr; };
    db = fakeDb(); __setDbForTests(db as any); (db.tables as any).dispute_responses = []; ch = stubChain();
    row = mk(db, { disputed_at: new Date().toISOString(), dispute_reply_due_at: new Date(Date.now() + 47 * H).toISOString() });
    r = await respond({ slug: row.slug, body: '' });
    t.check('respuesta vacía -> 400 (foto, guía o texto)', r.code === 400 && r.body?.code === 'body_required', `${r.code} ${JSON.stringify(r.body)}`);
    r = await respond({ slug: row.slug, tracking: 'CR123456789' });
    t.check('solo con la guía de envío -> guardada', r.code === 200 && (db.tables as any).dispute_responses[0]?.body === 'Guía de envío: CR123456789', `${r.code} ${JSON.stringify(r.body)}`);
    t.check('respondió: dispute_replied_at (034) y sin decisión automática', !!row.dispute_replied_at && !decisions(db, row.id).length && !ch.calls.includes('resolve'));
    r = await respond({ slug: row.slug, body: 'Lo envié bien empacado' });
    t.check('texto -> se actualiza (sigue en revisión humana)', r.code === 200 && (db.tables as any).dispute_responses.length === 1 && /empacado/.test((db.tables as any).dispute_responses[0].body));
    let pass: any = await replyRulePass({ now: Date.now() + 60 * H, secret: SECRET });
    t.check('con respuesta, pasadas las 48 h: el cron NO reembolsa (decide una persona)', !pass.refunded.length && row.status === 'en_disputa' && !decisions(db, row.id).length, JSON.stringify(pass));
    process.env.DISPUTES_AUTO_RESOLVE = '1'; process.env.DISPUTE_RESOLVER_SECRET = SECRET; delete process.env.DISPUTE_RESOLVER_PUBLIC;
    const ar = await autoResolvePass();
    t.check('ni con el flag de auto-resolución: v2 no se resuelve sola', !ar.resolved.includes(row.slug) && row.status === 'en_disputa', JSON.stringify(ar));
    delete process.env.DISPUTES_AUTO_RESOLVE; delete process.env.DISPUTE_RESOLVER_SECRET;
    ps = pushSpy();
    const late = mk(db, { disputed_at: new Date(Date.now() - 49 * H).toISOString(), dispute_reply_due_at: new Date(Date.now() - H).toISOString() });
    r = await respond({ slug: late.slug, body: 'Llego tarde con mi versión' });
    t.check('fuera de las 48 h -> 409 reply_expired', r.code === 409 && r.body?.code === 'reply_expired' && !(db.tables as any).dispute_responses.some((x: any) => x.order_id === late.id), `${r.code} ${JSON.stringify(r.body)}`);
    const quick = mk(db);
    await markReplied(quick, { push: ps.deps });
    await markReplied({ ...quick }, { push: ps.deps });
    t.check('aviso a quien compra cuando responde (una vez)', ps.sent.length === 1 && ps.sent[0].to === BUYER && /revisa las dos versiones/.test(ps.sent[0].body), JSON.stringify(ps.sent));

    /* ---------- 4) Sin respuesta en 48 h: reembolso ---------- */
    db = fakeDb(); __setDbForTests(db as any); (db.tables as any).dispute_responses = []; ch = stubChain(true); ps = pushSpy();
    const a = mk(db), v1 = mk(db, { rules_version: 1 }), v0 = mk(db, { rules_version: 0 }), sc = mk(db, { ship_cancel: { by: 'buyer', at: new Date(T0).toISOString() } });
    pass = await replyRulePass({ now: T0 + 48 * H - 1, secret: SECRET, push: ps.deps });
    t.check('1 ms antes de las 48 h: nada', !pass.refunded.length && a.status === 'en_disputa' && !ch.calls.length, JSON.stringify(pass));
    pass = await replyRulePass({ now: T0 + 48 * H, secret: SECRET, push: ps.deps });
    t.check('48 h sin respuesta: reembolso 100% desde la custodia', pass.refunded.join() === a.slug && a.status === 'resuelto' && a.resolution?.buyerPct === 100 && ch.dist[0]?.address === 'GBUYER100', JSON.stringify(pass));
    const d0 = decisions(db, a.id);
    t.check("decisión auditada: 'auto_rule' / 'vendedor_sin_respuesta'", d0.length === 1 && d0[0].detail.source === 'auto_rule' && d0[0].detail.rule_id === 'vendedor_sin_respuesta');
    t.check('aviso del reembolso a las dos partes', ps.sent.map((m) => m.to).sort().join() === `${BUYER},seller-100`, JSON.stringify(ps.sent));
    t.check('NO retroactivo: v1, v0 y la cancelación por falta de envío intactos', [v1, v0, sc].every((x) => x.status === 'en_disputa') && ch.calls.filter((c) => c === 'resolve').length === 1);
    pass = await replyRulePass({ now: T0 + 72 * H, secret: SECRET, push: ps.deps });
    const ra: any = await refundNoReply({ ...a }, { now: T0 + 72 * H, secret: SECRET });
    t.check('idempotente: otra pasada y ?slug no hacen nada', !pass.refunded.length && ra.skipped && decisions(db, a.id).length === 1 && ch.calls.filter((c) => c === 'resolve').length === 1, JSON.stringify({ pass, ra }));

    db = fakeDb(); __setDbForTests(db as any); (db.tables as any).dispute_responses = []; ch = stubChain(true);
    const p0 = mk(db);
    const r1: any = await refundNoReply({ ...p0 }, { now: T0 + 49 * H, secret: null });
    const r2: any = await refundNoReply({ ...p0 }, { now: T0 + 50 * H, secret: null });
    t.check("sin DISPUTE_RESOLVER_SECRET: 'pending_onchain' una sola vez", r1.pending && r2.already && decisions(db, p0.id).length === 1 && decisions(db, p0.id)[0].detail.status === 'pending_onchain', JSON.stringify({ r1, r2 }));

    db = fakeDb(); __setDbForTests(db as any); mk(db); // sin tabla dispute_responses (027)
    const base = db.from; (db as any).from = (tb: string) => { const q = base(tb); if (tb === 'dispute_responses') q.then = (ok: any) => Promise.resolve({ data: null, error: { code: '42P01', message: 'relation "dispute_responses" does not exist' } }).then(ok); return q; };
    pass = await replyRulePass({ now: T0 + 60 * H, secret: SECRET });
    t.check('sin 027 (sin mecanismo de respuesta): no reembolsa solo', !pass.refunded.length && !pass.errors.length, JSON.stringify(pass));
    const missing = fakeDb(); const b2 = missing.from;
    (missing as any).from = (tb: string) => { const q = b2(tb); if (tb !== 'orders') return q; const g = q.gte; q.gte = (c: string, v: any) => (c === 'rules_version' ? Object.assign(q, { then: (ok: any) => Promise.resolve({ data: null, error: { code: '42703', message: 'column orders.rules_version does not exist' } }).then(ok) }) : g(c, v)); return q; };
    __setDbForTests(missing as any);
    pass = await replyRulePass({ now: T0 + 60 * H });
    t.check("sin 033: skipped 'sin_033'", pass.skipped === 'sin_033', JSON.stringify(pass));

    /* ---------- 5) Migración y cron ---------- */
    const sql = readFileSync(join(ROOT, 'supabase/migrations/034_regla_respuesta_vendedor_48h.sql'), 'utf8');
    t.check('034: seller_notified_at + dispute_reply_due_at + dispute_replied_at, vista y tick', /seller_notified_at timestamptz/.test(sql) && /dispute_reply_due_at timestamptz/.test(sql) && /dispute_replied_at timestamptz/.test(sql)
      && /dispute_reply_due_at, dispute_replied_at\s+from public\.orders/.test(sql) && /dispute_reply_due_at <= now\(\)/.test(sql));
    const cron = readFileSync(join(ROOT, 'api/escrow/cron.ts'), 'utf8');
    t.check('cron: pasada reply_rule + ?slug', /reply_rule: reply/.test(cron) && /refundNoReply\(f\)/.test(cron));
  } finally {
    console.warn = warn; console.error = err; __setChainForTests(null);
    delete process.env.DISPUTE_RESOLVER_SECRET; delete process.env.DISPUTES_AUTO_RESOLVE; if (savedPub) process.env.DISPUTE_RESOLVER_PUBLIC = savedPub;
  }
}
