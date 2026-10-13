// (13) Token Cavos vencido (el kit no lo renueva): renovación SOLO con la wallet ligada al sub (user_wallets),
// nonce de un uso (5 min) y firma atada a método+ruta; ventana SESSION_GRACE_DAYS (default 7).
// Comprador nuevo sin cuenta -> pay start 409 claro.
import { Keypair } from '@stellar/stellar-sdk';
import type { T } from './setup';
import { installTestJwks, req, res, token } from './jwt';
import { proofMessage, requireCavosUser, sessionMessage, SESSION_EXPIRED, bindWalletIfFresh } from '../../api/_lib/auth';
import { __setDbForTests } from '../../api/_lib/db';
import { __setHorizonForTests } from '../../api/_lib/wallet';
import { fakeDb } from './fakedb';
import { api, tokenExpiresSoon } from '../../lib/api';
import pay from '../../api/escrow/pay';
import activate from '../../api/wallet/activate';

const pre = (m: string) => Buffer.concat([Buffer.from('Cavos Signed Message:\n'), Buffer.from(String(Buffer.byteLength(m))), Buffer.from('\n'), Buffer.from(m)]);
const sign = (kp: Keypair, m: string) => kp.sign(pre(m)).toString('base64');
const addrProof = (kp: Keypair, action: string, ref: string) => { const m = proofMessage(action, ref, kp.publicKey(), Math.floor(Date.now() / 1000)); return { address: kp.publicKey(), publicKey: kp.publicKey(), message: m, signature: sign(kp, m) }; };

export async function run(t: T) {
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = ''; delete process.env.SESSION_GRACE_DAYS;
  const now = Math.floor(Date.now() / 1000);
  const kp = Keypair.random(), other = Keypair.random();
  const db = fakeDb(); __setDbForTests(db as any);
  const expired = await token({ sub: 'buyer2', exp: now - 3600 });
  const nonceFor = async (tok: string) => { const r = res(); await activate(req(tok, { step: 'nonce' }), r); return r.body.nonce as string; };
  const sessHdr = (k: Keypair, sub: string, nonce: string, method = 'POST', path = '/api/escrow/pay', address = k.publicKey()) =>
    Buffer.from(JSON.stringify({ address, publicKey: k.publicKey(), signature: sign(k, sessionMessage(sub, nonce, method, path)), nonce })).toString('base64');
  const call = async (tok: string, hdr?: string, method = 'POST', url = '/api/escrow/pay') => {
    try { const u = await requireCavosUser({ method, url, headers: { authorization: `Bearer ${tok}`, ...(hdr ? { 'x-meteorito-proof': hdr } : {}) } }); return { ok: true, u } as any; }
    catch (e: any) { return { ok: false, status: e.status, code: e.code, msg: e.message }; }
  };

  let r = await call(expired);
  t.check('vencido sin prueba -> 401 session_expired (español, sin ERR_JWT)', !r.ok && r.status === 401 && r.code === 'session_expired' && r.msg === SESSION_EXPIRED);
  let n = await nonceFor(expired);
  t.check('nonce emitido con token vencido (dentro de ventana)', /^[a-f0-9]{48}$/.test(n ?? ''), String(n));
  r = await call(expired, sessHdr(kp, 'buyer2', n));
  t.check('sin wallet ligada -> 401 session_wallet_mismatch (no reintentable)', !r.ok && r.code === 'session_wallet_mismatch');

  // Binding con token fresco (pay start real): liga buyer2 -> kp.
  __setHorizonForTests(() => ({ loadAccount: async () => { throw Object.assign(new Error('nf'), { response: { status: 404 } }); } }));
  db.tables.orders.push({ id: '77777777-7777-4777-8777-777777777777', slug: 'zp6ebt', status: 'creado', seller_user_id: 's2', seller_address: Keypair.random().publicKey(), price_crc: 5000 });
  let rr = res(); await pay(req(await token({ sub: 'buyer2' }), { slug: 'zp6ebt', step: 'start', proof: addrProof(kp, 'pay', 'zp6ebt') }), rr);
  t.check('token fresco + prueba -> liga sub -> wallet (aunque el pago se frene)', db.tables.user_wallets.length === 1 && db.tables.user_wallets[0].wallet_address === kp.publicKey(), JSON.stringify(db.tables.user_wallets));
  __setHorizonForTests(() => ({ loadAccount: async () => ({ balances: [] }) })); // wallet ligada existe on-chain
  await bindWalletIfFresh({ sub: 'buyer2', iss: 'x', renewed: false }, other.publicKey());
  t.check('binding no se sobrescribe', db.tables.user_wallets[0].wallet_address === kp.publicKey());
  t.check('token renovado nunca liga', (await bindWalletIfFresh({ sub: 'zz', iss: 'x', renewed: true }, other.publicKey()), !db.tables.user_wallets.some((w: any) => w.sub === 'zz')));

  n = await nonceFor(expired);
  r = await call(expired, sessHdr(kp, 'buyer2', n));
  t.check('wallet ligada + nonce + método/ruta -> renovado', r.ok && r.u.sub === 'buyer2' && r.u.renewed === true, JSON.stringify(r));
  r = await call(expired, sessHdr(kp, 'buyer2', n));
  t.check('reutilizar nonce -> 401', !r.ok && r.code === 'session_expired');
  n = await nonceFor(expired);
  r = await call(expired, sessHdr(other, 'buyer2', n, 'POST', '/api/escrow/pay', other.publicKey()));
  t.check('wallet distinta a la ligada -> 401 session_wallet_mismatch', !r.ok && r.code === 'session_wallet_mismatch');
  r = await call(expired, sessHdr(other, 'buyer2', n, 'POST', '/api/escrow/pay', kp.publicKey()));
  t.check('firma de otra llave con address ligada -> 401', !r.ok && r.code === 'session_expired');
  r = await call(expired, sessHdr(kp, 'buyer2', n, 'GET'));
  t.check('método distinto al firmado -> 401', !r.ok && r.code === 'session_expired');
  r = await call(expired, sessHdr(kp, 'buyer2', n, 'POST', '/api/escrow/confirm'));
  t.check('ruta distinta a la firmada -> 401', !r.ok && r.code === 'session_expired');
  r = await call(expired, sessHdr(kp, 'buyer2', n));
  t.check('el nonce no se consumió con los intentos fallidos -> válido', r.ok);
  const n2 = await nonceFor(expired); db.tables.session_nonces.find((x: any) => x.nonce === n2).expires_at = new Date(Date.now() - 1000).toISOString();
  r = await call(expired, sessHdr(kp, 'buyer2', n2));
  t.check('nonce vencido (>5 min) -> 401', !r.ok);
  const n3 = await nonceFor(await token({ sub: 'otro', exp: now - 60 }));
  r = await call(expired, sessHdr(kp, 'buyer2', n3));
  t.check('nonce emitido para otro sub -> 401', !r.ok);
  const old8 = await token({ sub: 'buyer2', exp: now - 8 * 86400 });
  r = await call(old8, sessHdr(kp, 'buyer2', 'a'.repeat(48)));
  t.check('vencido hace > 7 días (default) -> 401', !r.ok && r.code === 'session_expired');
  const nn = res(); await activate(req(old8, { step: 'nonce' }), nn);
  t.check('> 7 días: ni siquiera emite nonce', nn.code === 401);
  process.env.SESSION_GRACE_DAYS = '10';
  r = await call(old8, sessHdr(kp, 'buyer2', await nonceFor(old8)));
  t.check('SESSION_GRACE_DAYS=10 -> 8 días aceptado', r.ok, JSON.stringify(r));
  delete process.env.SESSION_GRACE_DAYS;
  r = await call(await token({ sub: 'buyer2', exp: now - 3600, badKey: true }), sessHdr(kp, 'buyer2', 'b'.repeat(48)));
  t.check('vencido con firma inválida -> 401 auth_invalid', !r.ok && r.code === 'auth_invalid');

  // Cliente: vencido -> pide nonce y firma POST+ruta en el 1er intento; token "válido" rechazado -> 1 reintento.
  const auth: any = { address: kp.publicKey(), getAuthToken: () => expired, signMessage: async (m: string) => ({ publicKey: kp.publicKey(), signature: sign(kp, m) }) };
  const realFetch = globalThis.fetch; const seen: string[] = [];
  globalThis.fetch = (async (u: any, i: any) => {
    const body = JSON.parse(i.body);
    if (u === '/api/wallet/activate' && body.step === 'nonce') { seen.push('nonce'); return { ok: true, status: 200, json: async () => ({ nonce: 'c'.repeat(48) }) }; }
    const h = i.headers['X-Meteorito-Proof']; seen.push(h ? 'proof' : 'plain');
    if (h) { const p = JSON.parse(Buffer.from(h, 'base64').toString()); const ok = Keypair.fromPublicKey(p.publicKey).verify(pre(sessionMessage('buyer2', p.nonce, 'POST', '/api/escrow/pay')), Buffer.from(p.signature, 'base64')); return { ok, status: ok ? 200 : 401, json: async () => ({}) }; }
    return { ok: false, status: 401, json: async () => ({ error: SESSION_EXPIRED, code: 'session_expired' }) };
  }) as any;
  try {
    t.check('cliente detecta token vencido', tokenExpiresSoon(expired) && !tokenExpiresSoon(await token({ sub: 'x' })));
    await api(auth, '/api/escrow/pay', {}); t.check('cliente: vencido -> nonce + prueba (POST /api/escrow/pay) al 1er intento', seen.join() === 'nonce,proof', seen.join());
    seen.length = 0; auth.getAuthToken = () => 'eyJhbGciOiJub25lIn0.' + Buffer.from(JSON.stringify({ sub: 'buyer2', exp: now + 3600 })).toString('base64url') + '.x';
    await api(auth, '/api/escrow/pay', {}); t.check('cliente: 401 session_expired -> 1 reintento con nonce', seen.join() === 'plain,nonce,proof', seen.join());
  } finally { globalThis.fetch = realFetch; }

  t.check('comprador sin cuenta -> 409 buyer_wallet_not_ready, sin escrow', rr.code === 409 && rr.body.code === 'buyer_wallet_not_ready' && !db.tables.orders[0].contract_id, JSON.stringify(rr.body));
}
