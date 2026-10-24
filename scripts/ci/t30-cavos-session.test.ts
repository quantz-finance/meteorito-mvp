// (30) Sesión Cavos persistente (PWA iOS, recarga, pestaña nueva, token vencido en gracia, vencida de verdad, logout)
// y traducción de TODOS los errores de Cavos: el usuario nunca ve "registry lookup skipped: no login token" ni otro crudo.
import type { T } from './setup';

class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); } clear() { this.m.clear(); } get length() { return this.m.size; } key(i: number) { return [...this.m.keys()][i] ?? null; } }
const b64u = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (exp: number, sub = 'u1') => `${b64u({ alg: 'RS256' })}.${b64u({ sub, exp, iat: exp - 3600 })}.sig`;

export async function run(t: T) {
  process.env.EXPO_PUBLIC_CAVOS_APP_ID = process.env.EXPO_PUBLIC_CAVOS_APP_ID || 'cav_test';
  const w: any = { sessionStorage: new Mem(), localStorage: new Mem() }; (globalThis as any).window = w;
  const S = await import('../../lib/cavosSession');
  const tk = S.SDK_TOKEN_KEY(), pk = S.PERSIST_KEY(), ik = S.SDK_IDENTITY_KEY();
  const now = Math.floor(Date.now() / 1000);
  const fresh = jwt(now + 3600), fresher = jwt(now + 3500 + 600);
  const identity = JSON.stringify({ userId: 'u1', email: 'a@b.c' });
  const login = (tok = fresh) => { w.sessionStorage.setItem(tk, tok); w.localStorage.setItem(ik, identity); S.persistCavosToken(); };
  const closeApp = () => { w.sessionStorage = new Mem(); }; // iOS borra sessionStorage al cerrar la PWA / pestaña nueva
  const reset = () => { w.sessionStorage = new Mem(); w.localStorage = new Mem(); S.__resetForTests(); };

  t.check('jwtExp / tokenState', S.jwtExp(fresh) === now + 3600 && S.tokenState(fresh) === 'fresh' && S.tokenState(jwt(now - 3600)) === 'renewable'
    && S.tokenState(jwt(now - 8 * 86400)) === 'expired' && S.tokenState('basura') === 'invalid');

  // login: el SDK deja el token en sessionStorage -> espejo en localStorage
  reset(); login();
  t.check('login: token copiado a localStorage', w.localStorage.getItem(pk) === fresh);

  // (1) reabrir la PWA de iOS
  closeApp();
  t.check('(1) reabrir PWA: token repuesto ANTES del SDK', S.rehydrateCavosToken() === 'restored' && w.sessionStorage.getItem(tk) === fresh && !S.sessionExpiredOnOpen());
  t.check('(1) la identidad del SDK sigue (reconecta solo)', w.localStorage.getItem(ik) === identity && S.hadSessionOnOpen());
  S.markSessionSettled();
  t.check('login exitoso / logout apagan el aviso de sesión terminada', !S.hadSessionOnOpen() && !S.sessionExpiredOnOpen());

  // (2) recargar la página: sessionStorage intacto
  t.check('(2) recargar: present, no toca nada', S.rehydrateCavosToken() === 'present' && w.sessionStorage.getItem(tk) === fresh);

  // (3) pestaña nueva (sessionStorage vacío) + re-login en otra pestaña con token más nuevo
  closeApp();
  t.check('(3) pestaña nueva: restored', S.rehydrateCavosToken() === 'restored' && S.currentCavosToken() === fresh);
  w.localStorage.setItem(pk, fresher);
  t.check('(3) token más nuevo de otra pestaña reemplaza al viejo', S.rehydrateCavosToken() === 'restored' && w.sessionStorage.getItem(tk) === fresher);
  w.sessionStorage.setItem(tk, fresh); S.persistCavosToken();
  t.check('(3) un token más viejo nunca pisa al guardado', w.localStorage.getItem(pk) === fresher);
  // iOS borra sessionStorage con la app abierta: getAuthToken cae al guardado
  w.sessionStorage = new Mem();
  t.check('(3) getAuthToken sin sessionStorage usa la copia', S.currentCavosToken() === fresher && w.sessionStorage.getItem(tk) === fresher);

  // (4) token vencido pero dentro de la gracia. Cavos (vault/registro) lo rechaza al reconectar (401 "Invalid user token",
  // 13 de 13 en PostHog): NO se repone al SDK; "Entrar de nuevo" de inmediato (t82 cubre el re-login sin perder nada).
  reset(); const old = jwt(now - 2 * 3600); login(old);
  t.check('(4) un token vencido no se persiste (Cavos ya no lo acepta)', w.localStorage.getItem(pk) !== old);
  w.localStorage.setItem(pk, old); closeApp();
  t.check('(4) reabrir con token vencido en gracia: stale, no se repone al SDK', S.rehydrateCavosToken() === 'stale' && !w.sessionStorage.getItem(tk) && S.sessionExpiredOnOpen());
  t.check('(4) sin reconexión condenada: identidad del SDK quitada, marca "Entrar de nuevo"', !w.localStorage.getItem(ik) && S.hadSessionOnOpen() && !w.localStorage.getItem(pk));

  // (5) sesión realmente vencida (fuera de la gracia de 7 días)
  reset(); w.localStorage.setItem(ik, identity); w.localStorage.setItem(pk, jwt(now - 8 * 86400));
  t.check('(5) vencida: expired, no se repone', S.rehydrateCavosToken() === 'expired' && !w.sessionStorage.getItem(tk));
  t.check('(5) se borran copia e identidad (no reconecta a medias)', !w.localStorage.getItem(pk) && !w.localStorage.getItem(ik));
  t.check('(5) marca "Entrar de nuevo"', S.sessionExpiredOnOpen() && S.needsRelogin(S.RELOGIN_MESSAGE));
  w.sessionStorage.setItem(tk, jwt(now - 8 * 86400)); S.persistCavosToken();
  t.check('(5) un token fuera de gracia nunca se persiste', !w.localStorage.getItem(pk));
  login(fresh);
  t.check('(5) volver a entrar limpia la marca', !S.sessionExpiredOnOpen() && w.localStorage.getItem(pk) === fresh);

  // (6) logout
  S.clearCavosToken();
  t.check('(6) logout borra copia persistente y de la pestaña', !w.localStorage.getItem(pk) && !w.sessionStorage.getItem(tk));
  closeApp();
  t.check('(6) tras logout, reabrir no repone nada', S.rehydrateCavosToken() === 'none' && !w.sessionStorage.getItem(tk));

  // storage bloqueado (modo privado / iOS): nunca lanza
  (globalThis as any).window = {};
  let threw = false; try { S.rehydrateCavosToken(); S.persistCavosToken(); S.clearCavosToken(); S.currentCavosToken(); } catch { threw = true; }
  t.check('storage bloqueado: nunca lanza', !threw);
  (globalThis as any).window = w;

  // Traducción de errores Cavos
  const raws = [
    'registry lookup skipped: no login token', 'registry backup skipped: no login token', 'registry lookup failed: 401 {"error":"invalid token"}',
    'passkey wraps lookup failed: 401', 'passkey wrap save failed: 403', 'Sign in again to restore this device.',
    'kit/stellar: this wallet is protected by recovery. Sign in with Google, Apple or an email link to continue.',
    'Failed to fetch', 'NotAllowedError: The operation either timed out or was not allowed.', 'Could not connect your wallet.',
    'Sign-in failed. Please try again.', 'Wallet Cavos no lista', 'Cavos: This wallet has no recovery set up',
  ];
  const outs = raws.map((r) => S.friendlyCavosError(r)!);
  t.check('ningún error de Cavos se muestra crudo', outs.every((o, i) => o && o !== raws[i] && !/registry|token|skipped|kit\/|wallet is|failed|401|403/i.test(o)));
  t.check('registry/backup/lookup/passkey-wraps 401 -> "Entrar de nuevo"', outs.slice(0, 7).every((o) => o === S.RELOGIN_MESSAGE));
  t.check('mensajes sin palabras prohibidas', [...new Set(outs)].every((o) => !/segur|proteg|garant|pronto/i.test(o)));
  t.check('userMessage traduce crudos de Cavos en cualquier pantalla', raws.every((r) => S.userMessage(r) !== r));
  t.check('userMessage respeta mensajes propios en español', S.userMessage('El link ya fue pagado.') === 'El link ya fue pagado.' && S.userMessage('Tu sesión venció. Vuelve a iniciar sesión con la misma cuenta para continuar.').startsWith('Tu sesión'));
  t.check('sin error -> null', S.friendlyCavosError(null) === null && S.friendlyCavosError('') === null);
  delete (globalThis as any).window;

  // api(): sin token -> re-login (abre Entrar), nunca "recarga la página"
  const A = await import('../../lib/api');
  let opened = 0; A.setReloginHandler(() => { opened++; });
  const auth: any = { isAuthenticated: true, address: 'G'.padEnd(56, 'A'), getAuthToken: () => null, wallet: { state: 'ready' }, openLogin: () => {} };
  let code = ''; try { await A.api(auth, '/api/x', {}); } catch (e: any) { code = e.code; }
  t.check('api sin token -> session_relogin_required + abre Entrar', code === 'session_relogin_required' && opened === 1);
  A.setReloginHandler(null);
}
