// Seguir vendedores (migración 022, tabla seller_follows). PRIVADO: al público solo le llega el número de seguidores,
// nunca quién sigue a quién. Quien sigue = cuenta (sub de Cavos) o, sin cuenta, 'guest:<hash>' de la llave del
// dispositivo (api/_lib/guest.ts). Sin la migración: seguir responde 503 'follows_unavailable', el conteo es null (la
// app no lo muestra) y "a quién sigo" es una lista vacía. Nada más se rompe.
import { db } from './db';
import { HttpError } from './auth';
import type { BuyerIdentity } from './guest';
import { isMissingTable, notifyOrder, vapid, type PushDeps, type PushMsg } from './push';

/** Anti-spam: cambios de seguir/dejar de seguir por minuto, por identidad y (sin cuenta) por IP. Tope total en la base (500). */
export const FOLLOW_PER_MIN = 20;
export const FOLLOW_IP_PER_MIN = 40;
export const FOLLOW_MAX = 500;
/** Aviso a seguidores: como mucho uno por vendedor cada FOLLOW_PUSH_COOLDOWN_H horas, y a los FOLLOW_PUSH_MAX más recientes. */
export const FOLLOW_PUSH_COOLDOWN_H = 3;
export const FOLLOW_PUSH_MAX = 300;

const hits = new Map<string, number[]>();
export function followRateLimited(key: string, now = Date.now(), max = FOLLOW_PER_MIN): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= max) { hits.set(key, recent); return true; }
  recent.push(now); hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}
export const __resetFollowLimits = () => hits.clear();

/** Con cuenta, se sigue con la cuenta (sirve en todos sus dispositivos); sin cuenta, con la llave de este dispositivo. */
export const followerIdOf = (who: Pick<BuyerIdentity, 'cavos' | 'guest'>): string => who.cavos?.sub ?? who.guest!;

const unavailable = () => Object.assign(new HttpError(503, 'Todavía no puedes seguir vendedores. Intenta más tarde.'), { code: 'follows_unavailable' });

async function sellerBySlug(slug: string): Promise<{ sub: string; store_slug: string } | null> {
  const { data, error } = await db().from('seller_profiles').select('sub, store_slug').eq('store_slug', slug).maybeSingle();
  if (error) { if (isMissingTable(error)) return null; throw error; }
  return (data as any) ?? null;
}

/** Número de seguidores (solo el número). null si la tabla no existe todavía o ante un error: la app no lo muestra. */
export async function followerCount(sellerSub: string): Promise<number | null> {
  try {
    const { data, count, error } = await db().from('seller_follows').select('id', { count: 'exact', head: true }).eq('seller_user_id', sellerSub);
    if (error) return null;
    return typeof count === 'number' ? count : Array.isArray(data) ? data.length : 0;
  } catch { return null; }
}

/** subs de los vendedores que sigue esta identidad (todas sus identidades: cuenta y/o dispositivo). [] sin la tabla. */
export async function followedSellerSubs(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  try {
    const { data, error } = await db().from('seller_follows').select('seller_user_id').in('follower_id', ids).limit(FOLLOW_MAX * 2);
    if (error) return [];
    return [...new Set<string>((data ?? []).map((r: any) => String(r.seller_user_id)))];
  } catch { return []; }
}
/** Usuarios de tienda que sigue esta identidad (para pintar "Siguiendo"). Nunca devuelve subs. */
export async function followingSlugs(ids: string[]): Promise<string[]> {
  const subs = await followedSellerSubs(ids);
  if (!subs.length) return [];
  const { data, error } = await db().from('seller_profiles').select('sub, store_slug').in('sub', subs);
  if (error) return [];
  return (data ?? []).map((r: any) => r.store_slug).filter(Boolean);
}

/** Seguir (on=true) o dejar de seguir (on=false) a un vendedor por su usuario. Idempotente. */
export async function setFollow(who: BuyerIdentity, storeSlug: string, on: boolean): Promise<{ following: boolean; followers: number | null }> {
  const seller = await sellerBySlug(storeSlug);
  if (!seller) throw Object.assign(new HttpError(404, 'Este perfil no existe.'), { code: 'not_found' });
  if (who.ids.includes(seller.sub)) throw Object.assign(new HttpError(400, 'No puedes seguir tu propia tienda.'), { code: 'self_follow' });
  if (on) {
    const { error } = await db().from('seller_follows').insert({ follower_id: followerIdOf(who), seller_user_id: seller.sub });
    if (error && isMissingTable(error)) throw unavailable();
    if (error && /follow_limit/.test(String(error.message ?? ''))) throw Object.assign(new HttpError(429, `Ya sigues a ${FOLLOW_MAX} vendedores. Deja de seguir a alguno para seguir a otro.`), { code: 'follow_limit' });
    if (error && error.code !== '23505') throw error; // 23505: ya lo seguía
  } else {
    const { error } = await db().from('seller_follows').delete().in('follower_id', who.ids).eq('seller_user_id', seller.sub);
    if (error && isMissingTable(error)) throw unavailable();
    if (error) throw error;
  }
  return { following: on, followers: await followerCount(seller.sub) };
}

/** Avisos push a los seguidores cuando el vendedor publica un producto. Pura: se prueba sin red. */
export function followerMessages(seller: { display_name: string }, listing: { slug: string; title: string }, followerIds: string[], sellerSub: string): PushMsg[] {
  const name = String(seller.display_name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Un vendedor que sigues';
  const title = String(listing.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'un producto nuevo';
  return [...new Set(followerIds)].filter((id) => id && id !== sellerSub).map((to) => ({
    to, role: 'buyer' as const, title: `${name} publicó algo nuevo`, body: `${title}. Ábrelo para verlo.`, url: `/p/${listing.slug}`, tag: `follow:${sellerSub.slice(0, 40)}`,
  }));
}

/** Best-effort, nunca lanza. Solo productos permanentes (los links de un solo uso son para un comprador puntual). */
export async function notifyFollowers(sellerSub: string, listing: { slug: string; title: string }, deps: PushDeps & { now?: number } = {}): Promise<number> {
  try {
    if (!(deps.enabled ?? (() => !!vapid()))()) return 0; // sin push configurado: ni siquiera se consulta
    const now = deps.now ?? Date.now();
    // Anti-spam: si ya publicó otro producto en las últimas horas, sus seguidores ya recibieron un aviso.
    const since = new Date(now - FOLLOW_PUSH_COOLDOWN_H * 3600e3).toISOString();
    const { data: recent } = await db().from('orders').select('slug').eq('seller_user_id', sellerSub).eq('kind', 'listing').gt('created_at', since).neq('slug', listing.slug).limit(1);
    if ((recent ?? []).length) return 0;
    const { data: rows, error } = await db().from('seller_follows').select('follower_id').eq('seller_user_id', sellerSub).order('created_at', { ascending: false }).limit(FOLLOW_PUSH_MAX);
    if (error || !rows?.length) return 0;
    const { data: sp } = await db().from('seller_profiles').select('display_name').eq('sub', sellerSub).maybeSingle();
    const msgs = followerMessages({ display_name: (sp as any)?.display_name ?? '' }, listing, rows.map((r: any) => r.follower_id), sellerSub);
    if (!msgs.length) return 0;
    return await notifyOrder({ slug: listing.slug, status: 'creado' }, deps, msgs);
  } catch (e: any) { console.warn('[follows] aviso falló', e?.message); return 0; }
}
