// (4) PIN: 3 intentos fallidos -> bloqueado (429) incluso con el PIN correcto; nada se aprueba ni libera.
import type { T } from './setup';
import { installTestJwks, req, res, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { pinHash } from '../../api/_lib/escrow';
import { fakeDb } from './fakedb';
import confirm from '../../api/escrow/confirm';

export async function run(t: T) {
  await installTestJwks();
  const db = fakeDb(); __setDbForTests(db);
  const id = '11111111-1111-4111-8111-111111111111';
  db.tables.orders.push({ id, slug: 'pin001', status: 'enviado', seller_user_id: 'seller', buyer_user_id: 'buyer', contract_id: 'CNOTUSED', amount_usdc: 1, pin_attempts: 0, delivery_pin_hash: pinHash(id, '246810') });
  const seller = await token({ sub: 'seller' });
  for (let i = 1; i <= 3; i++) {
    const r = res(); await confirm(req(seller, { slug: 'pin001', reason: 'pin', pin: String(100000 + i) }), r);
    t.check(`PIN incorrecto #${i} -> 401`, r.code === 401, `${r.code} ${r.body?.error}`);
  }
  t.check('pin_attempts = 3', db.tables.orders[0].pin_attempts === 3);
  const r4 = res(); await confirm(req(seller, { slug: 'pin001', reason: 'pin', pin: '246810' }), r4);
  t.check('4º intento con PIN CORRECTO -> 429 bloqueado', r4.code === 429, `${r4.code} ${r4.body?.error}`);
  t.check('pedido sigue en enviado (no aprobó ni liberó)', db.tables.orders[0].status === 'enviado' && !db.tables.orders[0].approved_tx);
  const rb = res(); await confirm(req(await token({ sub: 'buyer' }), { slug: 'pin001', reason: 'pin', pin: '246810' }), rb);
  t.check('comprador no puede usar la vía PIN -> 403', rb.code === 403, `${rb.code}`);
  t.check('se registraron 3 eventos pin_failed', db.tables.order_events.filter((e) => e.kind === 'pin_failed').length === 3);
}
