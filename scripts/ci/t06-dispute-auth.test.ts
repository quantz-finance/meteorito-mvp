// (6a) Disputa: solo el comprador y solo antes de liberar (unit, DB falsa, sin red). También vía handler HTTP.
import type { T } from './setup';
import { installTestJwks, req, res, token } from './jwt';
import { __setDbForTests, fail } from '../../api/_lib/db';
import { openDispute } from '../../api/_lib/escrow';
import { fakeDb } from './fakedb';
import dispute from '../../api/escrow/dispute';

export async function run(t: T) {
  const base = { id: '22222222-2222-4222-8222-222222222222', slug: 'dsp001', contract_id: 'CNOTUSED', buyer_user_id: 'buyer', seller_user_id: 'seller', amount_usdc: 1 };
  const input = { reason: 'no_funciona' as const, description: 'ci', evidence: [] };
  const code = (e: any) => { const r: any = { status: (c: number) => { r.c = c; return r; }, setHeader: () => r, send: () => r }; fail(r, e); return r.c; };
  const cases: [string, any, string, number][] = [
    ['vendedor (fondeado) -> 403', { ...base, status: 'fondeado' }, 'seller', 403],
    ['vendedor (enviado) -> 403', { ...base, status: 'enviado' }, 'seller', 403],
    ['vendedor (entregado) -> 403', { ...base, status: 'entregado' }, 'seller', 403],
    ['tercero -> 403', { ...base, status: 'enviado' }, 'otro', 403],
    ['comprador tras liberar (liberado) -> 409', { ...base, status: 'liberado', released_tx: 'x' }, 'buyer', 409],
    ['comprador con released_tx (entregado) -> 409', { ...base, status: 'entregado', released_tx: 'x' }, 'buyer', 409],
    ['comprador tras resolución -> 409', { ...base, status: 'resuelto' }, 'buyer', 409],
    ['comprador antes de pagar -> 409', { ...base, status: 'escrow_creado' }, 'buyer', 409],
  ];
  for (const [name, order, sub, want] of cases) {
    const db = fakeDb(); __setDbForTests(db);
    let got = 0; try { await openDispute(order, sub, input); } catch (e) { got = code(e); }
    const writes = db.tables.disputes.length + db.tables.order_events.length;
    t.check(name, got === want && writes === 0, `${got} writes=${writes}`);
  }
  // Vía HTTP con JWT de prueba
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app';
  const db = fakeDb(); __setDbForTests(db);
  db.tables.orders.push({ ...base, status: 'enviado' });
  const r = res(); await dispute(req(await token({ sub: 'seller' }), { slug: 'dsp001', reason: 'no_llego' }), r);
  t.check('POST /api/escrow/dispute como vendedor -> 403', r.code === 403, `${r.code} ${r.body?.error}`);
  const r2 = res(); await dispute(req(null, { slug: 'dsp001', reason: 'no_llego' }), r2);
  t.check('POST /api/escrow/dispute sin token -> 401', r2.code === 401, `${r2.code}`);
}
