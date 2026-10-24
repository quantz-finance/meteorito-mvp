// (27) Invitación de compra: el comprador (invitado) inicia, el vendedor confirma publicando; el link queda reservado. Sin red.
import { Keypair } from '@stellar/stellar-sdk';
import type { T } from './setup';
import { installTestJwks, req, res, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { proofMessage } from '../../api/_lib/auth';
import { publicPrefix } from '../../api/_lib/photos';
import { __setHorizonForTests } from '../../api/_lib/wallet';
import { env } from '../../api/_lib/env';
import { fakeDb } from './fakedb';
import invites from '../../api/invites/index';
import create from '../../api/orders/create';
import pay from '../../api/escrow/pay';

const KEY_A = 'a'.repeat(64), KEY_B = 'b'.repeat(64);
const signProof = (kp: Keypair, action: string, ref: string) => {
  const ts = Math.floor(Date.now() / 1000); const message = proofMessage(action, ref, kp.publicKey(), ts);
  const pre = Buffer.concat([Buffer.from('Cavos Signed Message:\n'), Buffer.from(String(Buffer.byteLength(message))), Buffer.from('\n'), Buffer.from(message)]);
  return { address: kp.publicKey(), publicKey: kp.publicKey(), message, signature: kp.sign(pre).toString('base64') };
};
const call = async (h: any, o: { method?: string; body?: any; query?: any; guest?: string | null; tok?: string | null }) => {
  const r = res(); const rq: any = { method: o.method ?? 'POST', headers: { ...(o.guest ? { 'x-guest-key': o.guest } : {}), ...(o.tok ? { authorization: `Bearer ${o.tok}` } : {}) }, body: o.body ?? {}, query: o.query ?? {} };
  await h(rq, r); return r;
};

export async function run(t: T) {
  __setHorizonForTests(() => ({ loadAccount: async (a: string) => ({ id: a, balances: [{ asset_code: 'USDC', asset_issuer: env.usdcIssuer() }] }) }));
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  const db = fakeDb(); __setDbForTests(db as any);
  const base = { category: 'celular', brand: 'Apple', model: 'iPhone 13', price_crc: 250000, note: 'Lo necesito esta semana' };

  let r = await call(invites, { body: { op: 'create', ...base } });
  t.check('crear invitación sin llave de invitado -> 401', r.code === 401, `${r.code}`);
  r = await call(invites, { guest: KEY_A, body: { op: 'create', ...base, price_crc: 10 } });
  t.check('precio fuera de rango -> 400', r.code === 400, `${r.code}`);
  r = await call(invites, { guest: KEY_A, body: { op: 'create', ...base, category: 'auto' } });
  t.check('categoría inválida -> 400', r.code === 400, `${r.code}`);
  r = await call(invites, { guest: KEY_A, body: { op: 'create', ...base } });
  const code = r.body?.code as string;
  t.check('comprador invitado crea invitación (código de 8 caracteres)', r.code === 200 && /^[a-z0-9]{8}$/.test(code), `${r.code} ${r.body?.error}`);
  t.check('se guarda con status abierta y buyer = guest:<hash>', db.tables.invitations[0]?.status === 'abierta' && /^guest:/.test(db.tables.invitations[0]?.buyer_user_id));

  r = await call(invites, { method: 'GET', query: { code } });
  t.check('lectura pública sin login; no expone buyer_user_id', r.code === 200 && r.body.brand === 'Apple' && r.body.mine === false && !JSON.stringify(r.body).includes('guest:'), JSON.stringify(r.body));
  r = await call(invites, { method: 'GET', query: { code }, guest: KEY_A });
  t.check('mine:true solo para la llave del comprador', r.body?.mine === true);
  r = await call(invites, { method: 'GET', query: { code: 'zz' } });
  t.check('código inválido -> 400', r.code === 400);

  // El vendedor publica en respuesta a la invitación.
  const seller = Keypair.random(); const photo = publicPrefix('seller1') + 'listing-44444444-4444-4444-8444-444444444444/0.jpg';
  const sellerBody = (price: number, invite?: string) => ({ proof: signProof(seller, 'create', 'new'), category: 'celular', brand: 'Apple', model: 'iPhone 13', condition: 'Bueno', price_crc: price, photos: [photo], ...(invite ? { invite } : {}) });
  r = await call(create, { tok: await token({ sub: 'seller1' }), body: sellerBody(100000, code) });
  t.check('precio distinto al de la invitación -> 409 y no publica', r.code === 409 && r.body?.code === 'invite_price_mismatch' && db.tables.orders.length === 0, `${r.code} ${r.body?.error}`);
  r = await call(create, { tok: await token({ sub: 'seller1' }), body: sellerBody(250000, 'nonexist') });
  t.check('invitación inexistente -> 404 y no publica', r.code === 404 && db.tables.orders.length === 0, `${r.code}`);
  r = await call(create, { tok: await token({ sub: 'seller1' }), body: sellerBody(250000, code) });
  const slug = r.body?.slug as string;
  t.check('vendedor publica desde la invitación', r.code === 200 && /^[a-z0-9]{6}$/.test(slug), `${r.code} ${r.body?.error}`);
  const inv = db.tables.invitations[0];
  t.check('la invitación queda aceptada y ligada al link', inv.status === 'aceptada' && inv.order_slug === slug && inv.seller_user_id === 'seller1');
  r = await call(invites, { method: 'GET', query: { code } });
  t.check('el comprador ve order_slug para ir a pagar', r.body?.status === 'aceptada' && r.body?.order_slug === slug);

  // Una invitación = una publicación.
  r = await call(create, { tok: await token({ sub: 'seller2' }), body: { ...sellerBody(250000, code), photos: [publicPrefix('seller2') + 'listing-44444444-4444-4444-8444-444444444444/0.jpg'] } });
  t.check('segunda publicación sobre la misma invitación -> 409', r.code === 409 && r.body?.code === 'invite_not_open' && db.tables.orders.length === 1, `${r.code} ${r.body?.error}`);

  // El link queda reservado a quien invitó.
  r = await call(pay, { guest: KEY_B, body: { slug, step: 'start' } });
  t.check('otro invitado no puede pagar el link reservado -> 403 invite_reserved', r.code === 403 && r.body?.code === 'invite_reserved', `${r.code} ${r.body?.error}`);
  t.check('…y no se escribió nada en el pedido', !db.tables.orders[0].contract_id);

  // Cancelar.
  r = await call(invites, { guest: KEY_A, body: { op: 'create', ...base } });
  const c2 = r.body.code;
  r = await call(invites, { guest: KEY_B, body: { op: 'cancel', code: c2 } });
  t.check('otro no puede cancelar -> 403', r.code === 403, `${r.code}`);
  r = await call(invites, { guest: KEY_A, body: { op: 'cancel', code: c2 } });
  t.check('el comprador cancela su invitación abierta', r.code === 200 && db.tables.invitations.find((i: any) => i.code === c2).status === 'cancelada');
  r = await call(create, { tok: await token({ sub: 'seller3' }), body: { ...sellerBody(250000, c2), photos: [publicPrefix('seller3') + 'listing-44444444-4444-4444-8444-444444444444/0.jpg'] } });
  t.check('no se puede publicar sobre una invitación cancelada -> 409', r.code === 409 && db.tables.orders.length === 1, `${r.code}`);
}
