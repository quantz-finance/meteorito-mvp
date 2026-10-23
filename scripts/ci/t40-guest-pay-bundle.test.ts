// (40) Regresión "comprar sin cuenta": POST /api/escrow/pay -> 500 "Cannot find module api/_lib/push" en Vercel.
// Causa: advance() hacía import('./push') (relativo, dinámico): Vercel no lo empaqueta. Rompía todo cambio de estado.
import type { T } from './setup';
import { baseEnv } from './setup';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fakeDb } from './fakedb';

export async function run(t: T) {
  const root = new URL('../../api', import.meta.url).pathname;
  const bad: string[] = [];
  const scan = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) scan(p); else if (f.endsWith('.ts')) for (const m of readFileSync(p, 'utf8').matchAll(/\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) bad.push(`${f}:${m[1]}`); } };
  scan(root);
  t.check('api/: ningún import() relativo (Vercel no los empaqueta)', bad.length === 0, bad.join(', '));
  const db = readFileSync(join(root, '_lib/db.ts'), 'utf8');
  t.check('db.ts importa push estáticamente', /^import \{ notifyOrder \} from '\.\/push';/m.test(db));
  baseEnv();
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
  const mod = await import('../../api/_lib/db');
  const fake = fakeDb(); mod.__setDbForTests(fake);
  fake.tables.orders.push({ id: 'o1', slug: 'abc123', status: 'creado', seller_user_id: 's', buyer_user_id: 'guest:x', brand: '', model: 'X' });
  const e = await mod.advance('o1', 'creado', { status: 'escrow_creado', contract_id: 'C1' }).then(() => null, (x: any) => x);
  t.check('advance() cambia el estado (comprador invitado) sin depender del push', e === null && fake.tables.orders[0].status === 'escrow_creado', String(e?.message));
}
