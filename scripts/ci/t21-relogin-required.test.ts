// (21) Snowden 2026-10-12 (seller2 "Tu sesión venció"): token vencido + cuenta SIN fila en user_wallets.
// Servidor: 401 session_relogin_required (solo ERR_JWT_EXPIRED y sin fila). Cliente: nunca reintenta, nunca logout(),
// abre el login de Cavos; con el token fresco hace bind (nonce firmado) ANTES de cualquier otra acción.
// Primer login: bind inmediato con el token fresco -> todo usuario nuevo queda con fila desde el inicio.
import { Keypair } from '@stellar/stellar-sdk';
import type { T } from './setup';
import { installTestJwks, res, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { fakeDb } from './fakedb';
import { api, setReloginHandler, __resetBindForTests } from '../../lib/api';
import { bindWalletOnLogin, walletErrorNotice } from '../../lib/wallet';
import activate from '../../api/wallet/activate';
import { requireCavosUser } from '../../api/_lib/auth';

const pre = (m: string) => Buffer.concat([Buffer.from('Cavos Signed Message:\n'), Buffer.from(String(Buffer.byteLength(m))), Buffer.from('\n'), Buffer.from(m)]);
const sign = (kp: Keypair, m: string) => kp.sign(pre(m)).toString('base64');

export async function run(t: T) {
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = ''; delete process.env.SESSION_GRACE_DAYS;
  const now = Math.floor(Date.now() / 1000);
  const db = fakeDb(); db.tables.user_wallets = []; db.tables.session_nonces = []; __setDbForTests(db as any);
  const seller2 = Keypair.random(), nuevo = Keypair.random();
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  // /api/wallet/activate -> handler real; /api/orders/create -> servidor real de auth (requireCavosUser) + 200.
  globalThis.fetch = (async (u: any, i: any = {}) => {
    const url = String(u); const body = JSON.parse(i.body ?? '{}');
    const h: Record<string, string> = {}; for (const [k, v] of Object.entries(i.headers ?? {})) h[k.toLowerCase()] = String(v);
    calls.push(`${url.split('/').pop()}:${body.step ?? ''}:${h['x-meteorito-proof'] ? 'proof' : 'plain'}`);
    if (url === '/api/wallet/activate') { const r = res(); await activate({ method: 'POST', url, headers: h, body, query: {} }, r); return { ok: r.code < 400, status: r.code, json: async () => r.body }; }
    try { await requireCavosUser({ method: 'POST', url, headers: h }); return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
    catch (e: any) { return { ok: false, status: e.status ?? 500, json: async () => ({ error: e.message, code: e.code }) }; }
  }) as any;
  let logouts = 0, logins = 0;
  const mk = (kp: Keypair, tok: string): any => ({ isAuthenticated: true, address: kp.publicKey(), wallet: { state: 'ready' }, getAuthToken: () => tok,
    logout: () => { logouts++; }, openLogin: () => { logins++; }, signMessage: async (m: string) => ({ publicKey: kp.publicKey(), signature: sign(kp, m) }) });
  setReloginHandler((a) => a.openLogin());
  const errOf = async (f: () => Promise<unknown>) => { try { await f(); return null; } catch (e: any) { return e; } };
  try {
    __resetBindForTests();
    // 1) seller2: token vencido, sin fila -> "Crear link de venta"
    const expired = await token({ sub: 'seller2', exp: now - 7200 });
    let e = await errOf(() => api(mk(seller2, expired), '/api/orders/create', { title: 'x' }));
    t.check('vencido sin fila -> error session_relogin_required', e?.status === 401 && e?.code === 'session_relogin_required', `${e?.status} ${e?.code}`);
    t.check('sin reintentos: 1 sola llamada (nonce), sin acción', calls.join() === 'activate:nonce:plain', calls.join());
    t.check('abre login de Cavos (openLogin) y NUNCA logout()', logins === 1 && logouts === 0);
    t.check('aviso al usuario: volver a iniciar sesión, billetera se mantiene (sin voseo)', /iniciar sesión/.test(walletErrorNotice(e)) && /billetera se mantiene/.test(walletErrorNotice(e)) && !/Iniciá|podés|tenés/.test(walletErrorNotice(e)));
    // 1b) servidor responde relogin en la acción misma (token "no vencido" para el cliente): tampoco reintenta
    calls.length = 0; logins = 0;
    const fakeFresh = 'eyJhbGciOiJub25lIn0.' + Buffer.from(JSON.stringify({ sub: 'seller2', exp: now + 3600, iat: 1 })).toString('base64url') + '.x';
    const realFetch2 = globalThis.fetch; let n401 = 0;
    globalThis.fetch = (async () => { n401++; return { ok: false, status: 401, json: async () => ({ code: 'session_relogin_required', error: 'x' }) }; }) as any;
    e = await errOf(() => api({ ...mk(seller2, fakeFresh), wallet: { state: 'loading' } }, '/api/orders/create', {}));
    globalThis.fetch = realFetch2;
    t.check('401 session_relogin_required en la acción -> sin reintento, sin logout', e?.code === 'session_relogin_required' && n401 === 1 && logouts === 0 && logins === 1, String(n401));
    t.check('servidor: sin fila, sin bind -> sigue sin fila', !db.tables.user_wallets.some((w: any) => w.sub === 'seller2'));

    // 2) Re-login de Cavos (sin logout): token fresco -> bind (nonce firmado) ANTES de la acción
    calls.length = 0;
    const fresh = await token({ sub: 'seller2' });
    e = await errOf(() => api(mk(seller2, fresh), '/api/orders/create', { title: 'x' }));
    t.check('re-login: acción OK', e === null, String(e?.code));
    t.check('re-login: orden nonce, bind, luego la acción', calls.join() === 'activate:nonce:plain,activate:bind:plain,create::plain', calls.join());
    t.check('re-login: fila user_wallets seller2 -> su wallet', db.tables.user_wallets.find((w: any) => w.sub === 'seller2')?.wallet_address === seller2.publicKey());
    calls.length = 0; await api(mk(seller2, fresh), '/api/orders/create', {});
    t.check('mismo token: no repite bind', calls.join() === 'create::plain', calls.join());
    // 3) Luego el token vence otra vez: ya hay fila -> renovación normal con prueba (no relogin)
    calls.length = 0; logins = 0;
    const exp2 = await token({ sub: 'seller2', exp: now - 600 });
    e = await errOf(() => api(mk(seller2, exp2), '/api/orders/create', {}));
    t.check('con fila: token vencido se renueva con prueba, sin relogin', e === null && logins === 0 && calls.join() === 'activate:nonce:plain,create::proof', `${e?.code} ${calls.join()}`);

    // 4) Primer login de un usuario nuevo: bind inmediato con el token fresco
    calls.length = 0;
    const tNew = await token({ sub: 'nuevo1' });
    t.check('primer login: bindWalletOnLogin liga de inmediato', (await bindWalletOnLogin(mk(nuevo, tNew))) === true && calls.join() === 'activate:nonce:plain,activate:bind:plain', calls.join());
    t.check('primer login: fila user_wallets creada desde el inicio', db.tables.user_wallets.find((w: any) => w.sub === 'nuevo1')?.wallet_address === nuevo.publicKey());
    calls.length = 0; logins = 0;
    const expN = await token({ sub: 'nuevo1', exp: now - 600 });
    e = await errOf(() => api(mk(nuevo, expN), '/api/orders/create', {}));
    t.check('usuario nuevo con token vencido después: renueva, nunca relogin', e === null && logins === 0, `${e?.code} ${calls.join()}`);
    t.check('nunca se llamó logout() en todo el flujo', logouts === 0);
  } finally { globalThis.fetch = realFetch; setReloginHandler(null); }
}
