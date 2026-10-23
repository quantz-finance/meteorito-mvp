import { createClient } from '@supabase/supabase-js';
import { env } from './env';
import { randomBytes } from 'node:crypto';
import { HttpError, __setSessionStore } from './auth';
import { trackServer } from './analytics';
let c: any = null;
export const db = (): any => (c ??= createClient(env.supabaseUrl(), env.supabaseService(), { auth: { persistSession: false } }));
/** Solo tests: inyecta un cliente falso. */
export const __setDbForTests = (fake: any) => { c = fake; };
export function json(res: any, status: number, body: unknown) { res.status(status).setHeader('Content-Type', 'application/json'); res.send(JSON.stringify(body)); }
export function fail(res: any, e: any) {
  const body: any = { error: e?.message ?? String(e) };
  if (e?.code && typeof e.code === 'string') body.code = e.code;
  if (Array.isArray(e?.missing)) body.missing = e.missing;
  if (!(e instanceof HttpError)) console.error('[api] 500', e);
  return json(res, e instanceof HttpError ? e.status : 500, body);
}
export async function orderBySlug(slug: unknown): Promise<any> {
  if (typeof slug !== 'string' || !/^[a-z0-9]{6}$/.test(slug)) throw new HttpError(400, 'slug inválido');
  const { data, error } = await db().from('orders').select('*').eq('slug', slug).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'pedido no existe');
  return data;
}
/** Update condicionado al status actual (evita carreras). */
export async function advance(id: string, from: string, patch: Record<string, unknown>) {
  const { data, error } = await db().from('orders').update(patch).eq('id', id).eq('status', from).select('id, slug, status, seller_user_id, buyer_user_id, brand, model');
  if (error) throw error;
  if (!data?.length) throw new HttpError(409, `el pedido ya no está en ${from}`);
  // Aviso push a las dos partes (pagado, enviado, entregado, liberado, disputa…). Best-effort, sin VAPID no hace nada.
  if (patch.status && patch.status !== from) {
    const { notifyOrder } = await import('./push');
    await notifyOrder(data[0] as any);
  }
}
/** Bitácora best-effort: nunca debe tapar el resultado real (p. ej. un release rechazado). */
export async function logEvent(order_id: string, kind: string, detail: Record<string, unknown> = {}) {
  try { await db().from('order_events').insert({ order_id, kind, detail }); }
  catch (e: any) { console.warn('[logEvent] falló', kind, e?.message); }
  await trackServer(order_id, kind, detail);
}

// Sesión: sub -> wallet (migración 007) y nonces de un uso para renovar tokens Cavos vencidos.
__setSessionStore({
  async boundWallet(sub) {
    const { data, error } = await db().from('user_wallets').select('wallet_address').eq('sub', sub).maybeSingle();
    if (error) throw new HttpError(503, 'No pudimos verificar tu sesión. Intenta de nuevo.');
    return data?.wallet_address ?? null;
  },
  async bind(sub, address) {
    const { error } = await db().from('user_wallets').insert({ sub, wallet_address: address });
    if (error && error.code !== '23505') console.error('[auth] bind falló', error.code);
  },
  async rebind(sub, address) {
    const { error } = await db().from('user_wallets').update({ wallet_address: address, source: 'rebind_fresh_token' }).eq('sub', sub);
    if (error) console.error('[auth] rebind falló', error.code);
  },
  async issueNonce(sub) {
    const nonce = randomBytes(24).toString('hex');
    const { error } = await db().from('session_nonces').insert({ nonce, sub, expires_at: new Date(Date.now() + 300_000).toISOString() });
    if (error) throw new HttpError(503, 'No pudimos verificar tu sesión. Intenta de nuevo.');
    return nonce;
  },
  async consumeNonce(sub, nonce) {
    const { data, error } = await db().from('session_nonces').update({ used_at: new Date().toISOString() })
      .eq('nonce', nonce).eq('sub', sub).is('used_at', null).gt('expires_at', new Date().toISOString()).select('nonce');
    if (error) throw new HttpError(503, 'No pudimos verificar tu sesión. Intenta de nuevo.');
    return (data ?? []).length === 1;
  },
});
