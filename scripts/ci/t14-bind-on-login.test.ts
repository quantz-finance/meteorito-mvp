// (14) Bind al iniciar sesión: wallet/activate step 'bind' solo con token fresco; idempotente; sin on-chain.
import { Keypair } from '@stellar/stellar-sdk';
import type { T } from './setup';
import { installTestJwks, req, res, token } from './jwt';
import { bindMessage, proofMessage } from '../../api/_lib/auth';
import { __setDbForTests } from '../../api/_lib/db';
import { __setHorizonForTests } from '../../api/_lib/wallet';
import { bindWalletOnLogin, __resetBindForTests } from '../../lib/wallet';
import { fakeDb } from './fakedb';
import activate from '../../api/wallet/activate';

const _pf = (kp: Keypair, ref = 'bind') => { const m = proofMessage('wallet', ref, kp.publicKey(), Math.floor(Date.now() / 1000));
  const pre = Buffer.concat([Buffer.from('Cavos Signed Message:\n'), Buffer.from(String(Buffer.byteLength(m))), Buffer.from('\n'), Buffer.from(m)]);
  return { address: kp.publicKey(), publicKey: kp.publicKey(), message: m, signature: kp.sign(pre).toString('base64') }; };

export async function run(t: T) {
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  let horizon = 0; __setHorizonForTests(() => { horizon++; throw new Error('bind no debe tocar Horizon'); });
  const db = fakeDb(); db.tables.user_wallets = []; __setDbForTests(db as any);
  const a = Keypair.random(), b = Keypair.random(); const now = Math.floor(Date.now() / 1000);
  const nonce = async (tok: string) => { const r = res(); await activate(req(tok, { step: 'nonce' }), r); return r.body.nonce as string; };
  const sg = (kp: Keypair, m: string) => kp.sign(Buffer.concat([Buffer.from('Cavos Signed Message:\n'), Buffer.from(String(Buffer.byteLength(m))), Buffer.from('\n'), Buffer.from(m)])).toString('base64');
  const bindP = (kp: Keypair, sub: string, n: string) => ({ address: kp.publicKey(), publicKey: kp.publicKey(), signature: sg(kp, bindMessage(sub, n)), nonce: n });
  const bindRaw = async (tok: string, p: any) => { const r = res(); await activate(req(tok, { step: 'bind', proof: p }), r); return r; };
  const bind = async (tok: string, kp: Keypair, sub = 'u1') => bindRaw(tok, bindP(kp, sub, await nonce(await token({ sub }))));

  let r = await bind(await token({ sub: 'u1', exp: now - 600 }), a);
  t.check('token vencido -> 401, sin fila', r.code === 401 && r.body.code === 'session_expired' && db.tables.user_wallets.length === 0, JSON.stringify(r.body));
  r = await bind(await token({ sub: 'u1' }), a);
  t.check('token fresco -> 200 y crea fila sub -> wallet', r.code === 200 && db.tables.user_wallets.length === 1 && db.tables.user_wallets[0].sub === 'u1' && db.tables.user_wallets[0].wallet_address === a.publicKey(), JSON.stringify(r.body));
  r = await bind(await token({ sub: 'u1' }), a);
  t.check('idempotente: mismo bind -> 200, 1 fila', r.code === 200 && db.tables.user_wallets.length === 1);
  r = await bind(await token({ sub: 'u1' }), b);
  t.check('otra wallet -> no sobrescribe', r.code === 200 && db.tables.user_wallets.length === 1 && db.tables.user_wallets[0].wallet_address === a.publicKey());
  const n1 = await nonce(await token({ sub: 'u3' }));
  r = await bindRaw(await token({ sub: 'u3' }), bindP(a, 'u3', n1));
  t.check('nonce fresco emitido con token FRESCO -> bind ok', r.code === 200 && db.tables.user_wallets.some((w: any) => w.sub === 'u3'));
  db.tables.user_wallets = db.tables.user_wallets.filter((w: any) => w.sub !== 'u3');
  r = await bindRaw(await token({ sub: 'u3' }), bindP(a, 'u3', n1));
  t.check('nonce reutilizado -> 401, sin fila', r.code === 401 && !db.tables.user_wallets.some((w: any) => w.sub === 'u3'), JSON.stringify(r.body));
  const nOther = await nonce(await token({ sub: 'otro' }));
  r = await bindRaw(await token({ sub: 'u2' }), bindP(b, 'u2', nOther));
  t.check('nonce de otro usuario -> 401, sin fila', r.code === 401 && !db.tables.user_wallets.some((w: any) => w.sub === 'u2'));
  r = await bindRaw(await token({ sub: 'u2' }), { address: b.publicKey(), publicKey: b.publicKey(), signature: sg(b, proofMessage('wallet', 'bind', b.publicKey(), now)), nonce: await nonce(await token({ sub: 'u2' })) });
  t.check('firma sobre otro mensaje (sin nonce) -> 401', r.code === 401 && !db.tables.user_wallets.some((w: any) => w.sub === 'u2'));
  t.check('bind no toca Horizon ni on-chain (re-link es un paso explícito aparte)', horizon === 0);

  // Cliente: una vez por apertura, solo con token fresco; vencido se omite sin llamar a la API.
  const realFetch = globalThis.fetch; const calls: string[] = [];
  globalThis.fetch = (async (_u: any, i: any) => { const st = JSON.parse(i.body).step; calls.push(st); return { ok: true, status: 200, json: async () => (st === 'nonce' ? { nonce: 'd'.repeat(48) } : { bound: true }) }; }) as any;
  const mk = (tok: string): any => ({ isAuthenticated: true, address: a.publicKey(), getAuthToken: () => tok, wallet: { state: 'ready' },
    signMessage: async (m: string) => { const pre = Buffer.concat([Buffer.from('Cavos Signed Message:\n'), Buffer.from(String(Buffer.byteLength(m))), Buffer.from('\n'), Buffer.from(m)]); return { publicKey: a.publicKey(), signature: a.sign(pre).toString('base64') }; } });
  try {
    __resetBindForTests();
    t.check('cliente: token vencido -> omite en silencio', (await bindWalletOnLogin(mk(await token({ sub: 'u1', exp: now - 60 })))) === false && calls.length === 0);
    const fresh = mk(await token({ sub: 'u1' }));
    t.check('cliente: token fresco -> llama bind', (await bindWalletOnLogin(fresh)) === true && calls.join() === 'nonce,bind', calls.join());
    t.check('cliente: una vez por apertura', (await bindWalletOnLogin(fresh)) === false && calls.length === 2);
  } finally { globalThis.fetch = realFetch; }
}
