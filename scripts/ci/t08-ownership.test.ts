// (8) Ownership por `sub`: un token válido de otro usuario (p.ej. de otra app Cavos con aud compartido) solo actúa como sí mismo.
// Handlers HTTP reales + DB falsa; ningún caso debe escribir ni llegar a la red.
import { Keypair } from '@stellar/stellar-sdk';
import type { T } from './setup';
import { installTestJwks, req, res, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { proofMessage } from '../../api/_lib/auth';
import { publicPrefix } from '../../api/_lib/photos';
import { fakeDb } from './fakedb';
import { __setHorizonForTests } from '../../api/_lib/wallet';
import { env } from '../../api/_lib/env';
import create from '../../api/orders/create';
import pay from '../../api/escrow/pay';
import ship from '../../api/escrow/ship';
import confirm from '../../api/escrow/confirm';
import dispute from '../../api/escrow/dispute';
import submit from '../../api/tx/submit';
import upload from '../../api/photos/upload-url';

const proof = (action: string, ref: string) => {
  const kp = Keypair.random(); const ts = Math.floor(Date.now() / 1000);
  const message = proofMessage(action, ref, kp.publicKey(), ts);
  const pre = Buffer.concat([Buffer.from('Cavos Signed Message:\n'), Buffer.from(String(Buffer.byteLength(message))), Buffer.from('\n'), Buffer.from(message)]);
  return { address: kp.publicKey(), publicKey: kp.publicKey(), message, signature: kp.sign(pre).toString('base64') };
};

export async function run(t: T) {
  // Wallets del vendedor ya activadas (cuenta + trustline USDC): este test es de ownership, no de activación (ver t09).
  __setHorizonForTests(() => ({ loadAccount: async (a: string) => ({ id: a, balances: [{ asset_code: 'USDC', asset_issuer: env.usdcIssuer() }] }) }));
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  const order = { id: '33333333-3333-4333-8333-333333333333', slug: 'own001', contract_id: 'CNOTUSED', seller_user_id: 'seller', buyer_user_id: 'buyer',
    seller_address: 'GSELLER', buyer_address: 'GBUYER', amount_usdc: 1, price_crc: 5000, sp_mode: 'seller', pin_attempts: 0, delivery_pin_hash: 'x' };
  const go = async (h: any, sub: string, body: any, st: string) => {
    const db = fakeDb(); __setDbForTests(db as any); db.tables.orders.push({ ...order, status: st });
    const before = JSON.stringify(db.tables);
    const r = res(); await h(req(await token({ sub }), body), r);
    return { code: r.code, err: r.body?.error, wrote: JSON.stringify(db.tables) !== before, db };
  };
  const cases: [string, any, string, any, string, number][] = [
    ['ship: tercero -> 403', ship, 'intruso', { slug: 'own001', evidence: { a: 1 } }, 'fondeado', 403],
    ['ship: comprador -> 403', ship, 'buyer', { slug: 'own001', evidence: { a: 1 } }, 'fondeado', 403],
    ['tx/submit ship: tercero -> 403', submit, 'intruso', { slug: 'own001', action: 'ship', signedXdr: 'AAAA' }, 'fondeado', 403],
    ['confirm buyer_confirm: tercero -> 403', confirm, 'intruso', { slug: 'own001', reason: 'buyer_confirm' }, 'enviado', 403],
    ['confirm buyer_confirm: vendedor -> 403', confirm, 'seller', { slug: 'own001', reason: 'buyer_confirm' }, 'enviado', 403],
    ['confirm pin: tercero -> 403 (no consume intentos)', confirm, 'intruso', { slug: 'own001', reason: 'pin', pin: '000000' }, 'enviado', 403],
    ['confirm pin: comprador -> 403', confirm, 'buyer', { slug: 'own001', reason: 'pin', pin: '000000' }, 'enviado', 403],
    ['dispute: tercero -> 403', dispute, 'intruso', { slug: 'own001', reason: 'no_llego' }, 'enviado', 403],
    ['pay confirm_sinpe: tercero -> 403', pay, 'intruso', { slug: 'own001', step: 'confirm_sinpe' }, 'escrow_creado', 403],
    ['pay start (pedido ya tomado): tercero -> 403', pay, 'intruso', { slug: 'own001', step: 'start', proof: proof('pay', 'own001') }, 'escrow_creado', 403],
  ];
  for (const [name, h, sub, body, st, want] of cases) {
    const r = await go(h, sub, body, st);
    t.check(name, r.code === want && !r.wrote, `${r.code} ${r.err} wrote=${r.wrote}`);
  }
  // Fotos: carpeta = sub del token, ignorando cualquier campo del body.
  const db = fakeDb(); __setDbForTests(db as any);
  const r = res(); await upload(req(await token({ sub: 'intruso' }), { draftId: '44444444-4444-4444-8444-444444444444', index: 0, mime: 'image/jpeg', size: 1000, sub: 'seller', path: 'seller/x.jpg' }), r);
  t.check('upload-url: path siempre bajo listings/<sub del token>/', r.code === 200 && db.uploads.length === 1 && db.uploads[0].startsWith('intruso/') && r.body.publicUrl.startsWith(publicPrefix('intruso')), `${r.code} ${db.uploads[0]}`);
  // create: fotos de la carpeta de OTRO usuario -> 400; dispute: evidencia de otra carpeta -> 400.
  const photo = publicPrefix('seller') + 'listing-44444444-4444-4444-8444-444444444444/0.jpg';
  const c = await go(create, 'intruso', { proof: proof('create', 'new'), category: 'celular', brand: 'a', model: 'b', condition: 'c', price_crc: 5000, photos: [photo] }, 'creado');
  t.check('create: fotos de carpeta ajena -> 400, sin insert', c.code === 400 && c.db.tables.orders.length === 1, `${c.code} ${c.err}`);
  const c2 = await go(create, 'seller', { proof: proof('create', 'new'), category: 'celular', brand: 'a', model: 'b', condition: 'c', price_crc: 5000, photos: [photo] }, 'creado');
  t.check('create: fotos propias -> 200, seller_user_id = sub del token', c2.code === 200 && c2.db.tables.orders[1]?.seller_user_id === 'seller', `${c2.code} ${c2.err}`);
  const d = await go(dispute, 'buyer', { slug: 'own001', reason: 'no_llego', evidence: [photo] }, 'enviado');
  t.check('dispute: evidencia de carpeta ajena -> 400', d.code === 400 && !d.wrote, `${d.code} ${d.err}`);
}
