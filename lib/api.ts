// Cliente de /api (escrituras). Siempre con JWT Cavos + prueba de dirección cuando aplica.
// El kit Cavos 0.3.0 guarda el id_token del login (~1 h) y no lo renueva. Si vence, adjuntamos una prueba FRESCA
// firmada por la wallet ligada (X-Meteorito-Proof, nonce de un uso) y el servidor acepta el token vencido
// (≤ SESSION_GRACE_DAYS, default 7). Reintento único.
import type { MeteoritoAuth } from './types';
import { DEMO_ENABLED, demoApi } from './demo';
import { guestKey } from './guest';
import { holdUpdate } from './updater';
import { RELOGIN_MESSAGE } from './cavosSession';

export async function proof(auth: MeteoritoAuth, action: string, ref: string) {
  if (!auth.address) throw new Error('Inicia sesión');
  // Segundo dispositivo sin la llave todavía: no llamar a Cavos (fallaría con "not an authorized signer").
  if (auth.wallet?.state === 'needs-approval') throw Object.assign(new Error('este dispositivo todavía no tiene la llave: confirmar con passkey'), { code: 'device_needs_passkey' });
  const ts = Math.floor(Date.now() / 1000);
  const message = `meteorito:${action}:${ref}:${auth.address}:${ts}`;
  const { publicKey, signature } = await auth.signMessage(message);
  return { address: auth.address, publicKey, signature, message };
}

function claims(token: string): { exp?: number; sub?: string; user_id?: string } {
  try { const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(atob(p + '='.repeat((4 - (p.length % 4)) % 4))); } catch { return {}; }
}
export const tokenExpiresSoon = (token: string, now = Date.now() / 1000) => { const e = claims(token).exp; return !e || e - now < 60; };
export const sessionRef = (sub: string) => sub.replace(/[^A-Za-z0-9_-]/g, '_');

export const sessionMessage = (sub: string, nonce: string, method: string, path: string) => `meteorito:session:${sessionRef(sub)}:${nonce}:${method.toUpperCase()}:${path}`;

/** Prueba no reutilizable: nonce de un uso del servidor + firma sobre sub/nonce/método/ruta. */
async function sessionProofHeader(auth: MeteoritoAuth, token: string, method: string, path: string): Promise<string> {
  const c = claims(token); const sub = String(c.sub ?? c.user_id ?? '');
  const r = await fetch('/api/wallet/activate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ step: 'nonce' }) });
  const j: any = await r.json().catch(() => ({}));
  // Sin nonce = el servidor ya no acepta este token (fuera de la gracia, sin billetera ligada o inválido): volver a entrar.
  // Antes se mostraba "Vuelve a cargar la página", que nunca lo resolvía (recargar no renueva el token de Cavos).
  if (!r.ok || !j.nonce) {
    const code = j.code ?? 'session_expired';
    if (RELOGIN_CODES.has(code)) throw reloginErr(code === 'session_relogin_required' ? j.error : undefined);
    throw Object.assign(new Error(j.error ?? SESSION_RELOGIN_MSG), { status: r.status, code });
  }
  if (!auth.address) throw new Error('Inicia sesión');
  const { publicKey, signature } = await auth.signMessage(sessionMessage(sub, j.nonce, method, path));
  return btoa(JSON.stringify({ address: auth.address, publicKey, signature, nonce: j.nonce }));
}

export const bindMessage = (sub: string, nonce: string) => `meteorito:bind:${sessionRef(sub)}:${nonce}`;
export const relinkMessage = (sub: string, nonce: string) => `meteorito:relink:${sessionRef(sub)}:${nonce}`;
export const SESSION_RELOGIN_MSG = 'Tu sesión venció. Vuelve a iniciar sesión con la misma cuenta para continuar. Tu billetera se mantiene en este dispositivo.';

// session_relogin_required: token vencido y la cuenta aún sin wallet ligada. NUNCA se reintenta y NUNCA se llama a
// logout() (borra la llave). La app abre el login de Cavos (openLogin) y, con el token fresco, hace bind antes de todo.
let reloginHandler: ((auth: MeteoritoAuth) => void) | null = null;
export const setReloginHandler = (h: ((auth: MeteoritoAuth) => void) | null) => { reloginHandler = h; };
/** Códigos del servidor que se resuelven volviendo a entrar con la misma cuenta (nunca recargando la página). */
const RELOGIN_CODES = new Set(['session_relogin_required', 'session_expired', 'auth_invalid', 'auth_missing']);
const reloginErr = (msg?: string) => Object.assign(new Error(msg || SESSION_RELOGIN_MSG), { status: 401, code: 'session_relogin_required' });
function onRelogin(auth: MeteoritoAuth) { try { reloginHandler?.(auth); } catch (e) { console.error('[api] relogin handler', e); } }

async function rawPost(token: string, path: string, body: unknown) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? `Error ${r.status}`), { status: r.status, code: j.code ?? `http_${r.status}` });
  return j;
}

// Bind sub -> wallet con cada token FRESCO nuevo (primer login y re-login), antes de cualquier otra acción del API.
// Clave por sub+iat+exp (nunca se guarda el token). Idempotente en el servidor.
const boundKeys = new Set<string>();
let bindInFlight: Promise<boolean> | null = null;
const tokenKey = (token: string) => { const c: any = claims(token); return `${c.sub ?? c.user_id ?? ''}:${c.iat ?? ''}:${c.exp ?? ''}`; };
export const __resetBindForTests = () => { boundKeys.clear(); bindInFlight = null; };

/** true si hizo bind ahora; false si ya estaba hecho para este token, el token no es fresco o la llave no está aquí. */
export async function ensureBound(auth: MeteoritoAuth): Promise<boolean> {
  if (DEMO_ENABLED) return false; // modo demo: sin bind ni red
  if (!auth.isAuthenticated || !auth.address) return false;
  if (auth.wallet && auth.wallet.state !== 'ready' && auth.wallet.state !== 'undeployed') return false;
  const token = auth.getAuthToken();
  if (!token || tokenExpiresSoon(token)) return false;
  const key = tokenKey(token);
  if (boundKeys.has(key)) return false;
  if (bindInFlight) { await bindInFlight; return false; }
  bindInFlight = (async () => {
    boundKeys.add(key); // un intento por token (falla = se loguea; el servidor igual valida cada escritura)
    const c = claims(token); const sub = String(c.sub ?? c.user_id ?? '');
    try {
      const { nonce } = await rawPost(token, '/api/wallet/activate', { step: 'nonce' });
      const { publicKey, signature } = await auth.signMessage(bindMessage(sub, nonce));
      const b = await rawPost(token, '/api/wallet/activate', { step: 'bind', proof: { address: auth.address, publicKey, signature, nonce } });
      if (b.relinkRequired) {
        // Cuenta ligada a otra billetera: re-link explícito (el servidor exige 404 on-chain de la anterior y sin pedidos activos).
        const { nonce: n2 } = await rawPost(token, '/api/wallet/activate', { step: 'nonce' });
        const sg = await auth.signMessage(relinkMessage(sub, n2));
        await rawPost(token, '/api/wallet/activate', { step: 'relink', proof: { address: auth.address, publicKey: sg.publicKey, signature: sg.signature, nonce: n2 } });
      }
      return true;
    } catch (e: any) { console.error('[api] bind con token fresco', e?.code, e?.message); return false; }
  })();
  try { return await bindInFlight; } finally { bindInFlight = null; }
}

// Re-login sin perder lo que estabas haciendo: si la sesión ya no sirve, se abre el login de Cavos ENCIMA de la pantalla
// actual (sin logout, la llave se queda), se espera el token nuevo y la acción se reintenta UNA vez sola. La app registra
// el "waiter" (app/_layout.tsx); sin él (tests, nativo) se comporta como antes: error session_relogin_required.
export interface ReloginWaiter {
  /** ¿Sigue abierto el login de Cavos? Si se cierra sin token nuevo, se deja de esperar. */
  isOpen(): boolean;
  /** Sesión más reciente publicada por el puente de Cavos. */
  current(): MeteoritoAuth;
  timeoutMs?: number; pollMs?: number; openGraceMs?: number;
}
let waiter: ReloginWaiter | null = null;
export const setReloginWaiter = (w: ReloginWaiter | null) => { waiter = w; };
const canSign = (a: MeteoritoAuth) => !a.wallet || a.wallet.state === 'ready' || a.wallet.state === 'undeployed';

/** Espera el token FRESCO de un re-login (distinto al anterior) con la billetera lista para firmar. null = no volvió a entrar. */
export async function waitForFreshLogin(prevToken: string | null): Promise<MeteoritoAuth | null> {
  const w = waiter; if (!w) return null;
  const start = Date.now(); const prevKey = prevToken ? tokenKey(prevToken) : '';
  const timeout = w.timeoutMs ?? 180_000, poll = w.pollMs ?? 400, grace = w.openGraceMs ?? 4_000;
  for (;;) {
    const a = w.current(); const t = a.getAuthToken();
    const renewed = !!t && !tokenExpiresSoon(t) && tokenKey(t) !== prevKey;
    if (renewed && a.isAuthenticated && !!a.address && canSign(a)) return a;
    const el = Date.now() - start;
    if (el > timeout) return null;
    if (el > grace && !renewed && !w.isOpen()) return null; // cerró el login sin entrar
    await new Promise((r) => setTimeout(r, poll));
  }
}

export async function api<T = any>(auth: MeteoritoAuth, path: string, body: unknown): Promise<T> {
  const release = holdUpdate(); // sin recarga por actualización mientras haya un pago/firma/llamada en curso
  try {
    try { return await apiInner<T>(auth, path, body, true); }
    catch (e: any) {
      if (e?.code !== 'session_relogin_required' || !waiter) throw e;
      const fresh = await waitForFreshLogin(auth.getAuthToken());
      if (!fresh) throw e;
      return await apiInner<T>(fresh, path, body, false); // reintento único tras volver a entrar
    }
  } finally { release(); }
}
async function apiInner<T>(auth: MeteoritoAuth, path: string, body: unknown, openLogin: boolean): Promise<T> {
  const relogin = (msg?: string) => { if (openLogin) onRelogin(auth); return reloginErr(msg); };
  if (DEMO_ENABLED) { // modo demo: backend simulado, nunca llega a /api real
    try { return (await demoApi(path, body, auth.getAuthToken())) as T; }
    catch (e: any) { if (e?.code === 'session_relogin_required') throw relogin(e.message); throw e; }
  }
  const token = auth.getAuthToken();
  // Sin token (sesión fuera de la gracia o borrada): pedir volver a entrar, nunca "recarga la página".
  if (!token) throw relogin();
  await ensureBound(auth); // token fresco nuevo (login / re-login): bind primero
  const send = async (withProof: boolean) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    // Crear link: también la llave de invitado, para que el servidor detecte si respondes a tu propia invitación.
    if (path === '/api/orders/create') headers['X-Guest-Key'] = guestKey();
    if (withProof) headers['X-Meteorito-Proof'] = await sessionProofHeader(auth, token, 'POST', path.split('?')[0]);
    const r = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
    return { r, j: await r.json().catch(() => ({})) as any };
  };
  const pre = tokenExpiresSoon(token);
  const guarded = async (withProof: boolean) => {
    try { return await send(withProof); }
    catch (e: any) {
      if (e?.code === 'session_relogin_required') throw relogin(e.message);
      // Cavos rechazó la sesión al firmar la prueba (su 401, ya traducido): también se resuelve volviendo a entrar.
      if (e?.message === RELOGIN_MESSAGE) throw relogin();
      throw e;
    }
  };
  let { r, j } = await guarded(pre);
  if (!pre && r.status === 401 && j.code === 'session_expired') ({ r, j } = await guarded(true)); // reintento único
  if (!r.ok) {
    if (j.code === 'session_relogin_required') throw relogin(j.error); // nunca se reintenta sin un token nuevo
    if (r.status === 401) console.error('[api] auth', path, j.code, j.error);
    if (r.status === 401 && RELOGIN_CODES.has(j.code)) throw relogin(); // vencida fuera de la gracia o inválida: re-login
    if (j.code === 'session_wallet_mismatch') console.error('[api] la sesión (token) es de otra cuenta/billetera que la conectada: requiere volver a iniciar sesión');
    throw Object.assign(new Error(j.error ?? `Error ${r.status}`), { status: r.status, code: j.code ?? `http_${r.status}`, missing: j.missing });
  }
  return j as T;
}

/** Acciones del COMPRADOR sin cuenta: se identifica con su llave de invitado (X-Guest-Key), no con login ni wallet.
 *  Si hay sesión Cavos se adjunta el token solo para que el servidor detecte "el vendedor comprando su propio link"
 *  (un token vencido o malo se ignora en el servidor cuando hay llave de invitado). */
export async function guestApi<T = any>(auth: Pick<MeteoritoAuth, 'getAuthToken'>, path: string, body: unknown): Promise<T> {
  const release = holdUpdate();
  try { return await guestApiInner<T>(auth, path, body); } finally { release(); }
}
async function guestApiInner<T>(auth: Pick<MeteoritoAuth, 'getAuthToken'>, path: string, body: unknown): Promise<T> {
  if (DEMO_ENABLED) return (await demoApi(path, body)) as T;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Guest-Key': guestKey() };
  const token = auth.getAuthToken(); if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? `Error ${r.status}`), { status: r.status, code: j.code ?? `http_${r.status}` });
  return j as T;
}
