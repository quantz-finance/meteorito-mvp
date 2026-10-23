// Contrato del API (handlers reales de api/*, base falsa en memoria, JWT de prueba). Sin red ni dinero.
// Reglas: escrituras sin sesión -> 401; método equivocado -> 405; errores con { error: string };
// comprador invitado se identifica solo con X-Guest-Key de 64 hex; nadie ve ni toca pedidos ajenos.
import { test, expect } from '@playwright/test';
import { installTestJwks, res, token } from '../scripts/ci/jwt';
import { fakeDb } from '../scripts/ci/fakedb';
import { __setDbForTests } from '../api/_lib/db';
import { __setHorizonForTests } from '../api/_lib/wallet';
import { env } from '../api/_lib/env';
import { proofMessage } from '../api/_lib/auth';
import { publicPrefix } from '../api/_lib/photos';
import { Keypair } from '@stellar/stellar-sdk';
import create from '../api/orders/create';
import ship from '../api/escrow/ship';
import confirm from '../api/escrow/confirm';
import dispute from '../api/escrow/dispute';
import pay from '../api/escrow/pay';
import cron from '../api/escrow/cron';
import store from '../api/store/index';
import invites from '../api/invites/index';
import upload from '../api/photos/upload-url';
import activate from '../api/wallet/activate';
import submit from '../api/tx/submit';

const KEY_A = 'a'.repeat(64), KEY_B = 'b'.repeat(64);
let db: ReturnType<typeof fakeDb>;
const call = async (h: any, o: { method?: string; body?: any; query?: any; guest?: string; tok?: string; headers?: any } = {}) => {
  const r = res();
  const rq: any = { method: o.method ?? 'POST', headers: { ...(o.guest ? { 'x-guest-key': o.guest } : {}), ...(o.tok ? { authorization: `Bearer ${o.tok}` } : {}), ...(o.headers ?? {}) }, body: o.body ?? {}, query: o.query ?? {} };
  await h(rq, r); return r as { code: number; body: any };
};
const SELLER = Keypair.random();
const signProof = (kp: Keypair, action: string, ref: string) => {
  const ts = Math.floor(Date.now() / 1000); const message = proofMessage(action, ref, kp.publicKey(), ts);
  const pre = Buffer.concat([Buffer.from('Cavos Signed Message:\n'), Buffer.from(String(Buffer.byteLength(message))), Buffer.from('\n'), Buffer.from(message)]);
  return { address: kp.publicKey(), publicKey: kp.publicKey(), message, signature: kp.sign(pre).toString('base64') };
};
/** Cuerpo válido de "crear link" (prueba de dirección + foto propia). */
const sellerBody = (sub: string, over: any = {}) => ({ proof: signProof(SELLER, 'create', 'new'), title: 'iPhone 13', price_crc: 250000, photos: [publicPrefix(sub) + '44444444-4444-4444-8444-444444444444/0.jpg'], ...over });
const order = (o: any) => ({ id: o.slug, kind: 'single', status: 'creado', seller_address: 'G' + 'S'.repeat(55), seller_user_id: 'seller-1', category: 'otro', brand: '', model: 'Bici', condition: '', price_crc: 150000, photos: [], checks: [], created_at: new Date().toISOString(), ...o });

// Mismo entorno que scripts/ci/setup.ts baseEnv() (no se importa: ese archivo es ESM por import.meta).
const baseEnv = () => Object.assign(process.env, {
  STELLAR_NETWORK: 'testnet', SUPABASE_URL: 'https://test.supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test',
  PIN_PEPPER: 'ci-pepper', CRON_SECRET: 'ci-cron', SERVICE_PROVIDER_MODE: 'seller', VERCEL_ENV: 'production',
});
test.beforeAll(async () => {
  baseEnv();
  __setHorizonForTests(() => ({ loadAccount: async (a: string) => ({ id: a, balances: [{ asset_code: 'USDC', asset_issuer: env.usdcIssuer() }] }) }) as any);
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
});
test.beforeEach(() => { db = fakeDb(); __setDbForTests(db as any); db.tables.orders.push(order({ slug: 'abc123', status: 'enviado', contract_id: 'C1' })); });

const WRITES: [string, any, any][] = [
  ['orders/create', create, { title: 'Bici', price_crc: 150000 }],
  ['escrow/ship', ship, { slug: 'abc123' }],
  ['escrow/confirm', confirm, { slug: 'abc123', reason: 'pin', pin: '123456' }],
  ['store (update)', store, { action: 'update', display_name: 'X' }],
  ['store (orders)', store, { action: 'orders' }],
  ['store (payout_set)', store, { action: 'payout_set', iban: 'CR05015202001026284066', holder_name: 'Ana' }],
  ['photos/upload-url', upload, { count: 1 }],
  ['wallet/activate', activate, {}],
];
for (const [name, h, body] of WRITES) {
  test(`API-AUTH ${name}: sin sesión -> 401 con mensaje`, async () => {
    const r = await call(h, { body });
    expect(r.code).toBe(401);
    expect(typeof r.body?.error).toBe('string');
  });
  test(`API-AUTH ${name}: token de otra firma -> 401`, async () => {
    const r = await call(h, { body, tok: await token({ sub: 'x', badKey: true }) });
    expect(r.code).toBe(401);
  });
}

test('API-METHOD GET a un endpoint de escritura -> 405', async () => {
  for (const h of [create, ship, confirm, dispute, pay]) expect((await call(h, { method: 'GET' })).code).toBe(405);
});

test('API-GUEST pagar sin sesión ni llave -> 401; llave mal formada -> 401', async () => {
  db.tables.orders[0].status = 'creado';
  expect((await call(pay, { body: { slug: 'abc123', step: 'start' } })).code).toBe(401);
  expect((await call(pay, { body: { slug: 'abc123', step: 'start' }, guest: 'corta' })).code).toBe(401);
});

test('API-GUEST disputa: solo el comprador dueño (otra llave -> 403)', async () => {
  db.tables.orders[0].buyer_user_id = 'guest:x';
  const r = await call(dispute, { body: { slug: 'abc123', reason: 'no_llego' }, guest: KEY_B });
  expect([403, 404]).toContain(r.code);
  expect(db.tables.orders[0].status).toBe('enviado');
});

test('API-OWN el vendedor no puede marcar enviado un pedido ajeno', async () => {
  Object.assign(db.tables.orders[0], { status: 'fondeado', seller_user_id: 'otro' });
  const r = await call(ship, { body: { slug: 'abc123' }, tok: await token({ sub: 'seller-1' }) });
  expect([403, 404]).toContain(r.code);
  expect(db.tables.orders[0].status).toBe('fondeado');
});

test('API-OWN /api/store orders: solo devuelve pedidos propios, sin identificador completo', async () => {
  db.tables.orders.length = 0;
  db.tables.orders.push(order({ slug: 'mio001', identifier: '356938035643809' }), order({ slug: 'ajeno1', seller_user_id: 'otro' }));
  const r = await call(store, { body: { action: 'orders' }, tok: await token({ sub: 'seller-1' }) });
  expect(r.code).toBe(200);
  expect(r.body.orders.map((o: any) => o.slug)).toEqual(['mio001']);
  expect(JSON.stringify(r.body)).not.toContain('356938035643809');
  expect(r.body.orders[0].identifier_masked).toBe('••••3809');
});

test('API-VAL crear link: precio inválido o sin título -> 400', async () => {
  const tok = await token({ sub: 'seller-1' });
  for (const over of [{ price_crc: 10 }, { price_crc: 'abc' }, { title: '' }, { price_crc: 1.5e9 }, { photos: [] }]) {
    const body = sellerBody('seller-1', over);
    const r = await call(create, { body, tok });
    expect(r.code, JSON.stringify(body)).toBe(400);
  }
});

test('API-PIN confirmar con PIN tras 3 intentos fallidos -> 429', async () => {
  Object.assign(db.tables.orders[0], { pin_attempts: 3, pin_hash: 'x' });
  const r = await call(confirm, { body: { slug: 'abc123', reason: 'pin', pin: '123456' }, tok: await token({ sub: 'seller-1' }) });
  expect(r.code).toBe(429);
});

test('API-CRON sin secreto -> 401 y no libera nada', async () => {
  db.tables.orders[0].auto_release_at = new Date(Date.now() - 60_000).toISOString();
  const r = await call(cron, { method: 'GET' });
  expect(r.code).toBe(401);
  expect(db.tables.orders[0].status).toBe('enviado');
});

test('API-CRON pedido con PIN bloqueado no se auto-libera', async () => {
  Object.assign(db.tables.orders[0], { pin_attempts: 3, auto_release_at: new Date(Date.now() - 60_000).toISOString() });
  await call(cron, { method: 'GET', headers: { authorization: 'Bearer ci-cron' } });
  expect(db.tables.orders[0].status).toBe('enviado');
});

test('API-INV invitación: el mismo comprador no puede responder su propia invitación', async () => {
  const r1 = await call(invites, { guest: KEY_A, body: { op: 'create', category: 'celular', brand: '', model: 'iPhone 13', title: 'iPhone 13', price_crc: 250000 } });
  expect(r1.code, r1.body?.error).toBe(200);
  const code = r1.body.code;
  const r2 = await call(create, { guest: KEY_A, tok: await token({ sub: 'seller-1' }), body: sellerBody('seller-1', { invite: code }) });
  expect(r2.code).toBe(400);
  expect(r2.body.error).toMatch(/propia invitación/);
});

test('API-INV invitación: otro vendedor la responde y el link queda reservado para el comprador', async () => {
  const r1 = await call(invites, { guest: KEY_A, body: { op: 'create', category: 'celular', brand: '', model: 'iPhone 13', title: 'iPhone 13', price_crc: 250000 } });
  const code = r1.body.code;
  const r2 = await call(create, { tok: await token({ sub: 'seller-1' }), body: sellerBody('seller-1', { invite: code }) });
  expect(r2.code, r2.body?.error).toBe(200);
  const slug = r2.body.slug;
  // Otro comprador (llave B) no puede pagar el link reservado
  const r3 = await call(pay, { guest: KEY_B, body: { slug, step: 'start' } });
  expect(r3.code).toBe(403);
  expect(r3.body.code).toBe('invite_reserved');
});

test('API-LST producto permanente en pausa: el comprador recibe 409 listing_paused y no se crea pedido', async () => {
  db.tables.orders.length = 0;
  db.tables.orders.push(order({ slug: 'prod01', kind: 'listing', listing_status: 'pausada', stock: null }));
  const r = await call(pay, { guest: KEY_A, body: { slug: 'prod01', step: 'start' } });
  expect(r.code).toBe(409);
  expect(r.body.code).toBe('listing_paused');
  expect(db.tables.orders.length).toBe(1);
});

test('API-LST producto agotado (stock 0): 409 listing_sold_out', async () => {
  db.tables.orders.length = 0;
  db.tables.orders.push(order({ slug: 'prod01', kind: 'listing', listing_status: 'activa', stock: 0 }));
  const r = await call(pay, { guest: KEY_A, body: { slug: 'prod01', step: 'start' } });
  expect(r.code).toBe(409);
  expect(r.body.code).toBe('listing_sold_out');
});

test('API-LST el vendedor no puede comprar su propio producto con su llave de invitado + sesión', async () => {
  db.tables.orders.length = 0;
  db.tables.orders.push(order({ slug: 'prod01', kind: 'listing', listing_status: 'activa' }));
  const r = await call(pay, { guest: KEY_A, tok: await token({ sub: 'seller-1' }), body: { slug: 'prod01', step: 'start' } });
  expect(r.code).toBe(409);
  expect(r.body.code).toBe('self_purchase');
  expect(db.tables.orders.length).toBe(1); // no dejó pedido hijo huérfano
});
