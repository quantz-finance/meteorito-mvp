import { createClient } from '@supabase/supabase-js';
import { env } from './env';
import { HttpError } from './auth';
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
  const { data, error } = await db().from('orders').update(patch).eq('id', id).eq('status', from).select('id');
  if (error) throw error;
  if (!data?.length) throw new HttpError(409, `el pedido ya no está en ${from}`);
}
/** Bitácora best-effort: nunca debe tapar el resultado real (p. ej. un release rechazado). */
export async function logEvent(order_id: string, kind: string, detail: Record<string, unknown> = {}) {
  try { await db().from('order_events').insert({ order_id, kind, detail }); }
  catch (e: any) { console.warn('[logEvent] falló', kind, e?.message); }
  await trackServer(order_id, kind, detail);
}
