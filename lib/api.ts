// Cliente de /api (escrituras). Siempre con JWT Cavos + prueba de dirección cuando aplica.
import type { MeteoritoAuth } from './types';

export async function proof(auth: MeteoritoAuth, action: string, ref: string) {
  if (!auth.address) throw new Error('Iniciá sesión');
  const ts = Math.floor(Date.now() / 1000);
  const message = `meteorito:${action}:${ref}:${auth.address}:${ts}`;
  const { publicKey, signature } = await auth.signMessage(message);
  return { address: auth.address, publicKey, signature, message };
}

export async function api<T = any>(auth: MeteoritoAuth, path: string, body: unknown): Promise<T> {
  const token = auth.getAuthToken();
  if (!token) throw new Error('Sesión vencida: volvé a entrar');
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
  return j as T;
}
