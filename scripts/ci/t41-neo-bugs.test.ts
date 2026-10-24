// (41) Bugs reportados por Neo (TDD: estos casos fallaban antes del fix).
//  a) PIN bloqueado (3 intentos) NO debe dejar que el auto-release pague al vendedor.
//  b) Invitación: un error de base al verificar la reserva debe CERRAR (503), no dejar pagar a cualquiera.
//  c) Auto-invitación: el vendedor no puede aceptar su propia invitación (misma llave de invitado).
//  d) Pedido reembolsado ('resuelto' a favor del comprador) no debe decir "Pago liberado".
//  e) Pedidos del vendedor: solo con sesión y solo los suyos (antes: RPC pública con cualquier dirección).
import { Keypair } from '@stellar/stellar-sdk';
import { readFileSync, existsSync } from 'node:fs';
import type { T } from './setup';
import { baseEnv } from './setup';
import { installTestJwks, req, res, token } from './jwt';
import { fakeDb } from './fakedb';
import { __setDbForTests } from '../../api/_lib/db';
import { proofMessage } from '../../api/_lib/auth';
import { guestSubFromReq } from '../../api/_lib/guest';
import { publicPrefix } from '../../api/_lib/photos';
import { __setHorizonForTests } from '../../api/_lib/wallet';
import { env } from '../../api/_lib/env';
import { approveAndRelease } from '../../api/_lib/escrow';
import { resolvedLabel } from '../../lib/status';

const sellerProof = () => {
  const kp = Keypair.random(); const ts = Math.floor(Date.now() / 1000);
  const message = proofMessage('create', 'new', kp.publicKey(), ts);
  const pre = Buffer.concat([Buffer.from('Cavos Signed Message:\n'), Buffer.from(String(Buffer.byteLength(message))), Buffer.from('\n'), Buffer.from(message)]);
  return { address: kp.publicKey(), publicKey: kp.publicKey(), message, signature: kp.sign(pre).toString('base64') };
};

export async function run(t: T) {
  baseEnv();
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  __setHorizonForTests(() => ({ loadAccount: async (a: string) => ({ id: a, balances: [{ asset_code: 'USDC', asset_issuer: env.usdcIssuer() }] }) }));
  const warn = console.warn, err = console.error; console.warn = () => {}; console.error = () => {};
  try {
    // a) PIN bloqueado
    const db = fakeDb(); __setDbForTests(db as any);
    const locked = { id: 'o-a', slug: 'pinlck', status: 'enviado', contract_id: 'CX', pin_attempts: 3 };
    const ea = await approveAndRelease(locked, 'timeout').then(() => null, (e: any) => e);
    t.check('a) PIN bloqueado: auto-release rechazado (423 pin_locked) antes de tocar la red', ea?.status === 423 && ea?.code === 'pin_locked', `${ea?.status} ${ea?.code} ${ea?.message}`);

    // b) Reserva de invitación con error de base -> 503 (fail-closed)
    const { inviteForOrder } = await import('../../api/_lib/invites');
    const broken = { from: (tb: string) => { const q: any = { select: () => q, eq: () => q, maybeSingle: async () => (tb === 'invitations' ? { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } } : { data: null, error: null }) }; return q; } };
    __setDbForTests(broken as any);
    const eb = await inviteForOrder('abc123').then(() => null, (e: any) => e);
    t.check('b) error de base al verificar la reserva -> 503 invite_check_failed', eb?.status === 503 && eb?.code === 'invite_check_failed', `${eb?.status} ${eb?.code}`);
    const missing = { from: () => { const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.invitations' in the schema cache" } }) }; return q; } };
    __setDbForTests(missing as any);
    t.check('b) sin tabla de invitaciones (migración no aplicada) -> sin reserva, el pago sigue', (await inviteForOrder('abc123')) === null);

    // c) Auto-invitación: misma llave de invitado
    const create = (await import('../../api/orders/create')).default;
    const key = 'a'.repeat(64);
    const guestSub = guestSubFromReq({ headers: { 'x-guest-key': key } })!;
    const db2 = fakeDb(); __setDbForTests(db2 as any);
    db2.tables.invitations.push({ code: 'inv00001', buyer_user_id: guestSub, status: 'abierta', price_crc: 5000, brand: '', model: 'Algo' });
    const r = res(); const rq: any = req(await token({ sub: 'seller-c' }), { title: 'Algo bonito', price_crc: 5000, photos: [publicPrefix('seller-c') + 'listing-44444444-4444-4444-8444-444444444444/0.jpg'], invite: 'inv00001', proof: sellerProof() });
    rq.headers['x-guest-key'] = key;
    await create(rq, r);
    t.check('c) el vendedor no puede aceptar su propia invitación (misma llave) -> 400', r.code === 400 && /propia invitación/.test(r.body?.error ?? ''), `${r.code} ${r.body?.error}`);
    const api = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8');
    t.check('c) el cliente manda su llave de invitado al crear el link', /orders\/create[\s\S]{0,200}X-Guest-Key|X-Guest-Key[\s\S]{0,200}orders\/create/.test(api));

    // d) Reembolso no dice "Pago liberado"
    t.check('d) resuelto 100% al comprador -> "Reembolsado"', resolvedLabel({ status: 'resuelto', resolution: { buyerPct: 100 } }) === 'Reembolsado');
    t.check('d) resuelto 0% al comprador -> pago al vendedor', /vendedor/i.test(resolvedLabel({ status: 'resuelto', resolution: { buyerPct: 0 } })));
    t.check('d) resuelto parcial -> porcentaje', /40 %/.test(resolvedLabel({ status: 'resuelto', resolution: { buyerPct: 40 } })));
    t.check('d) resuelto sin detalle -> "Disputa resuelta" (nunca "Pago liberado")', resolvedLabel({ status: 'resuelto' }) === 'Disputa resuelta');
    t.check('d) liberado -> "Pago liberado"', resolvedLabel({ status: 'liberado' }) === 'Pago liberado');
    const pb = readFileSync(new URL('../../components/PayBox.tsx', import.meta.url), 'utf8');
    t.check('d) PayBox usa resolvedLabel (no un texto fijo)', /resolvedLabel\(order\)/.test(pb) && !/'Entregado' : 'Pago liberado'/.test(pb));

    // e) Pedidos del vendedor por API con sesión
    const store = (await import('../../api/store/index')).default;
    const db3 = fakeDb(); __setDbForTests(db3 as any);
    db3.tables.orders.push({ id: '1', slug: 'mio001', seller_user_id: 'seller-e', seller_address: 'GA', status: 'creado', brand: '', model: 'Mío', price_crc: 1000, category: 'otro', created_at: '2026-01-01' },
      { id: '2', slug: 'otro01', seller_user_id: 'otro', seller_address: 'GB', status: 'fondeado', brand: '', model: 'Ajeno', price_crc: 1000, category: 'otro', created_at: '2026-01-01' });
    const r2 = res(); await store(req(await token({ sub: 'seller-e' }), { action: 'orders' }), r2);
    const slugs = (r2.body?.orders ?? []).map((o: any) => o.slug);
    t.check('e) action orders: solo los pedidos del vendedor con sesión', r2.code === 200 && slugs.join() === 'mio001', `${r2.code} ${JSON.stringify(r2.body).slice(0, 120)}`);
    const r3 = res(); await store(req(null, { action: 'orders' }), r3);
    t.check('e) sin sesión -> 401', r3.code === 401);
    const orders = readFileSync(new URL('../../lib/orders.ts', import.meta.url), 'utf8');
    t.check('e) el cliente ya no llama a la RPC pública seller_orders', !/restRpc<[^>]*>\('seller_orders/.test(orders));
    const mig = new URL('../../supabase/migrations/013_security_resolution.sql', import.meta.url);
    const sql = existsSync(mig) ? readFileSync(mig, 'utf8') : '';
    t.check('e) migración 013 revoca seller_orders(_v2) a anon y expone resolution (aditiva)', /revoke execute on function public\.seller_orders\(text\) from anon/i.test(sql) && /seller_orders_v2\(text\) from anon/i.test(sql) && /resolution/.test(sql) && !/\bdrop\s+(table|column)/i.test(sql));
  } finally { console.warn = warn; console.error = err; }
}
