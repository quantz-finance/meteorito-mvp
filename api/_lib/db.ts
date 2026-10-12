import { createClient } from '@supabase/supabase-js';
import { env } from './env';
import { HttpError } from './auth';
let c: any = null;
export const db = (): any => (c ??= createClient(env.supabaseUrl(), env.supabaseService(), { auth: { persistSession: false } }));
export function json(res: any, status: number, body: unknown) { res.status(status).setHeader('Content-Type', 'application/json'); res.send(JSON.stringify(body)); }
export function fail(res: any, e: any) { return json(res, e instanceof HttpError ? e.status : 500, { error: e.message }); }
export async function orderBySlug(slug: unknown): Promise<any> {
  if (typeof slug !== 'string' || !/^[a-z0-9]{6}$/.test(slug)) throw new HttpError(400, 'slug inválido');
  const { data, error } = await db().from('orders').select('*').eq('slug', slug).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'pedido no existe');
  return data;
}
/** Update condicionado al status actual (evita carreras). */
export async function advance(id: string, from: string, patch: Record<string, unknown>) {
  const { data, error } = await db().from('orders').update(patch).eq('id', id).eq('status', from).select('id');
  if (error) throw error;
  if (!data?.length) throw new HttpError(409, `el pedido ya no está en ${from}`);
}
export async function logEvent(order_id: string, kind: string, detail: Record<string, unknown> = {}) {
  await db().from('order_events').insert({ order_id, kind, detail });
}
