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

export async function api<T = any>(auth: MeteoritoAuth, path: string, body: unknown): Promise<T> {
  const token = auth.getAuthToken();
  if (!token) throw Object.assign(new Error('Tu sesión venció. Vuelve a cargar la página para continuar.'), { code: 'auth_missing' });
  const send = async (withProof: boolean) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    if (withProof) headers['X-Meteorito-Proof'] = await sessionProofHeader(auth, token, 'POST', path.split('?')[0]);
    const r = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
    return { r, j: await r.json().catch(() => ({})) as any };
  };
  const pre = tokenExpiresSoon(token);
  let { r, j } = await send(pre);
  if (!pre && r.status === 401 && j.code === 'session_expired') ({ r, j } = await send(true)); // reintento único
  if (!r.ok) {
    if (r.status === 401) console.error('[api] auth', path, j.code, j.error);
    if (j.code === 'session_wallet_mismatch') console.error('[api] la sesión (token) es de otra cuenta/billetera que la conectada: requiere volver a iniciar sesión');
    throw Object.assign(new Error(j.error ?? `Error ${r.status}`), { status: r.status, code: j.code ?? `http_${r.status}`, missing: j.missing });
  }
  return j as T;
}
