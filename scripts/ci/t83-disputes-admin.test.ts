// (83) Panel admin de disputas: reglas deterministas (capa B/D), rol admin del lado del servidor (ADMIN_EMAILS contra el
// token Cavos verificado; no admin -> 404, sin sesión -> 401), decisión humana con resolución on-chain compartida con el
// script + auditoría, devolución al invitado, respuesta del vendedor, IA (sin PII, caché, sin credencial = no disponible),
// funcionamiento SIN la migración 027 y copy sin palabras prohibidas. Unit (DB falsa, cadena falsa, sin red).
import { readFileSync } from 'node:fs';
import { Keypair } from '@stellar/stellar-sdk';
import type { T } from './setup';
import { installTestJwks, req, res, token } from './jwt';
import { fakeDb } from './fakedb';
import { __setDbForTests } from '../../api/_lib/db';
import { __setChainForTests } from '../../api/_lib/escrow';
import dispute from '../../api/escrow/dispute';
import { adminEmails, isAdminUser } from '../../api/_lib/admin';
import { autoResolvable, evaluateRules, pctOf, tabOf } from '../../api/_lib/disputeRules';
import { __setAiCallerForTests, aiStatus, buildAiInput, parseAiOutput, redact } from '../../api/_lib/disputeAi';
import { resolveFromScript } from '../../api/_lib/disputeResolve';
import { autoResolvePass } from '../../api/_lib/disputeAdmin';

const H = 3_600_000, D = 24 * H;
const MASTER = 'bobbyaliensshop@gmail.com';
/** fakeDb SIN la migración 027: sus tablas responden "relation does not exist" (42P01), como Supabase antes de aplicarla. */
const MISSING = ['dispute_decisions', 'dispute_ai_summaries', 'dispute_responses', 'app_flags'];
function withoutMigration(db: any) {
  const from = db.from;
  db.from = (t: string) => {
    if (!MISSING.includes(t)) return from(t);
    const r = { data: null, error: { code: '42P01', message: `relation "public.${t}" does not exist` } };
    const q: any = new Proxy({}, { get: (_o, k) => (k === 'then' ? (ok: any, ko: any) => Promise.resolve(r).then(ok, ko) : k === 'single' || k === 'maybeSingle' ? async () => r : () => q) });
    return q;
  };
  return db;
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
function seed(db: any, o: Record<string, unknown> = {}, d: Record<string, unknown> = {}) {
  const id = '33333333-3333-4333-8333-' + String(db.tables.orders.length + 1).padStart(12, '0');
  const slug = String(o.slug ?? 'adm00' + (db.tables.orders.length + 1));
  const order = { id, slug, status: 'en_disputa', brand: 'Bici', model: 'de montaña', price_crc: 150000, amount_usdc: 2, contract_id: 'C' + 'A'.repeat(55),
    buyer_user_id: 'guest:abcdef0123456789', seller_user_id: 'seller-sub', buyer_address: 'GPLATFORM', seller_address: 'GSELLER', funded_at: ago(5 * D), shipped_at: ago(4 * D),
    shipped_tx: 'b'.repeat(64), ship_evidence: { photo: 'https://x/ship.jpg', note: 'CR123' }, ship_evidence_hash: 'sha256:abc', dispute_tx: 'c'.repeat(64), disputed_at: ago(2 * H), created_at: ago(6 * D), ...o };
  db.tables.orders.push(order);
  db.tables.disputes.push({ order_id: id, reason: 'no_es_lo_descrito', description: 'Llegó con la rueda rota', evidence: [], opened_by: order.buyer_user_id, opened_at: ago(2 * H), state: 'open', ...d });
  return order;
}
const post = async (tok: string | null, body: any) => { const r = res(); await dispute(req(tok, body), r); return r; };

export async function run(t: T) {
  /* ---------- Capa B / D: reglas ---------- */
  const base = { status: 'en_disputa', delivery_mode: 'envio', funded_at: ago(4 * D), shipped_at: null, shipped_tx: null, ship_evidence: null };
  const r1 = evaluateRules({ order: base, dispute: { opened_at: ago(H) }, response: null, responsesAvailable: false });
  t.check('regla sin_envio: pagado hace 4 d y nunca enviado -> reembolso total', r1?.rule === 'sin_envio' && r1.outcome === 'refund' && r1.buyerPct === 100, JSON.stringify(r1));
  t.check('sin_envio no aplica antes de 3 días', evaluateRules({ order: { ...base, funded_at: ago(2 * D) }, dispute: { opened_at: ago(H) }, response: null, responsesAvailable: false }) === null);
  t.check('sin_envio no aplica cara a cara', evaluateRules({ order: { ...base, delivery_mode: 'cara_a_cara' }, dispute: { opened_at: ago(H) }, response: null, responsesAvailable: false }) === null);
  const r2 = evaluateRules({ order: { ...base, shipped_at: ago(3 * D), ship_evidence: { photo: null, note: '  ' } }, dispute: { opened_at: ago(H) }, response: null, responsesAvailable: false });
  t.check('regla envio_sin_prueba: enviado sin foto ni guía -> a favor del comprador', r2?.rule === 'envio_sin_prueba' && r2.buyerPct === 100);
  t.check('con foto del envío no hay regla de prueba', evaluateRules({ order: { ...base, shipped_at: ago(3 * D), ship_evidence: { photo: 'x' } }, dispute: { opened_at: ago(H) }, response: null, responsesAvailable: false }) === null);
  const shipped = { ...base, shipped_at: ago(3 * D), ship_evidence: { photo: 'x' } };
  const r3 = evaluateRules({ order: shipped, dispute: { opened_at: ago(49 * H) }, response: null, responsesAvailable: true });
  t.check('regla vendedor_sin_respuesta: 48 h sin responder (con 027) -> reembolso', r3?.rule === 'vendedor_sin_respuesta' && r3.outcome === 'refund');
  t.check('sin 027 la regla de 48 h no aplica (capa D no existe)', evaluateRules({ order: shipped, dispute: { opened_at: ago(49 * H) }, response: null, responsesAvailable: false }) === null);
  t.check('con respuesta del vendedor no aplica', evaluateRules({ order: shipped, dispute: { opened_at: ago(49 * H) }, response: { created_at: ago(40 * H) }, responsesAvailable: true }) === null);
  t.check('auto-resolución apagada por defecto aunque una regla aplique', autoResolvable(r1, { autoResolve: false }) === false && autoResolvable(r1, { autoResolve: true }) === true && autoResolvable(null, { autoResolve: true }) === false);
  t.check('pestañas: Nuevas (esperando al vendedor) / Necesitan decisión / Resueltas',
    tabOf({ orderStatus: 'en_disputa', rule: null, response: null, responsesAvailable: true, openedAt: ago(H) }) === 'nuevas'
    && tabOf({ orderStatus: 'en_disputa', rule: null, response: null, responsesAvailable: true, openedAt: ago(50 * H) }) === 'decidir'
    && tabOf({ orderStatus: 'en_disputa', rule: r1, response: null, responsesAvailable: true, openedAt: ago(H) }) === 'decidir'
    && tabOf({ orderStatus: 'en_disputa', rule: null, response: null, responsesAvailable: false, openedAt: ago(H) }) === 'decidir'
    && tabOf({ orderStatus: 'resuelto', rule: null, response: null, responsesAvailable: true }) === 'resueltas');
  t.check('pctOf: reembolsar 100, liberar 0, dividir solo 1..99', pctOf('refund') === 100 && pctOf('release') === 0 && pctOf('split', 30) === 30 && pctOf('split', 0) === null && pctOf('split', 100) === null && pctOf('x') === null);

  /* ---------- Rol admin (servidor) ---------- */
  const prevAdmins = process.env.ADMIN_EMAILS; delete process.env.ADMIN_EMAILS;
  t.check('ADMIN_EMAILS por defecto = usuario maestro', adminEmails().join() === MASTER);
  t.check('isAdminUser: correo del maestro (mayúsculas/espacios), email_verified=false nunca', isAdminUser({ email: ' BobbyAliensShop@Gmail.com ' }) && !isAdminUser({ email: MASTER, emailVerified: false }) && !isAdminUser({ email: 'otro@gmail.com' }) && !isAdminUser(null));
  process.env.ADMIN_EMAILS = 'a@x.com, b@y.com';
  t.check('ADMIN_EMAILS reemplaza el default', isAdminUser({ email: 'b@y.com' }) && !isAdminUser({ email: MASTER }));
  delete process.env.ADMIN_EMAILS;

  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app';
  const kp = Keypair.random();
  process.env.DISPUTE_RESOLVER_PUBLIC = kp.publicKey();
  const adminTok = await token({ sub: 'admin-sub', email: MASTER });
  const userTok = await token({ sub: 'seller-sub' });
  const unverifiedTok = await token({ sub: 'x-sub', email: MASTER, emailVerified: false });
  let db = fakeDb(); __setDbForTests(db);
  const o1 = seed(db, { slug: 'adm001' });
  const ACTIONS = ['admin_me', 'admin_list', 'admin_get', 'admin_ai', 'admin_decide', 'admin_guest_refund'];
  const noTok = await Promise.all(ACTIONS.map((a) => post(null, { action: a, slug: 'adm001' })));
  t.check('sin sesión: todas las acciones admin -> 401', noTok.every((r) => r.code === 401), noTok.map((r) => r.code).join());
  const nonAdmin = await Promise.all(ACTIONS.map((a) => post(userTok, { action: a, slug: 'adm001', outcome: 'refund', note: 'hola', confirm: true, admin: true, email: MASTER })));
  t.check('no admin (aunque mande admin:true / email en el body): todas -> 404', nonAdmin.every((r) => r.code === 404 && r.body.code === 'not_found'), nonAdmin.map((r) => r.code).join());
  t.check('token con email_verified=false -> 404', (await post(unverifiedTok, { action: 'admin_me' })).code === 404);
  t.check('el no admin no cambió nada (sin auditoría ni resolución)', db.tables.orders[0].status === 'en_disputa' && !(db.tables.dispute_decisions ?? []).length && !db.tables.order_events.some((e: any) => e.kind === 'dispute_decision'));
  const me = await post(adminTok, { action: 'admin_me' });
  t.check('admin (maestro) -> admin_me 200', me.code === 200 && me.body.admin === true && me.body.email === MASTER, `${me.code} ${JSON.stringify(me.body)}`);

  /* ---------- Lista y detalle ---------- */
  __setChainForTests({ releaseGuard: async () => ({ disputed: true, released: false, resolved: false, approved: false } as any), getBalance: async () => 2,
    resolveDispute: async (_c: string, secret: string, dist: any) => { calls.push({ secret: secret === kp.secret(), dist }); return { hash: 'd'.repeat(64) } as any; } });
  const calls: any[] = [];
  db.tables.chat_conversations = [{ id: 'conv-order', ctx: 'order:adm001', order_slug: 'adm001', buyer_id: o1.buyer_user_id, seller_user_id: 'seller-sub' }, { id: 'conv-store', ctx: 'store', order_slug: null, buyer_id: o1.buyer_user_id, seller_user_id: 'seller-sub' }];
  db.tables.chat_messages = [{ id: 1, conversation_id: 'conv-store', sender: 'buyer', body: '¿La bici tiene detalles?', created_at: ago(7 * D) }, { id: 2, conversation_id: 'conv-order', sender: 'seller', body: 'Te la envié', created_at: ago(4 * D) }];
  const list = await post(adminTok, { action: 'admin_list' });
  t.check('admin_list: la disputa con monto, partes, motivo, plazo y pestaña', list.code === 200 && list.body.disputes.length === 1 && list.body.disputes[0].slug === 'adm001' && list.body.disputes[0].price_crc === 150000
    && list.body.disputes[0].reason_label === 'No es lo descrito' && !!list.body.disputes[0].deadline && list.body.disputes[0].buyer.kind === 'invitado' && typeof list.body.counts.decidir === 'number', JSON.stringify(list.body).slice(0, 300));
  t.check('admin_list: sin datos del comprador (sin sub completo, sin address)', !JSON.stringify(list.body).includes('abcdef0123456789') && !JSON.stringify(list.body).includes('GPLATFORM'));
  const det = await post(adminTok, { action: 'admin_get', slug: 'adm001' });
  t.check('admin_get: timeline, envío (foto, guía, hash), chat del pedido + tienda, on-chain y links', det.code === 200 && det.body.timeline.some((e: any) => e.kind === 'dispute_opened')
    && det.body.ship?.photo === 'https://x/ship.jpg' && det.body.ship?.hash === 'sha256:abc' && det.body.chat.order.length === 1 && det.body.chat.store.length === 1
    && det.body.onchain.disputed === true && det.body.links.some((l: any) => l.url.includes('stellar.expert/explorer/testnet/contract/')), JSON.stringify(det.body).slice(0, 400));

  /* ---------- Decisión: validación ---------- */
  const bad = await Promise.all([
    post(adminTok, { action: 'admin_decide', slug: 'adm001', outcome: 'refund', note: '', confirm: true }),
    post(adminTok, { action: 'admin_decide', slug: 'adm001', outcome: 'split', buyer_pct: 0, note: 'motivo', confirm: true }),
    post(adminTok, { action: 'admin_decide', slug: 'adm001', outcome: 'refund', note: 'motivo' }),
    post(adminTok, { action: 'admin_decide', slug: 'adm001', outcome: 'quemar', note: 'motivo', confirm: true }),
  ]);
  t.check('decisión inválida (sin nota / % fuera de 1..99 / sin confirmar / outcome raro) -> 400', bad.every((r) => r.code === 400), bad.map((r) => r.body.code).join());

  /* ---------- Sin secreto en el servidor: registrada, pendiente on-chain ---------- */
  delete process.env.DISPUTE_RESOLVER_SECRET;
  const pend = await post(adminTok, { action: 'admin_decide', slug: 'adm001', outcome: 'split', buyer_pct: 60, note: 'Llegó dañada, el vendedor ofrece arreglo', confirm: true });
  t.check('sin DISPUTE_RESOLVER_SECRET: decisión auditada como pending_onchain + comando del script', pend.code === 200 && pend.body.executed === false && /resolve-dispute\.ts adm001 60/.test(pend.body.command)
    && db.tables.orders[0].status === 'en_disputa' && db.tables.dispute_decisions?.[0]?.status === 'pending_onchain' && calls.length === 0, JSON.stringify(pend.body));

  /* ---------- Con secreto: misma resolución on-chain que el script + auditoría ---------- */
  process.env.DISPUTE_RESOLVER_SECRET = kp.secret();
  const ok = await post(adminTok, { action: 'admin_decide', slug: 'adm001', outcome: 'refund', note: 'Nunca envió foto válida', confirm: true, rule_id: 'envio_sin_prueba' });
  const audit = (db.tables.dispute_decisions ?? []).find((x: any) => x.status === 'executed');
  t.check('reembolso: on-chain con el secreto del resolver y todo al comprador (platform)', ok.code === 200 && ok.body.executed === true && calls.length === 1 && calls[0].secret
    && calls[0].dist.length === 1 && calls[0].dist[0].address === 'GPLATFORM' && calls[0].dist[0].amount === 2, JSON.stringify({ b: ok.body, calls }));
  t.check('pedido resuelto y disputa resolved', db.tables.orders[0].status === 'resuelto' && db.tables.orders[0].resolution?.buyerPct === 100 && db.tables.disputes[0].state === 'resolved');
  t.check('auditoría: quién (correo del admin), cuándo, por qué, regla, tx y estado executed', audit?.decided_by === 'admin-sub' && audit.decided_by_email === MASTER && audit.note === 'Nunca envió foto válida'
    && audit.rule_id === 'envio_sin_prueba' && audit.status === 'executed' && audit.resolved_tx === 'd'.repeat(64) && !!audit.created_at && !!audit.executed_at, JSON.stringify(audit));
  t.check('auditoría también en order_events (sirve sin 027)', db.tables.order_events.some((e: any) => e.kind === 'dispute_decision' && e.detail.note === 'Nunca envió foto válida'));
  t.check('invitado con reembolso: tarea "pendiente devolver al comprador"', ok.body.guestRefundPending === true && audit.guest_refund === 'pendiente');
  const again = await post(adminTok, { action: 'admin_decide', slug: 'adm001', outcome: 'release', note: 'otra vez', confirm: true });
  t.check('decidir dos veces -> 409 (ya resuelta), sin otra tx', again.code === 409 && calls.length === 1);
  const lst2 = await post(adminTok, { action: 'admin_list' });
  t.check('resuelta: pestaña Resueltas con la devolución pendiente', lst2.body.disputes[0].tab === 'resueltas' && lst2.body.disputes[0].guest_refund_pending === true);
  const gr = await post(adminTok, { action: 'admin_guest_refund', slug: 'adm001', note: 'SINPE 8888' });
  const lst3 = await post(adminTok, { action: 'admin_list' });
  t.check('marcar devuelto: auditado y la tarea desaparece', gr.code === 200 && audit.guest_refund === 'devuelto' && !!audit.guest_refunded_at && lst3.body.disputes[0].guest_refund_pending === false);

  /* ---------- Script: misma lógica, auditada como script ---------- */
  const o2 = seed(db, { slug: 'adm002', buyer_user_id: 'cavos-buyer', buyer_address: 'GBUYER' });
  const sc = await resolveFromScript(o2, kp.secret(), 0);
  const a2 = db.tables.dispute_decisions.find((x: any) => x.slug === 'adm002');
  t.check('scripts/resolve-dispute.ts usa la misma resolución (liberar al vendedor) y deja auditoría source=script', sc.executed === true && calls[1]?.dist[0]?.address === 'GSELLER' && a2?.source === 'script' && a2.outcome === 'release' && a2.guest_refund === 'no_aplica');

  /* ---------- Respuesta del vendedor ---------- */
  const o3 = seed(db, { slug: 'adm003' });
  const buyerTok = await token({ sub: 'otro-sub' });
  const rb = await post(buyerTok, { action: 'seller_respond', slug: 'adm003', body: 'No soy el vendedor' });
  t.check('respuesta: solo el vendedor del pedido (otro -> 403)', rb.code === 403);
  const rnop = await post(userTok, { action: 'seller_respond', slug: 'adm003', body: 'Lo envié bien', photo: 'https://x/listings/foto.jpg' });
  t.check('respuesta con foto que no es de la cámara -> 400', rnop.code === 400);
  const rs = await post(userTok, { action: 'seller_respond', slug: 'adm003', body: 'Lo envié bien empacado, adjunto guía CR123' });
  const rg = await post(userTok, { action: 'seller_response_get', slug: 'adm003' });
  t.check('vendedor responde y la lee (con 027)', rs.code === 200 && rg.body.response?.body.startsWith('Lo envié') && rg.body.available === true && !!rg.body.deadline);
  const d3 = await post(adminTok, { action: 'admin_get', slug: 'adm003' });
  t.check('el admin ve la respuesta del vendedor', d3.body.response?.body.startsWith('Lo envié') && d3.body.has_response === true);
  void o3;

  /* ---------- IA: sin PII, caché, sin credencial ---------- */
  const prevKey = process.env.AI_GATEWAY_API_KEY; delete process.env.AI_GATEWAY_API_KEY; delete process.env.VERCEL_OIDC_TOKEN;
  t.check('IA sin credencial -> no disponible (Resumen IA no disponible)', aiStatus({ headers: {} }).available === false && aiStatus({ headers: {} }).reason === 'no_credentials');
  const noAi = await post(adminTok, { action: 'admin_ai', slug: 'adm003' });
  t.check('admin_ai sin credencial -> available:false, sin error', noAi.code === 200 && noAi.body.available === false);
  const input = buildAiInput({ product: 'Bici', priceCrc: 150000, delivery: 'envio', reason: 'no_llego', description: 'Escríbeme a maria.perez@gmail.com o al +506 8888-7777, IBAN CR05015202001026284066', evidenceCount: 1,
    openedAt: ago(H), timeline: [{ kind: 'funded', at: ago(2 * D) }], ship: { shipped: true, photo: true, note: false, hash: true }, response: { body: 'Mi WhatsApp 88887777', photo: false, at: ago(1000) },
    chat: [{ from: 'comprador', body: 'mi correo es juan@x.com', at: ago(D), ctx: 'pedido' }], rule: null });
  const js = JSON.stringify(input);
  t.check('entrada a la IA sin correos, teléfonos ni IBAN', !/@|8888|7777|CR05/.test(js) && js.includes('[correo]') && js.includes('[número]'), js.slice(0, 300));
  t.check('redact tapa links y direcciones Stellar', !/https?:/.test(redact('ver https://evil.com/x y G' + 'A'.repeat(55))));
  t.check('parseAiOutput valida recomendación y normaliza %', parseAiOutput('{"resumen":"Llegó rota","recomendacion":"refund","porcentaje_comprador":20,"confianza":"alta","razones":["foto"]}', 'm')?.buyerPct === 100
    && parseAiOutput('{"resumen":"x","recomendacion":"split","porcentaje_comprador":150}', 'm')?.buyerPct === 50 && parseAiOutput('nada', 'm') === null && parseAiOutput('{"resumen":"x","recomendacion":"robar"}', 'm') === null);
  let n = 0; let sent = '';
  __setAiCallerForTests(async ({ user }) => { n++; sent = user; return '{"resumen":"El vendedor respondió con guía; falta evidencia del daño.","recomendacion":"split","porcentaje_comprador":40,"confianza":"media","razones":["hay guía","foto del comprador"]}'; });
  const a1 = await post(adminTok, { action: 'admin_ai', slug: 'adm003' });
  const a1b = await post(adminTok, { action: 'admin_ai', slug: 'adm003' });
  t.check('admin_ai con modelo: resumen + recomendación + confianza; caché por disputa (1 llamada)', a1.code === 200 && a1.body.result?.recommendation === 'split' && a1.body.result.buyerPct === 40 && a1.body.result.confidence === 'media'
    && a1b.body.cached === true && n === 1 && db.tables.dispute_ai_summaries?.length === 1, JSON.stringify(a1.body));
  t.check('al modelo no van ids de cuenta del comprador', !sent.includes('abcdef0123456789') && !sent.includes('GPLATFORM'));
  __setAiCallerForTests(null); if (prevKey) process.env.AI_GATEWAY_API_KEY = prevKey;

  /* ---------- Auto-resolución apagada por defecto ---------- */
  const ar = await autoResolvePass();
  t.check('cron: auto-resolución apagada por defecto (no toca disputas)', ar.skipped === 'flag_off' && ar.resolved.length === 0);

  /* ---------- SIN la migración 027 ---------- */
  db = withoutMigration(fakeDb()); __setDbForTests(db);
  seed(db, { slug: 'nom001', shipped_at: null, shipped_tx: null, ship_evidence: null, funded_at: ago(5 * D) });
  const l0 = await post(adminTok, { action: 'admin_list' });
  t.check('sin 027: admin_list funciona (regla sin_envio, sin respuesta del vendedor)', l0.code === 200 && l0.body.disputes[0]?.rule?.rule === 'sin_envio' && l0.body.capabilities.responses === false && l0.body.flags.autoResolve === false, JSON.stringify(l0.body).slice(0, 300));
  const g0 = await post(adminTok, { action: 'admin_get', slug: 'nom001' });
  t.check('sin 027: detalle funciona (responses_available=false, IA sin caché)', g0.code === 200 && g0.body.responses_available === false && g0.body.ai.cache_available === false);
  const s0 = await post(userTok, { action: 'seller_respond', slug: 'nom001', body: 'Mi versión' });
  const s0g = await post(userTok, { action: 'seller_response_get', slug: 'nom001' });
  t.check('sin 027: el vendedor no puede responder (503 claro) y la app lo oculta (available=false)', s0.code === 503 && s0.body.code === 'responses_unavailable' && s0g.code === 200 && s0g.body.available === false);
  const k0 = await post(adminTok, { action: 'admin_decide', slug: 'nom001', outcome: 'refund', note: 'Nunca lo envió', confirm: true, rule_id: 'sin_envio' });
  t.check('sin 027: la decisión se ejecuta y la auditoría queda en order_events', k0.code === 200 && k0.body.executed === true && db.tables.orders[0].status === 'resuelto'
    && db.tables.order_events.some((e: any) => e.kind === 'dispute_decision' && e.detail.decided_by_email === MASTER && e.detail.note === 'Nunca lo envió'), JSON.stringify(k0.body));
  const l1 = await post(adminTok, { action: 'admin_list' });
  t.check('sin 027: tarea de devolución al invitado reconstruida desde order_events', l1.body.disputes[0].guest_refund_pending === true && l1.body.disputes[0].decision?.status === 'executed');
  await post(adminTok, { action: 'admin_guest_refund', slug: 'nom001' });
  const l2 = await post(adminTok, { action: 'admin_list' });
  t.check('sin 027: marcar devuelto también funciona', l2.body.disputes[0].guest_refund_pending === false);
  __setChainForTests(null); delete process.env.DISPUTE_RESOLVER_SECRET; delete process.env.DISPUTE_RESOLVER_PUBLIC;
  if (prevAdmins != null) process.env.ADMIN_EMAILS = prevAdmins;

  /* ---------- Copy ---------- */
  const BANNED = /(?<!\p{L})(segur[oa]s?|seguridad|garant\p{L}*|verificad[oa]s?|empresa\p{L}*|fintech|banco\p{L}*|billetera\p{L}*|proteg\p{L}*)(?!\p{L})/iu;
  const files = ['app/admin/disputas.tsx', 'app/admin/disputa.tsx', 'components/AdminDisputesButton.tsx', 'components/AdminNotFound.tsx', 'components/SellerDisputeReply.tsx', 'api/_lib/disputeRules.ts', 'api/_lib/disputeView.ts', 'lib/demoAdmin.ts'];
  for (const f of files) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const strings: string[] = [...(src.match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1/g) ?? []), ...(src.match(/>[^<>{}\n]+</g) ?? [])];
    const bad = strings.filter((s) => BANNED.test(s));
    t.check(`${f}: copy sin palabras prohibidas`, bad.length === 0, bad[0]);
  }
  const ui = ['app/admin/disputa.tsx', 'components/SellerDisputeReply.tsx'].map((f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')).join('\n');
  t.check('sin emojis en las pantallas nuevas (iconos)', !/\p{Extended_Pictographic}/u.test(ui));
  const tabs = readFileSync(new URL('../../app/(tabs)/_layout.tsx', import.meta.url), 'utf8');
  t.check('sin 4.ª pestaña (la entrada es un icono en Home)', (tabs.match(/<Tabs\.Screen /g) ?? []).length === 3 && readFileSync(new URL('../../app/(tabs)/pedidos.tsx', import.meta.url), 'utf8').includes('<AdminDisputesButton />'));
}
