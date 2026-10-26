// (96) Bug de prod 9781o4: cara a cara + PIN correcto -> aprobó on-chain y la DB rechazó 'fondeado -> entregado'; el reintento
// chocaba con TW 400 "already approved". Sin red. Cubre:
//  - El guard de transiciones de la ÚLTIMA migración que define orders_status_guard (emulado sobre fakeDb) permite
//    'fondeado -> entregado' SOLO para delivery_mode = 'cara_a_cara' y mantiene todas las transiciones de 005.
//  - approveAndRelease idempotente: si el hito ya está aprobado on-chain, no re-aprueba y libera (PIN, "Recibí" y cron).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { T } from './setup';
import { baseEnv } from './setup';
import { installTestJwks, req, res, token } from './jwt';
import { fakeDb } from './fakedb';
import { __setDbForTests } from '../../api/_lib/db';
import { approveAndRelease, pinHash, __setChainForTests } from '../../api/_lib/escrow';

const MIG = join(__dirname, '../../supabase/migrations');
const OLD_PAIRS = ['creado>escrow_creado', 'creado>cancelado', 'escrow_creado>cancelado', 'escrow_creado>fondeado', 'fondeado>enviado', 'enviado>entregado',
  'entregado>liberado', 'fondeado>en_disputa', 'enviado>en_disputa', 'entregado>en_disputa', 'en_disputa>resuelto'];

/** Lee el guard de la última migración que lo define: pares permitidos + excepciones condicionadas a delivery_mode. */
function loadGuard() {
  const file = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort().filter((f) => /function public\.orders_status_guard\(\)/.test(readFileSync(join(MIG, f), 'utf8'))).pop()!;
  const sql = readFileSync(join(MIG, file), 'utf8');
  const body = sql.slice(sql.indexOf('function public.orders_status_guard()'));
  const block = body.slice(body.indexOf('not in ('), body.indexOf('raise exception'));
  const cut = block.indexOf('and not (');
  const pairs = (s: string) => [...s.matchAll(/\('(\w+)','(\w+)'\)/g)].map((m) => `${m[1]}>${m[2]}`);
  const allowed = new Set(pairs(cut >= 0 ? block.slice(0, cut) : block));
  const cond = cut >= 0 ? { pairs: new Set(pairs(block.slice(cut))), mode: /new\.delivery_mode = '(\w+)'/.exec(block.slice(cut))?.[1] } : null;
  const ok = (from: string, to: string, mode: string) => from === to || allowed.has(`${from}>${to}`) || !!(cond?.pairs.has(`${from}>${to}`) && cond.mode === mode);
  return { file, allowed, cond, ok };
}

/** Pedido en fakeDb con el guard: un cambio de status inválido falla como el trigger de Postgres (P0001). */
function guarded(row: any, guard: ReturnType<typeof loadGuard>) {
  let status = row.status; delete row.status;
  Object.defineProperty(row, 'status', { enumerable: true, configurable: true, get: () => status, set: (v) => {
    if (!guard.ok(status, v, row.delivery_mode ?? 'envio')) throw Object.assign(new Error(`transición inválida ${status} -> ${v}`), { code: 'P0001' });
    status = v;
  } });
  return row;
}

function stubChain(approvedAtStart: boolean) {
  const calls: string[] = []; let approved = approvedAtStart; let released = false;
  __setChainForTests({
    releaseGuard: async () => { calls.push('guard'); return { esc: null, disputed: false, released, resolved: false, approved } as any; },
    approveMilestone: async () => { calls.push('approve'); if (approved) throw Object.assign(new Error('TW /escrow/single-release/approve-milestone 400: You cannot approve a milestone that has already been approved previously'), { status: 400 }); approved = true; return { hash: 'a'.repeat(64) } as any; },
    getBalance: async () => 23.6002125,
    releaseFunds: async () => { calls.push('release'); released = true; return { hash: 'r'.repeat(64) } as any; },
  });
  return calls;
}

export async function run(t: T) {
  baseEnv();
  process.env.APPROVER_SECRET ||= 'SBMUIURQN7BHVZ6QRNNIB3VIKUM3ZZ2UVHJDLRBVULXA2VTIZVOYY7RN';
  process.env.RELEASE_SIGNER_SECRET ||= 'SBMUIURQN7BHVZ6QRNNIB3VIKUM3ZZ2UVHJDLRBVULXA2VTIZVOYY7RN';
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  const warn = console.warn, err = console.error; console.warn = () => {}; console.error = () => {};
  try {
    /* ---------- 1) Migración: guard ---------- */
    const g = loadGuard();
    t.check(`guard vigente en ${g.file} (032 o posterior)`, g.file >= '032', g.file);
    t.check('guard: todas las transiciones de 005 intactas', OLD_PAIRS.every((p) => g.allowed.has(p)) && g.allowed.size === OLD_PAIRS.length, [...g.allowed].join(' '));
    t.check("guard: fondeado -> entregado permitido para 'cara_a_cara'", g.ok('fondeado', 'entregado', 'cara_a_cara'));
    t.check('guard: fondeado -> entregado sigue prohibido para envío', !g.ok('fondeado', 'entregado', 'envio'));
    t.check('guard: fondeado -> liberado prohibido (también cara a cara)', !g.ok('fondeado', 'liberado', 'cara_a_cara'));
    const sql017 = readFileSync(join(MIG, '017_agreed_window.sql'), 'utf8');
    t.check("columna delivery_mode con valor 'cara_a_cara' (017)", /add column if not exists delivery_mode text/.test(sql017) && /'cara_a_cara'/.test(sql017));

    const { default: confirm } = await import('../../api/escrow/confirm');
    const { default: cron } = await import('../../api/escrow/cron');
    const seller = await token({ sub: 'seller-96' });
    const mk = (db: any, over: any = {}) => {
      const id = over.id ?? '96969696-9696-4969-8969-969696969696';
      const row = guarded({ id, slug: 'f2f096', status: 'fondeado', delivery_mode: 'cara_a_cara', protection_minutes: 1440, seller_user_id: 'seller-96', buyer_user_id: 'guest:b96',
        contract_id: 'CNOTUSED', amount_usdc: 23.6002125, pin_attempts: 0, delivery_pin_hash: pinHash(id, '135790'), funded_tx: 'f'.repeat(64),
        funded_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), auto_release_at: new Date(Date.now() - 86_400_000).toISOString(), ...over }, g);
      db.tables.orders.push(row); return row;
    };

    /* ---------- 2) PIN cara a cara, flujo normal (primer intento) ---------- */
    let db = fakeDb(); __setDbForTests(db as any); let o = mk(db); let calls = stubChain(false);
    let r = res(); await confirm(req(seller, { slug: 'f2f096', reason: 'pin', pin: '135790' }), r);
    t.check('PIN cara a cara desde fondeado -> 200 liberado', r.code === 200 && o.status === 'liberado' && o.released_tx === 'r'.repeat(64), `${r.code} ${r.body?.error} ${o.status}`);
    t.check('PIN: aprueba una vez y libera', calls.filter((c) => c === 'approve').length === 1 && calls.includes('release') && o.approved_tx === 'a'.repeat(64) && o.approval_reason === 'pin');

    /* ---------- 3) Pedido trabado (9781o4): hito ya aprobado on-chain, DB en fondeado ---------- */
    db = fakeDb(); __setDbForTests(db as any); o = mk(db); calls = stubChain(true);
    r = res(); await confirm(req(seller, { slug: 'f2f096', reason: 'pin', pin: '135790' }), r);
    t.check('reintento PIN con hito ya aprobado -> 200 liberado (sin TW 400)', r.code === 200 && o.status === 'liberado', `${r.code} ${r.body?.error} ${o.status}`);
    t.check("no re-aprueba; approved_tx = 'onchain-preexisting'", !calls.includes('approve') && calls.includes('release') && o.approved_tx === 'onchain-preexisting');
    t.check('evento approved con preexisting', db.tables.order_events.some((e: any) => e.kind === 'approved' && e.detail?.preexisting === true));

    // "Recibí" del comprador (mismo camino approveAndRelease con reason buyer_confirm)
    db = fakeDb(); __setDbForTests(db as any); o = mk(db, { approved_tx: 'h'.repeat(64) }); calls = stubChain(true);
    const out = await approveAndRelease({ ...o }, 'buyer_confirm').catch((e) => ({ error: e.message }));
    t.check('"Recibí" con hito ya aprobado -> liberado, reusa el hash guardado', (out as any).releasedTx && o.status === 'liberado' && o.approved_tx === 'h'.repeat(64) && !calls.includes('approve'), JSON.stringify(out));

    // Cron (plazo vencido, reason timeout)
    db = fakeDb(); __setDbForTests(db as any); o = mk(db); calls = stubChain(true);
    r = res(); await cron({ method: 'POST', query: {}, headers: { authorization: 'Bearer ci-cron' } }, r);
    t.check('cron con hito ya aprobado -> liberado', r.code === 200 && o.status === 'liberado' && !calls.includes('approve'), `${r.code} ${JSON.stringify(r.body?.processed)} ${o.status}`);

    /* ---------- 4) Envío no salta el paso de envío ---------- */
    db = fakeDb(); __setDbForTests(db as any); o = mk(db, { delivery_mode: 'envio' }); calls = stubChain(false);
    r = res(); await confirm(req(seller, { slug: 'f2f096', reason: 'pin', pin: '135790' }), r);
    t.check('envío en fondeado + PIN -> 409, no aprueba ni libera', r.code === 409 && o.status === 'fondeado' && !calls.includes('approve'), `${r.code} ${o.status}`);
  } finally { console.warn = warn; console.error = err; __setChainForTests(null); }
}
