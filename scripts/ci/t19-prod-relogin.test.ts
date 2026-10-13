// (19) Repro prod 2026-10-12 (ybbtsr): token Cavos vencido de una cuenta (sub A9bp…, ligada a GAOK4… que nunca existió
// on-chain) + billetera conectada distinta. Antes: POST /api/wallet/activate 401 session_expired en bucle (cada clic
// emitía un nonce que nunca se consumía). Ahora: 401 session_wallet_mismatch, sin bucle, mensaje de re-login; con token
// fresco se re-liga (la wallet anterior no existe); auto-compra bloqueada; vendedor con wallet lista no llama al API.
import { Keypair } from '@stellar/stellar-sdk';
import type { T } from './setup';
import { installTestJwks, res, token } from './jwt';
import { proofMessage } from '../../api/_lib/auth';
import { relinkMessage } from '../../api/_lib/relink';
import { __setDbForTests } from '../../api/_lib/db';
import { __setHorizonForTests } from '../../api/_lib/wallet';
import { fakeDb } from './fakedb';
import { api } from '../../lib/api';
import { ensureWalletReady, walletErrorNotice } from '../../lib/wallet';
import { USDC_TESTNET_ISSUER } from '../../lib/config';
import pay from '../../api/escrow/pay';
import activate from '../../api/wallet/activate';

const pre = (m: string) => Buffer.concat([Buffer.from('Cavos Signed Message:\n'), Buffer.from(String(Buffer.byteLength(m))), Buffer.from('\n'), Buffer.from(m)]);
const sign = (kp: Keypair, m: string) => kp.sign(pre(m)).toString('base64');
const addrProof = (kp: Keypair, action: string, ref: string) => { const m = proofMessage(action, ref, kp.publicKey(), Math.floor(Date.now() / 1000)); return { address: kp.publicKey(), publicKey: kp.publicKey(), message: m, signature: sign(kp, m) }; };

export async function run(t: T) {
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = ''; delete process.env.SESSION_GRACE_DAYS;
  const now = Math.floor(Date.now() / 1000);
  const oldW = Keypair.random(), newW = Keypair.random(), buyer2 = Keypair.random(), ready = Keypair.random();
  const onChain = new Set([buyer2.publicKey(), ready.publicKey()]);
  __setHorizonForTests(() => ({ loadAccount: async (a: string) => { if (!onChain.has(a)) throw Object.assign(new Error('nf'), { response: { status: 404 } }); return { balances: [{ asset_code: 'USDC', asset_issuer: process.env.USDC_ISSUER ?? USDC_TESTNET_ISSUER, balance: '0' }] }; } }) as any);
  const db = fakeDb(); db.tables.user_wallets = []; db.tables.session_nonces = []; __setDbForTests(db as any);
  db.tables.user_wallets.push({ sub: 'A9bp', wallet_address: oldW.publicKey(), source: 'backfill_orders' });
  db.tables.orders.push({ id: '99999999-9999-4999-8999-999999999999', slug: 'ybbtsr', status: 'creado', seller_user_id: 'ht2I', seller_address: buyer2.publicKey(), price_crc: 1000 });

  // Navegador: fetch -> handlers reales (Vercel) y Horizon simulado para el cliente.
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: any, i: any = {}) => {
    const url = String(u);
    if (url.includes('/accounts/')) { const a = url.split('/accounts/')[1]; const ok = onChain.has(a);
      return { ok, status: ok ? 200 : 404, json: async () => ({ balances: [{ asset_type: 'native', balance: '0' }, { asset_code: 'USDC', asset_issuer: USDC_TESTNET_ISSUER, balance: '0' }] }) }; }
    const body = JSON.parse(i.body ?? '{}'); calls.push(`${url}:${body.step ?? ''}:${i.headers?.['X-Meteorito-Proof'] ? 'proof' : 'plain'}`);
    const r = res(); const h: Record<string, string> = {}; for (const [k, v] of Object.entries(i.headers ?? {})) h[k.toLowerCase()] = String(v);
    await (url === '/api/wallet/activate' ? activate : pay)({ method: 'POST', url, headers: h, body, query: {} }, r);
    return { ok: r.code < 400, status: r.code, json: async () => r.body };
  }) as any;
  const mkAuth = (kp: Keypair, tok: string): any => ({ address: kp.publicKey(), isAuthenticated: true, wallet: { state: 'undeployed' }, getAuthToken: () => tok, signMessage: async (m: string) => ({ publicKey: kp.publicKey(), signature: sign(kp, m) }) });
  const errOf = async (f: () => Promise<unknown>) => { try { await f(); return null; } catch (e: any) { return e; } };
  try {
    // 1) Repro: token vencido sub A9bp + billetera conectada newW ('Pagar seguro' -> ensureWalletReady -> activate)
    const expired = await token({ sub: 'A9bp', exp: now - 1800 });
    const e = await errOf(() => ensureWalletReady(mkAuth(newW, expired)));
    t.check('repro: activate con token vencido + otra billetera -> 401 session_wallet_mismatch (no session_expired)', e?.status === 401 && e?.code === 'session_wallet_mismatch', `${e?.status} ${e?.code}`);
    t.check('repro: sin bucle (1 nonce + 1 intento con prueba; 0 reintentos extra)', calls.join() === '/api/wallet/activate:nonce:plain,/api/wallet/activate:prepare:proof', calls.join());
    t.check('repro: aviso al usuario pide re-login (no "vuelve a cargar")', /iniciar sesión/.test(walletErrorNotice(e)) && !/cargar la página/.test(walletErrorNotice(e)));
    // 2) Re-login (token fresco): status NO re-liga; relink explícito con nonce (anterior 404, sin items activos tras cancelar oabqoi)
    const fresh = await token({ sub: 'A9bp' });
    let r = res(); await activate({ method: 'POST', url: '/api/wallet/activate', headers: { authorization: `Bearer ${fresh}` }, body: { step: 'status', proof: addrProof(newW, 'wallet', 'activate') }, query: {} }, r);
    t.check('token fresco con otra wallet: bind implícito NO re-liga', db.tables.user_wallets.find((w: any) => w.sub === 'A9bp')?.wallet_address === oldW.publicKey());
    const act = async (tok: string, body: any) => { const x = res(); await activate({ method: 'POST', url: '/api/wallet/activate', headers: { authorization: `Bearer ${tok}` }, body, query: {} }, x); return x; };
    const n = (await act(fresh, { step: 'nonce' })).body.nonce;
    r = await act(fresh, { step: 'relink', proof: { address: newW.publicKey(), publicKey: newW.publicKey(), signature: sign(newW, relinkMessage('A9bp', n)), nonce: n } });
    t.check('relink explícito (anterior 404, sin items) -> re-ligado + auditoría', r.code === 200 && db.tables.user_wallets.find((w: any) => w.sub === 'A9bp')?.wallet_address === newW.publicKey() && db.tables.wallet_relinks?.length === 1, JSON.stringify(r.body));
    calls.length = 0;
    const e2 = await errOf(() => api(mkAuth(newW, expired), '/api/wallet/activate', { step: 'status', proof: addrProof(newW, 'wallet', 'activate') }));
    t.check('luego: token vencido + wallet ligada -> renueva (nonce consumido)', e2 === null && db.tables.session_nonces.some((n: any) => n.sub === 'A9bp' && n.used_at), String(e2?.code));
    // 3) Wallet ligada que SÍ existe on-chain nunca se re-liga
    db.tables.user_wallets.push({ sub: 'ht2I', wallet_address: buyer2.publicKey(), source: 'backfill_orders' });
    r = res(); await activate({ method: 'POST', url: '/api/wallet/activate', headers: { authorization: `Bearer ${await token({ sub: 'ht2I' })}` }, body: { step: 'status', proof: addrProof(oldW, 'wallet', 'activate') }, query: {} }, r);
    t.check('wallet ligada existente on-chain -> no se re-liga', db.tables.user_wallets.find((w: any) => w.sub === 'ht2I')?.wallet_address === buyer2.publicKey());
    // 4) Auto-compra: buyer2 (vendedor de ybbtsr) intentando pagar su propio link
    r = res(); await pay({ method: 'POST', url: '/api/escrow/pay', headers: { authorization: `Bearer ${await token({ sub: 'ht2I' })}` }, body: { slug: 'ybbtsr', step: 'start', proof: addrProof(buyer2, 'pay', 'ybbtsr') }, query: {} }, r);
    t.check('vendedor pagando su propio link -> 409 self_purchase', r.code === 409 && r.body?.code === 'self_purchase', JSON.stringify(r.body));
    // 5) Vendedor con wallet ya lista (seller2): Inicio no llama al API (no puede fallar por sesión)
    calls.length = 0;
    const e3 = await errOf(() => ensureWalletReady(mkAuth(ready, expired)));
    t.check('wallet lista on-chain -> ensureWalletReady sin llamadas al API', e3 === null && calls.length === 0, calls.join());
  } finally { globalThis.fetch = realFetch; }
}
