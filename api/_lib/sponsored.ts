// Bloque "Patrocinado" del feed de Comprar (migración 024, tabla sponsored_listings). Publicidad IDENTIFICABLE (Ley 7472):
// la app los muestra siempre en su propio bloque con la etiqueta "Patrocinado", nunca mezclados como si fueran orgánicos.
// Solo patrocinios reales: status 'activa' y dentro de [starts_at, ends_at). Sin la tabla o sin activos: [] (no hay bloque).
// Respeta el filtro (Identidad confirmada / Sin confirmar) y la búsqueda. Nunca sale lo que pagó el vendedor ni las notas.
import { db } from './db';
import { matchesTokens, type VerifiedFilter } from './feedText';
import { publicSeller, sellersFor, titleOf } from './feed';

export const SPONSORED_MAX = 6;
export interface SponsoredCard { id: number; slug: string; title: string; price_crc: number; photo: string | null; seller: ReturnType<typeof publicSeller> }

/** Orden: lo que más pagó primero (empate: id). Rota cada hora para que todos los activos pasen por el primer lugar. */
export function rotate<T>(list: T[], now: number): T[] {
  if (!list.length) return list;
  const k = Math.floor(now / 3600e3) % list.length;
  return [...list.slice(k), ...list.slice(0, k)];
}

export async function sponsoredFor(p: { verified: VerifiedFilter; tokens: string[] }, now = Date.now()): Promise<SponsoredCard[]> {
  try {
    const iso = new Date(now).toISOString();
    const { data: sp, error } = await db().from('sponsored_listings').select('id, order_slug, seller_user_id, amount_paid_crc')
      .eq('status', 'activa').lte('starts_at', iso).gt('ends_at', iso).order('amount_paid_crc', { ascending: false }).limit(50);
    if (error || !sp?.length) return [];
    const { data: os, error: e2 } = await db().from('orders').select('slug, brand, model, description, price_crc, photos, seller_user_id, kind, status, listing_status, listing_slug')
      .in('slug', sp.map((x: any) => x.order_slug));
    if (e2) return [];
    const bySlug = new Map<string, any>((os ?? []).map((o: any) => [o.slug, o]));
    const sellers = await sellersFor([...new Set<string>(sp.map((x: any) => String(x.seller_user_id)))]);
    const ok = [...sp].sort((a: any, b: any) => (Number(b.amount_paid_crc) - Number(a.amount_paid_crc)) || (Number(a.id) - Number(b.id))).flatMap((x: any) => {
      const o = bySlug.get(x.order_slug); const s = sellers.get(x.seller_user_id);
      // Solo productos permanentes disponibles, del mismo vendedor que pagó, visibles en el feed.
      if (!o || !s || !s.listed || o.seller_user_id !== x.seller_user_id || o.kind !== 'listing' || o.status !== 'creado' || o.listing_status !== 'activa' || o.listing_slug) return [];
      if ((p.verified === 'true' && !s.verified) || (p.verified === 'false' && s.verified)) return [];
      if (p.tokens.length && !matchesTokens(`${titleOf(o)} ${o.description ?? ''} ${s.display_name}`, p.tokens)) return [];
      return [{ id: Number(x.id), slug: o.slug, title: titleOf(o), price_crc: Number(o.price_crc), photo: o.photos?.[0] ?? null, seller: publicSeller(s) }];
    });
    return rotate(ok, now).slice(0, SPONSORED_MAX);
  } catch { return []; }
}
