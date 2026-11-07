import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { api, __resetBindForTests, setReloginHandler } from '../../lib/api';
import { invitePost, INVITE_TIMEOUT_MESSAGE } from '../../lib/inviteRequest';
import { patchKitRetry, RETRY_MARK } from '../patch-cavos-kit.mjs';

export async function run(t: T) {
  const realFetch = globalThis.fetch;
  let opened = 0, signed = 0, sent = 0;
  const tok = 'e30.' + Buffer.from(JSON.stringify({ sub: 'email-buyer', exp: Date.now() / 1000 + 3600 })).toString('base64url') + '.sig';
  const auth: any = { isAuthenticated: true, address: 'GTEST', wallet: { state: 'undeployed' }, getAuthToken: () => tok,
    signMessage: () => { signed++; return new Promise(() => {}); } };
  setReloginHandler(() => { opened++; }); __resetBindForTests();
  try {
    globalThis.fetch = (async (u: any, i: any) => {
      sent++;
      t.check('solo POST invites con Bearer, sin nonce/bind ni fallback invitado', u === '/api/invites' && i.headers.Authorization === `Bearer ${tok}` && JSON.parse(i.body).op === 'create');
      return { ok: true, status: 200, json: async () => ({ code: 'ps5test1' }) };
    }) as any;
    const out = await api(auth, '/api/invites', { op: 'create', title: 'PlayStation 5 usada', price_crc: 150000 });
    t.check('crear con token fresco no espera una firma Cavos colgada', out.code === 'ps5test1' && signed === 0 && sent === 1 && opened === 0);
    const expired = 'e30.' + Buffer.from(JSON.stringify({ sub: 'email-buyer', exp: Date.now() / 1000 - 300 })).toString('base64url') + '.sig';
    let proofSeen = false;
    globalThis.fetch = (async (u: any, i: any) => {
      if (u === '/api/wallet/activate') return { ok: true, status: 200, json: async () => ({ nonce: 'a'.repeat(48) }) };
      proofSeen = !!i.headers['X-Meteorito-Proof'];
      return { ok: true, status: 200, json: async () => ({ code: 'ps5test2' }) };
    }) as any;
    await api({ ...auth, getAuthToken: () => expired, signMessage: async () => ({ publicKey: 'GTEST', signature: 'c2ln' }) }, '/api/invites', { op: 'create' });
    t.check('token vencido conserva nonce/firma de renovación; no bypass de sesión', proofSeen);
    // Deadline real incluso si fetch ignora abort, o si cuelga la lectura JSON.
    for (const bodyHangs of [false, true]) {
      let signal: AbortSignal | undefined; sent = 0;
      globalThis.fetch = (async (_u: any, i: any) => { sent++; signal = i.signal;
        return bodyHangs ? { json: () => new Promise(() => {}) } : new Promise(() => {});
      }) as any;
      let e: any; try { await invitePost('/api/invites', {}, {}, 5); } catch (err) { e = err; }
      t.check(`deadline ${bodyHangs ? 'cuerpo' : 'fetch'}: aviso claro, abort, sin reenvío ni login`, e?.code === 'invite_timeout' && e.message === INVITE_TIMEOUT_MESSAGE && !!signal?.aborted && sent === 1 && opened === 0);
    }
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as any;
    let e: any; try { await api(auth, '/api/invites', { op: 'create' }); } catch (err) { e = err; }
    t.check('fallo de red no se presenta como pérdida de cuenta ni abre modal', e?.code === 'invite_network' && /propuesta/.test(e.message) && opened === 0);
    globalThis.fetch = (async () => ({ ok: false, status: 504, json: async () => { throw new Error('html gateway'); } })) as any;
    try { await api(auth, '/api/invites', { op: 'create' }); } catch (err) { e = err; }
    t.check('gateway no JSON: aviso de propuesta reintentable, no modal', e?.code === 'invite_unavailable' && /propuesta/.test(e.message) && opened === 0);
    globalThis.fetch = (async () => ({ ok: false, status: 503, json: async () => ({ code: 'auth_unavailable', error: 'Vuelve a intentar en un momento.' }) })) as any;
    try { await api(auth, '/api/invites', { op: 'create' }); } catch (err) { e = err; }
    t.check('503 JWKS conserva retry sin re-login', e?.code === 'auth_unavailable' && opened === 0);
  } finally { globalThis.fetch = realFetch; setReloginHandler(null); __resetBindForTests(); }

  const kit = readFileSync('node_modules/@cavos/kit/dist/react/index.mjs', 'utf8');
  const sample = 'const [busy, setBusy] = useState(false);';
  const patched = patchKitRetry(sample);
  t.check('parche retry instalado e idempotente', kit.includes(RETRY_MARK) && patchKitRetry(patched.out).out === patched.out);
  // El OTP exitoso deja busy=true; el efecto REAL del kit lo libera al reabrir/cerrar.
  const effect = kit.match(/(?:react\.)?useEffect\(\(\) => \{ setBusy\(false\); \}, \[open\]\);/)?.[0];
  let busy = true;
  if (effect) new Function('useEffect', 'react', 'setBusy', 'open', effect)((fn: any) => fn(), { useEffect: (fn: any) => fn() }, (b: boolean) => { busy = b; }, true);
  t.check('reabrir modal después del OTP habilita las opciones (busy=false)', !!effect && !busy);
  const screen = readFileSync('app/i/nueva.tsx', 'utf8');
  t.check('error deja el borrador y ofrece Reintentar', screen.includes('err ? "Reintentar" : "Crear invitación"') && screen.includes('finally { setBusy(false); }'));
}
