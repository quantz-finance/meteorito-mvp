// (101) Regla v3 "Período de reclamo de 30 días" (PR 3/3). Sin red, reloj inyectable. Cubre:
//  - Plazo: 30 días desde la liberación (límites exactos); solo pedidos liberados v3 (NO retroactivo: v0/v1/v2 no).
//  - Reportar: motivo + versión (≥ 10), una vez por pedido (idempotente), aviso a quien vende; NO mueve fondos (sin
//    llamadas on-chain, el pedido sigue liberado).
//  - Quien vende responde antes de que cuente (48 h desde el aviso, límite exacto); después también puede responder.
//  - Historial público: solo el conteo por estado (abierto/respondido/resuelto) de los reportes que ya cuentan; nunca el texto.
//  - Equipo: lista y "resuelto" (nota obligatoria, idempotente).
//  - Sin 035: available:false, abrir 503, perfil sin conteo (null), panel available:false.
import type { T } from './setup';
import { baseEnv } from './setup';
import { req, res } from './jwt';
import { fakeDb } from './fakedb';
import { __setDbForTests } from '../../api/_lib/db';
import { __setChainForTests, DISPUTE_REASONS } from '../../api/_lib/escrow';
import { guestSubFromReq } from '../../api/_lib/guest';
import { CLAIM_DAYS, CLAIM_GRACE_HOURS, CURRENT_RULES_VERSION, RULE_VERSION, claimCounts, claimHistory, claimWindow, stampVersion } from '../../api/_lib/orderRules';
import { CLAIM_REASONS, adminClaims, claimForBuyer, claimForSeller, claimSummary, openClaim, resolveClaim, respondClaim } from '../../api/_lib/claims';
import { claimMessages } from '../../api/_lib/push';

const H = 3_600_000, D = 24 * H;
const T0 = Date.parse('2026-11-03T15:00:00.000Z');
const KEY = 'f'.repeat(64);
const BUYER = guestSubFromReq({ headers: { 'x-guest-key': KEY } })!;
const WHO = { ids: [BUYER], guest: BUYER, cavos: null } as any;
const SELLER = 'seller-101';

function pushSpy() {
  const sent: { to: string; title: string; body: string }[] = [];
  return { sent, deps: { enabled: () => true, load: async (ids: string[]) => ids.map((id) => ({ user_id: id, endpoint: `https://push.invalid/${id}`, p256dh: 'x', auth: 'y' })),
    send: async (sub: any, raw: string) => { const p = JSON.parse(raw); sent.push({ to: sub.user_id, title: p.title, body: p.body }); return 201; } } as any };
}
let n = 0;
const mk = (db: any, over: any = {}) => {
  n++; const row = { id: `10110110-0000-4000-8000-${String(n).padStart(12, '0')}`, slug: `rc${n}xyz`.slice(0, 6), status: 'liberado', delivery_mode: 'envio', rules_version: 3,
    seller_user_id: SELLER, buyer_user_id: BUYER, title: 'Bici', released_tx: 'r'.repeat(64), released_at: new Date(T0).toISOString(), ...over };
  db.tables.orders.push(row); return row;
};
/** Base sin la tabla order_claims (035). */
function withoutClaims(db: any) {
  return { ...db, from: (t: string) => {
    if (t !== 'order_claims') return db.from(t);
    const e = { data: null, error: { code: '42P01', message: 'relation "order_claims" does not exist' } };
    const q: any = new Proxy({}, { get: (_x, k) => (k === 'then' ? (r: any) => Promise.resolve(e).then(r) : k === 'maybeSingle' || k === 'single' ? async () => e : () => q) });
    return q;
  } };
}
const code = async (p: Promise<any>) => { try { await p; return 'ok'; } catch (e: any) { return `${e.status}:${e.code}`; } };

export async function run(t: T) {
  baseEnv();
  const warn = console.warn; console.warn = () => {};
  let chainCalls = 0;
  __setChainForTests({ releaseGuard: async () => { chainCalls++; return {} as any; }, disputeOnChain: async () => { chainCalls++; return ''; }, resolveDispute: async () => { chainCalls++; return {} as any; }, getBalance: async () => { chainCalls++; return 0; } } as any);
  try {
    /* ---------- 1) Plazos puros ---------- */
    t.check('versión vigente 3; regla en v3; sello acotado', CURRENT_RULES_VERSION === 3 && RULE_VERSION.claims === 3 && stampVersion(3) === 3 && stampVersion(99) === 3 && CLAIM_DAYS === 30 && CLAIM_GRACE_HOURS === 48);
    const o: any = { status: 'liberado', rules_version: 3, released_at: new Date(T0).toISOString() };
    t.check('30 días - 1 ms: se puede reportar', claimWindow(o, T0 + 30 * D - 1).phase === 'open');
    t.check('30 días exactos: cerrado', claimWindow(o, T0 + 30 * D).phase === 'closed' && claimWindow(o, T0).until === new Date(T0 + 30 * D).toISOString());
    t.check('NO retroactivo: v0, v1 y v2 sin período de reclamo', [0, 1, 2].every((v) => claimWindow({ ...o, rules_version: v }, T0 + D).phase === 'na'));
    t.check('solo después de liberado (enviado / en disputa / resuelto: no)', ['enviado', 'en_disputa', 'resuelto', 'fondeado'].every((st) => claimWindow({ ...o, status: st }, T0 + D).phase === 'na'));
    t.check('sin fecha de liberación: no se ofrece', claimWindow({ ...o, released_at: null }, T0).phase === 'na');
    const c0 = { status: 'abierto', opened_at: new Date(T0).toISOString(), counts_at: new Date(T0 + 48 * H).toISOString() };
    t.check('48 h - 1 ms: todavía no cuenta (quien vende puede responder antes)', !claimCounts(c0, T0 + 48 * H - 1));
    t.check('48 h exactas: cuenta como abierto', claimCounts(c0, T0 + 48 * H));
    t.check('respondido o resuelto: cuenta de inmediato', claimCounts({ ...c0, status: 'respondido' }, T0) && claimCounts({ ...c0, status: 'resuelto' }, T0));
    t.check('historial: solo los que ya cuentan, por estado', JSON.stringify(claimHistory([c0, { ...c0, status: 'respondido' }, { ...c0, status: 'resuelto' }, { ...c0, opened_at: new Date(T0 + 10 * H).toISOString(), counts_at: new Date(T0 + 58 * H).toISOString() }], T0 + 50 * H)) === JSON.stringify({ abierto: 1, respondido: 1, resuelto: 1 }));
    t.check('motivos = los de las disputas', CLAIM_REASONS.join() === DISPUTE_REASONS.join());

    /* ---------- 2) Reportar ---------- */
    let db = fakeDb(); __setDbForTests(db as any);
    let row: any = mk(db);
    let sp = pushSpy();
    t.check('texto corto -> 400', await code(openClaim(row, WHO, { reason: 'no_funciona', description: 'mal' }, { now: T0 + D, push: sp.deps })) === '400:claim_text_required');
    t.check('motivo inválido -> 400', await code(openClaim(row, WHO, { reason: 'x', description: 'No enciende desde que llegó' }, { now: T0 + D, push: sp.deps })) === '400:bad_reason');
    t.check('otra persona -> 403', await code(openClaim(row, { ids: ['otro'], guest: 'otro', cavos: null } as any, { reason: 'no_funciona', description: 'No enciende desde que llegó' }, { now: T0 + D })) === '403:not_buyer');
    const r1 = await openClaim(row, WHO, { reason: 'no_funciona', description: 'No enciende desde que llegó' }, { now: T0 + D, push: sp.deps });
    const stored = db.tables.order_claims?.[0];
    t.check('reporte guardado: abierto, cuenta en 48 h desde el aviso', (r1 as any).opened && stored?.status === 'abierto' && stored.counts_at === new Date(T0 + D + 48 * H).toISOString() && !!stored.seller_notified_at);
    t.check('aviso a quien vende (y no a quien compra)', sp.sent.length === 1 && sp.sent[0].to === SELLER && /48 h/.test(sp.sent[0].body));
    const r2 = await openClaim(row, WHO, { reason: 'otro', description: 'Otra cosa distinta aquí' }, { now: T0 + D + H, push: sp.deps });
    t.check('idempotente: el segundo intento devuelve el mismo reporte, sin otro aviso', (r2 as any).already && db.tables.order_claims.length === 1 && sp.sent.length === 1 && db.tables.order_claims[0].reason === 'no_funciona');
    t.check('NO mueve fondos: sin llamadas on-chain y el pedido sigue liberado', chainCalls === 0 && db.tables.orders.find((x: any) => x.id === row.id).status === 'liberado');
    t.check('evento claim_opened', db.tables.order_events.some((e: any) => e.order_id === row.id && e.kind === 'claim_opened'));
    const b1: any = await claimForBuyer(row, WHO, { now: T0 + D + H });
    t.check('quien compra ve su reporte (abierto, aún no cuenta) y el plazo', b1.available && b1.applies && b1.claim.status === 'abierto' && b1.claim.counts === false && b1.window.phase === 'open');
    const late = mk(db);
    t.check('día 30 exacto -> 409 (plazo cerrado)', await code(openClaim(late, WHO, { reason: 'no_funciona', description: 'No enciende desde que llegó' }, { now: T0 + 30 * D })) === '409:claim_window_closed');
    t.check('pedido v2 (anterior a la regla) -> 409', await code(openClaim(mk(db, { rules_version: 2 }), WHO, { reason: 'no_funciona', description: 'No enciende desde que llegó' }, { now: T0 + D })) === '409:claim_not_applicable');
    t.check('pedido v2: claim_get dice que no aplica', (await claimForBuyer(mk(db, { rules_version: 2 }), WHO, { now: T0 })).applies === false);
    t.check('antes de liberar -> 409', await code(openClaim(mk(db, { status: 'enviado', released_at: null, released_tx: null }), WHO, { reason: 'no_llego', description: 'No me ha llegado nada' }, { now: T0 })) === '409:claim_not_released');

    /* ---------- 3) Respuesta de quien vende ---------- */
    t.check('perfil antes de las 48 h: el reporte aún no cuenta', JSON.stringify(await claimSummary(SELLER, T0 + D + 47 * H)) === JSON.stringify({ abierto: 0, respondido: 0, resuelto: 0 }));
    t.check('solo quien vende del pedido -> 404', await code(claimForSeller(row, 'otro')) === '404:not_found' && await code(respondClaim(row, 'otro', { body: 'x' })) === '404:not_found');
    const s1: any = await claimForSeller(row, SELLER, { now: T0 + D + H });
    t.check('quien vende ve el texto de quien compra y puede responder', s1.claim.description === 'No enciende desde que llegó' && s1.can_respond === true);
    t.check('respuesta vacía -> 400', await code(respondClaim(row, SELLER, { body: '  ' })) === '400:claim_reply_required');
    sp = pushSpy();
    await respondClaim(row, SELLER, { body: 'Lo probé antes de enviarlo; te ayudo a revisarlo.' }, { now: T0 + D + 2 * H, push: sp.deps });
    t.check('respondió antes de las 48 h: cuenta ya respondido; aviso a quien compra', db.tables.order_claims[0].status === 'respondido' && sp.sent.length === 1 && sp.sent[0].to === BUYER
      && JSON.stringify(await claimSummary(SELLER, T0 + D + 3 * H)) === JSON.stringify({ abierto: 0, respondido: 1, resuelto: 0 }));
    await respondClaim(row, SELLER, { body: 'Agrego: te mando el video de la prueba.' }, { now: T0 + D + 3 * H, push: sp.deps });
    t.check('editar la respuesta: sin otro aviso', sp.sent.length === 1 && /video/.test(db.tables.order_claims[0].seller_response));
    // Otro reporte sin respuesta: pasa a contar como abierto a las 48 h.
    const row2 = mk(db); await openClaim(row2, WHO, { reason: 'no_es_lo_descrito', description: 'El color no es el de las fotos' }, { now: T0 + D });
    t.check('sin respuesta: a las 48 h cuenta como abierto', JSON.stringify(await claimSummary(SELLER, T0 + D + 48 * H)) === JSON.stringify({ abierto: 1, respondido: 1, resuelto: 0 }));

    /* ---------- 4) Historial público: solo estados ---------- */
    const { salesOutcome } = await import('../../api/_lib/feed');
    const so = await salesOutcome(SELLER);
    const txt = JSON.stringify(so);
    t.check('perfil (salesOutcome.claims): solo números, nunca el texto ni la respuesta', !!so.claims && !/enciende|color|video|probé/.test(txt) && Object.values(so.claims!).every((v) => typeof v === 'number'), txt);

    /* ---------- 5) Equipo ---------- */
    const a1: any = await adminClaims({ now: T0 + 3 * D });
    t.check('panel: lista con las dos versiones, no resueltos primero', a1.available && a1.claims.length === 2 && a1.claims.every((c: any) => c.status !== 'resuelto'));
    t.check('resolver sin nota -> 400', await code(resolveClaim(row2, { email: 'a@b.c' }, '')) === '400:note_required');
    sp = pushSpy();
    await resolveClaim(row2, { email: 'a@b.c' }, 'Hablamos con las dos partes.', { push: sp.deps });
    const again: any = await resolveClaim(row2, { email: 'a@b.c' }, 'otra vez', { push: sp.deps });
    t.check('resuelto: idempotente, aviso a las dos partes una vez, sin fondos', again.already && sp.sent.length === 2 && chainCalls === 0
      && JSON.stringify(await claimSummary(SELLER, T0 + 3 * D)) === JSON.stringify({ abierto: 0, respondido: 1, resuelto: 1 }));
    t.check('resuelto: quien vende ya no puede responder (409)', await code(respondClaim(row2, SELLER, { body: 'tarde' })) === '409:claim_resolved');
    t.check('avisos sin prometer devolución', claimMessages({ slug: 'x', title: 'Bici', seller_user_id: 's', buyer_user_id: 'b' } as any, 'opened').every((m) => !/devol|reembols/i.test(m.body)));

    /* ---------- 6) Ruta en api/escrow/dispute (acciones claim_*) ---------- */
    const { default: dispute } = await import('../../api/escrow/dispute');
    const q: any = req(null, { action: 'claim_get', slug: row.slug }); q.headers = { 'x-guest-key': KEY }; const rr = res(); await dispute(q, rr);
    t.check('POST /api/escrow/dispute {action:claim_get} con la llave de invitado', rr.code === 200 && rr.body?.claim?.status === 'respondido', JSON.stringify(rr.body).slice(0, 200));

    /* ---------- 7) Sin 035 ---------- */
    const db2 = fakeDb(); const row3 = mk(db2); __setDbForTests(withoutClaims(db2) as any);
    t.check('sin 035: claim_get available:false', (await claimForBuyer(row3, WHO, { now: T0 + D })).available === false);
    t.check('sin 035: reportar -> 503', await code(openClaim(row3, WHO, { reason: 'no_funciona', description: 'No enciende desde que llegó' }, { now: T0 + D })) === '503:claims_unavailable');
    t.check('sin 035: perfil sin conteo (null) y el resto del perfil sigue', (await claimSummary(SELLER)) === null && (await salesOutcome(SELLER)).claims === null);
    t.check('sin 035: panel available:false', (await adminClaims()).available === false);
  } finally { console.warn = warn; __setChainForTests(null as any); }
}
