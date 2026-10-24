// (84) "Tu sesión venció" del vendedor (42 de 71 error_shown en PostHog). Causa raíz: el id_token de Cavos dura ~1 h y el
// kit NO lo renueva; al reabrir la PWA se le reponía al SDK un token vencido "en gracia" y Cavos (vault/registro) lo
// rechaza: 401 "Invalid user token" (13 de 13 aperturas). Además, varios caminos decían "Vuelve a cargar la página", que
// nunca lo resuelve. Arreglo: (1) solo tokens vigentes y de la misma cuenta al SDK; con uno vencido, "Entrar de nuevo" de
// una vez; (2) re-login ENCIMA de la pantalla + reintento único de la acción; (3) borrador de Vender en localStorage
// (sobrevive a que iOS cierre la app); (4) misma pantalla al volver a entrar; (5) copy sin "recarga la página". Sin red.
import { readFileSync } from 'node:fs';
import type { T } from './setup';

class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); } clear() { this.m.clear(); } get length() { return this.m.size; } key(i: number) { return [...this.m.keys()][i] ?? null; } }
const b64u = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (exp: number, sub = 'u1', iat = exp - 3600) => `${b64u({ alg: 'RS256' })}.${b64u({ sub, exp, iat })}.sig`;
const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

export async function run(t: T) {
  process.env.EXPO_PUBLIC_CAVOS_APP_ID = process.env.EXPO_PUBLIC_CAVOS_APP_ID || 'cav_test';
  const w: any = { sessionStorage: new Mem(), localStorage: new Mem() }; (globalThis as any).window = w;
  const S = await import('../../lib/cavosSession');
  const tk = S.SDK_TOKEN_KEY(), pk = S.PERSIST_KEY(), ik = S.SDK_IDENTITY_KEY();
  const now = Math.floor(Date.now() / 1000);
  const idOf = (userId: string) => JSON.stringify({ userId, email: `${userId}@ci` });
  const reset = () => { w.sessionStorage = new Mem(); w.localStorage = new Mem(); S.__resetForTests(); };

  // ---- (1) Reabrir la PWA: qué token recibe el SDK
  reset(); w.localStorage.setItem(ik, idOf('u1')); w.localStorage.setItem(pk, jwt(now - 1800));
  t.check('reabrir con token vencido hace 30 min -> stale (Cavos respondería 401), no se repone', S.rehydrateCavosToken() === 'stale' && !w.sessionStorage.getItem(tk));
  t.check('stale: "Entrar de nuevo" inmediato, sin reconexión condenada (identidad del SDK quitada)', S.sessionExpiredOnOpen() && S.hadSessionOnOpen() && !w.localStorage.getItem(ik) && !w.localStorage.getItem(pk));
  reset(); const skew = jwt(now - 120); w.localStorage.setItem(ik, idOf('u1')); w.localStorage.setItem(pk, skew);
  t.check('reloj del teléfono: vencido hace 2 min (≤ 5 min de margen) sí se intenta', S.rehydrateCavosToken() === 'restored' && w.sessionStorage.getItem(tk) === skew);
  reset(); const otra = jwt(now + 3000, 'u2'); w.localStorage.setItem(ik, idOf('u1')); w.localStorage.setItem(pk, otra);
  const r1 = S.rehydrateCavosToken();
  t.check('token guardado de OTRA cuenta: nunca se repone (evita "aes/gcm: invalid ghash tag" / 401)', r1 !== 'restored' && w.sessionStorage.getItem(tk) !== otra && !w.localStorage.getItem(pk), r1);
  reset(); const vig = jwt(now + 3000); w.localStorage.setItem(ik, idOf('u1')); w.localStorage.setItem(pk, vig);
  t.check('token vigente de la misma cuenta: restored', S.rehydrateCavosToken() === 'restored' && w.sessionStorage.getItem(tk) === vig && !S.sessionExpiredOnOpen());
  // persist: gana el emitido después (iat), no el que vence más tarde; otra cuenta reemplaza
  reset(); const otpLargo = jwt(now + 6 * 86400, 'u1', now - 100); w.localStorage.setItem(pk, otpLargo);
  const google = jwt(now + 3600, 'u1', now - 10); w.sessionStorage.setItem(tk, google); S.persistCavosToken();
  t.check('persist: el login más reciente (iat) reemplaza aunque venza antes', w.localStorage.getItem(pk) === google);
  const b = jwt(now + 1800, 'u2', now - 200); w.sessionStorage.setItem(tk, b); S.persistCavosToken();
  t.check('persist: login con otra cuenta reemplaza la copia (aunque sea más viejo)', w.localStorage.getItem(pk) === b);
  w.sessionStorage.setItem(tk, jwt(now - 3600)); S.persistCavosToken();
  t.check('persist: un token vencido nunca se guarda', w.localStorage.getItem(pk) === b);

  // ---- (2) Re-login encima de la pantalla + reintento único
  const A = await import('../../lib/api');
  const realFetch = globalThis.fetch;
  let opened = 0; A.setReloginHandler(() => { opened++; });
  const addr = 'G'.padEnd(56, 'A');
  const mk = (tok: string, extra: any = {}): any => ({ isAuthenticated: true, address: addr, wallet: { state: 'ready' }, getAuthToken: () => tok, openLogin() {},
    signMessage: async () => ({ publicKey: addr, signature: 'c2ln' }), ...extra });
  const oldTok = jwt(now + 3600, 'seller', now - 50), newTok = jwt(now + 3600, 'seller', now - 5);
  let fresh: any = mk(oldTok); let loginOpen = true;
  A.setReloginWaiter({ isOpen: () => loginOpen, current: () => fresh, pollMs: 5, openGraceMs: 30, timeoutMs: 2000 });
  const seen: string[] = [];
  globalThis.fetch = (async (u: any, i: any = {}) => {
    const auth = String(i.headers?.Authorization ?? ''); const body = JSON.parse(i.body ?? '{}');
    seen.push(`${String(u).split('/').pop()}:${body.step ?? ''}:${auth.endsWith(newTok) ? 'nuevo' : 'viejo'}`);
    if (String(u) === '/api/wallet/activate') return { ok: true, status: 200, json: async () => (body.step === 'nonce' ? { nonce: 'a'.repeat(48) } : { bound: true }) };
    if (auth.endsWith(oldTok)) return { ok: false, status: 401, json: async () => ({ code: 'session_relogin_required' }) };
    return { ok: true, status: 200, json: async () => ({ slug: 'abc123' }) };
  }) as any;
  A.__resetBindForTests();
  // el usuario entra en el login (token nuevo) mientras la acción espera
  setTimeout(() => { fresh = mk(newTok); }, 40);
  let out: any = null, err: any = null;
  try { out = await A.api(mk(oldTok), '/api/orders/create', { title: 'x' }); } catch (e) { err = e; }
  t.check('sesión vencida en plena acción: abre el login UNA vez (sin logout) y reintenta sola con el token nuevo', out?.slug === 'abc123' && opened === 1, `${err?.code} ${seen.join()}`);
  t.check('reintento único: acción con token viejo, bind con el nuevo, acción con el nuevo', seen.filter((x) => x.startsWith('create')).join() === 'create::viejo,create::nuevo' && seen.includes('activate:bind:nuevo'), seen.join());
  // cerró el login sin entrar: no se queda esperando ni reintenta
  opened = 0; seen.length = 0; fresh = mk(oldTok); loginOpen = false;
  const t0 = Date.now(); err = null;
  try { await A.api(mk(oldTok), '/api/orders/create', {}); } catch (e) { err = e; }
  t.check('cerró el login sin entrar: error session_relogin_required pronto, 1 sola llamada, sin bucle', err?.code === 'session_relogin_required' && seen.filter((x) => x.startsWith('create')).length === 1 && Date.now() - t0 < 1500, `${err?.code} ${Date.now() - t0}ms`);
  t.check('el aviso pide volver a entrar (nunca "recarga la página")', !/cargar la página/i.test(err?.message ?? '') && /iniciar sesión|entrar/i.test(err?.message ?? ''));
  // aún falla tras el re-login: no hay segundo reintento ni segundo login
  opened = 0; seen.length = 0; loginOpen = true;
  globalThis.fetch = (async (u: any, i: any = {}) => { const body = JSON.parse(i.body ?? '{}'); seen.push(`${String(u).split('/').pop()}:${body.step ?? ''}`);
    if (String(u) === '/api/wallet/activate') return { ok: true, status: 200, json: async () => ({ nonce: 'b'.repeat(48), bound: true }) };
    return { ok: false, status: 401, json: async () => ({ code: 'session_relogin_required', error: 'x' }) }; }) as any;
  const tok3 = jwt(now + 3600, 'seller', now - 2); setTimeout(() => { fresh = mk(tok3); }, 20);
  err = null; try { await A.api(mk(oldTok), '/api/orders/create', {}); } catch (e) { err = e; }
  t.check('si sigue fallando tras volver a entrar: un solo reintento y un solo login', err?.code === 'session_relogin_required' && opened === 1 && seen.filter((x) => x.startsWith('create')).length === 2, `${opened} ${seen.join()}`);
  // nonce rechazado (fuera de la gracia): antes "Vuelve a cargar la página" sin abrir el login
  A.setReloginWaiter(null); opened = 0;
  globalThis.fetch = (async () => ({ ok: false, status: 401, json: async () => ({ code: 'session_expired', error: 'Tu sesión venció. Vuelve a cargar la página para continuar.' }) })) as any;
  err = null; try { await A.api(mk(jwt(now - 600, 'seller')), '/api/orders/create', {}); } catch (e) { err = e; }
  t.check('nonce rechazado por sesión vencida -> session_relogin_required + abre el login (no "recarga")', err?.code === 'session_relogin_required' && opened === 1 && !/cargar la página/.test(err?.message), `${err?.code} ${err?.message}`);
  // Cavos rechaza al firmar la prueba (su 401 traducido): también re-login
  opened = 0;
  globalThis.fetch = (async (u: any) => (String(u) === '/api/wallet/activate' ? { ok: true, status: 200, json: async () => ({ nonce: 'c'.repeat(48) }) } : { ok: true, status: 200, json: async () => ({}) })) as any;
  err = null; try { await A.api(mk(jwt(now - 600, 'seller'), { signMessage: async () => { throw new Error(S.RELOGIN_MESSAGE); } }), '/api/orders/create', {}); } catch (e) { err = e; }
  t.check('Cavos rechaza la sesión al firmar -> re-login, no un error suelto', err?.code === 'session_relogin_required' && opened === 1, `${err?.code}`);
  // auth_invalid en la acción -> re-login (antes: aviso genérico "No pudimos preparar tu cuenta")
  opened = 0;
  globalThis.fetch = (async (u: any) => (String(u) === '/api/wallet/activate' ? { ok: true, status: 200, json: async () => ({ nonce: 'd'.repeat(48), bound: true }) } : { ok: false, status: 401, json: async () => ({ code: 'auth_invalid', error: 'x' }) })) as any;
  err = null; try { await A.api(mk(jwt(now + 3600, 'seller', now - 1)), '/api/wallet/activate?x', { step: 'prepare' }); } catch (e) { err = e; }
  globalThis.fetch = realFetch; A.setReloginHandler(null);
  const { walletErrorNotice } = await import('../../lib/wallet');
  t.check('auth_invalid -> re-login con aviso claro', err?.code === 'session_relogin_required' && opened === 1 && /iniciar sesión/.test(walletErrorNotice(err)));
  t.check('walletErrorNotice(auth_invalid) pide volver a entrar (no el genérico)', /iniciar sesión/.test(walletErrorNotice({ code: 'auth_invalid', message: 'x' })));

  // ---- (3) Copy del servidor
  const auth = await import('../../api/_lib/auth');
  t.check('servidor: SESSION_EXPIRED / AUTH_INVALID ya no dicen "vuelve a cargar la página"', !/cargar la página/.test(auth.SESSION_EXPIRED) && !/cargar la página/.test(auth.AUTH_INVALID) && /Vuelve a entrar/.test(auth.SESSION_EXPIRED));
  t.check('activate (bind con token renovado) usa el mismo texto', !/cargar la página/.test(src('api/wallet/activate.ts')));
  t.check('copy sin palabras prohibidas', [auth.SESSION_EXPIRED, auth.AUTH_INVALID].every((m) => !/segur|garant|verificad|empresa|fintech|banco|proteg/i.test(m)));

  // ---- (4) Borrador de Vender: sobrevive al re-login y a que iOS cierre la PWA
  const D = await import('../../lib/sellDraft');
  reset(); D.__resetSellDraftForTests();
  D.saveSellDraft({ owner: addr, title: 'iPhone 13', price: '250 000', description: null, photos: [{ url: 'https://x.supabase.co/storage/v1/object/public/p/a.jpg', uri: 'blob:local' }, { url: 'data:image/jpeg;base64,AAAA' }], mode: 'cara_a_cara', windowMin: 1440, source: null });
  w.sessionStorage = new Mem(); D.__resetSellDraftForTests(); // iOS cierra la app: se pierde sessionStorage y la memoria
  const d = D.loadSellDraft(addr);
  t.check('borrador tras cerrar la PWA: título, precio, acuerdo y fotos ya subidas', d?.title === 'iPhone 13' && d?.price === '250 000' && d?.mode === 'cara_a_cara' && d?.windowMin === 1440 && d?.photos?.length === 1 && d.photos[0].url.startsWith('https://'));
  t.check('borrador: nunca guarda data: URLs (cuota) ni blob:', !String(w.localStorage.getItem(D.DRAFT_KEY)).includes('data:') && !String(w.localStorage.getItem(D.DRAFT_KEY)).includes('blob:'));
  D.__resetSellDraftForTests();
  t.check('borrador: otra cuenta en el mismo teléfono no lo ve', D.loadSellDraft('G'.padEnd(56, 'B')) === null);
  D.__resetSellDraftForTests();
  t.check('borrador: vence a las 24 h', D.loadSellDraft(addr, Date.now() + D.DRAFT_TTL_MS + 1000) === null && !w.localStorage.getItem(D.DRAFT_KEY));
  reset(); D.__resetSellDraftForTests(); w.sessionStorage.setItem('meteorito:sell-draft-v2', JSON.stringify({ owner: addr, title: 'viejo', price: '5000' }));
  t.check('borrador v2 (sessionStorage) se migra', D.loadSellDraft(addr)?.title === 'viejo');
  D.saveSellDraft(null);
  t.check('al generar el link se borra', !w.localStorage.getItem(D.DRAFT_KEY) && D.loadSellDraft(addr) === null);
  const v = src('app/(tabs)/vender.tsx');
  t.check('Vender usa el borrador persistente (fotos + acuerdo), no el de sessionStorage', /loadSellDraft\(address\)/.test(v) && /saveSellDraft\(\{[^}]*photos/.test(v) && !/sessionStorage/.test(v));

  // ---- (5) Misma pantalla al volver a entrar
  const R = await import('../../lib/returnTo');
  reset(); R.__resetReturnForTests();
  R.rememberRoute('/pedidos');
  t.check('sin re-login pendiente no navega (primer login normal)', R.takeReturnRoute('/vender') === null);
  R.markReloginPending(); w.sessionStorage = new Mem(); // login con Google: redirección / PWA reabierta
  t.check('re-login tras sesión perdida: vuelve a la pantalla donde estaba', R.takeReturnRoute('/vender') === '/pedidos');
  t.check('la marca se consume (una sola vez)', R.takeReturnRoute('/vender') === null);
  R.rememberRoute('/mi-tienda'); R.markReloginPending();
  t.check('si ya volvió a una pantalla concreta no la cambia', R.takeReturnRoute('/ventas') === null);
  R.rememberRoute('//evil.com'); R.rememberRoute('/vender?cavos_auth_code=x'); R.markReloginPending();
  t.check('rutas no seguras o de callback nunca se guardan', R.takeReturnRoute('/') === '/mi-tienda');
  R.rememberRoute('/ventas', Date.now() - R.RETURN_TTL_MS - 1); R.markReloginPending();
  t.check('ruta vieja (>24 h) no se restaura', R.takeReturnRoute('/') === null);
  const lay = src('app/_layout.tsx');
  t.check('la app registra el waiter (login encima de la pantalla) y la ruta de regreso', /setReloginWaiter\(/.test(lay) && /takeReturnRoute\(/.test(lay) && /markReloginPending\(\)/.test(lay));
  delete (globalThis as any).window;
}
