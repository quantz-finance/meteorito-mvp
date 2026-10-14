// Cliente de /api (escrituras). Siempre con JWT Cavos + prueba de dirección cuando aplica.
// El kit Cavos 0.3.0 guarda el id_token del login (~1 h) y no lo renueva. Si vence, adjuntamos una prueba FRESCA
// firmada por la wallet ligada (X-Meteorito-Proof, nonce de un uso) y el servidor acepta el token vencido
// (≤ SESSION_GRACE_DAYS, default 7). Reintento único.
import type { MeteoritoAuth } from './types';

export async function proof(auth: MeteoritoAuth, action: string, ref: string) {
  if (!auth.address) throw new Error('Iniciá sesión');
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
  if (!r.ok || !j.nonce) throw Object.assign(new Error(j.error ?? 'Tu sesión venció. Vuelve a cargar la página para continuar.'), { status: r.status, code: j.code ?? 'session_expired' });
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

export async function api<T = any>(auth: MeteoritoAuth, path: string, body: unknown): Promise<T> {
  const token = auth.getAuthToken();
  if (!token) throw Object.assign(new Error('Tu sesión venció. Vuelve a cargar la página para continuar.'), { code: 'auth_missing' });
  await ensureBound(auth); // token fresco nuevo (login / re-login): bind primero
  const send = async (withProof: boolean) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    if (withProof) headers['X-Meteorito-Proof'] = await sessionProofHeader(auth, token, 'POST', path.split('?')[0]);
    const r = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
    return { r, j: await r.json().catch(() => ({})) as any };
  };
  const pre = tokenExpiresSoon(token);
  const guarded = async (withProof: boolean) => {
    try { return await send(withProof); }
    catch (e: any) { if (e?.code === 'session_relogin_required') { onRelogin(auth); throw reloginErr(e.message); } throw e; }
  };
  let { r, j } = await guarded(pre);
  if (!pre && r.status === 401 && j.code === 'session_expired') ({ r, j } = await guarded(true)); // reintento único
  if (!r.ok) {
    if (j.code === 'session_relogin_required') { onRelogin(auth); throw reloginErr(j.error); } // nunca se reintenta
    if (r.status === 401) console.error('[api] auth', path, j.code, j.error);
    if (j.code === 'session_wallet_mismatch') console.error('[api] la sesión (token) es de otra cuenta/billetera que la conectada: requiere volver a iniciar sesión');
    throw Object.assign(new Error(j.error ?? `Error ${r.status}`), { status: r.status, code: j.code ?? `http_${r.status}`, missing: j.missing });
  }
  return j as T;
}
