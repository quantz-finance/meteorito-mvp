// Feed público de Comprar + buscador + perfil público del vendedor (/t/<usuario>). Solo lectura, sin datos privados.
// Feed: TODOS los vendedores con al menos un producto permanente activo (kind 'listing', status 'creado', activa, no hijo),
// salvo los ocultos por moderación (seller_profiles.listed_in_feed = false, migración 020; sin ella nadie está oculto).
// Filtro por verificación: seller_profiles.verified (migración 010; se activa a mano por ahora; a futuro, pago + KYC).
// Búsqueda: sin mayúsculas ni acentos, por palabras (todas deben aparecer) en título, descripción y nombre del vendedor.
// En la base: ILIKE con las vocales como comodín (encuentra "cámara" con "camara" sin necesitar unaccent) y el filtro
// exacto después, con el mismo foldText. pg_trgm (020) solo acelera esos ILIKE.
import { db } from './db';
import { HttpError } from './auth';
import { missingColumn } from './listings';
import { storeDbErr } from './store';
import { waLink } from './contact';

import { decodeCursor, encodeCursor, foldText, ilikePattern, matchesTokens, parseVerified, searchTokens, FEED_DEFAULT, FEED_MAX, type VerifiedFilter } from './feedText';
export { decodeCursor, encodeCursor, foldText, ilikePattern, matchesTokens, parseVerified, searchTokens };

interface Seller { sub: string; store_slug: string; display_name: string; avatar_url: string | null; verified: boolean; listed: boolean; rating_avg: number | null; rating_count: number }
const titleOf = (o: any) => `${o.brand ?? ''} ${o.model ?? ''}`.trim() || 'Artículo';

/** seller_profiles con fallback: listed_in_feed (020) y avatar_url (014) pueden no existir todavía. */
async function profilesBy(apply: (q: any) => any): Promise<any[]> {
  for (const cols of ['sub, store_slug, display_name, avatar_url, verified, listed_in_feed', 'sub, store_slug, display_name, avatar_url, verified', 'sub, store_slug, display_name, verified']) {
    const { data, error } = await apply(db().from('seller_profiles').select(cols));
    if (error && missingColumn(error)) continue;
    if (error) storeDbErr(error);
    return data ?? [];
  }
  return [];
}
async function sellersFor(subs: string[]): Promise<Map<string, Seller>> {
  const out = new Map<string, Seller>();
  if (!subs.length) return out;
  const rows = await profilesBy((q) => q.in('sub', subs));
  const slugs = rows.map((p) => p.store_slug);
  const { data: rs } = slugs.length ? await db().from('public_stores').select('store_slug, rating_avg, rating_count').in('store_slug', slugs) : { data: [] };
  const rating = new Map<string, any>((rs ?? []).map((r: any) => [r.store_slug, r]));
  for (const p of rows) {
    if (!p.store_slug || !String(p.display_name ?? '').trim()) continue; // perfil incompleto
    const r = rating.get(p.store_slug);
    out.set(p.sub, { sub: p.sub, store_slug: p.store_slug, display_name: p.display_name, avatar_url: p.avatar_url ?? null, verified: p.verified === true,
      listed: p.listed_in_feed !== false, rating_avg: r?.rating_avg == null ? null : Number(r.rating_avg), rating_count: Number(r?.rating_count ?? 0) });
  }
  return out;
}
const publicSeller = (s: Seller) => ({ store_slug: s.store_slug, display_name: s.display_name, avatar_url: s.avatar_url, verified: s.verified, rating_avg: s.rating_avg, rating_count: s.rating_count });

export interface FeedQuery { q?: unknown; cursor?: unknown; limit?: unknown; verified?: unknown }
/** Una página del feed (o de la búsqueda). next_cursor = created_at del último revisado; null si no hay más. */
export async function feedPage(p: FeedQuery) {
  const tokens = searchTokens(p.q);
  let verified: VerifiedFilter;
  try { verified = parseVerified(p.verified); } catch (e: any) { throw Object.assign(new HttpError(400, e.message), { code: 'bad_filter' }); }
  const limit = Math.min(FEED_MAX, Math.max(1, Number.parseInt(String(p.limit ?? FEED_DEFAULT), 10) || FEED_DEFAULT));
  let cursor: string | null = null;
  if (p.cursor != null && p.cursor !== '') { cursor = decodeCursor(p.cursor); if (!cursor) throw Object.assign(new HttpError(400, 'Recarga el feed e intenta de nuevo.'), { code: 'bad_cursor' }); }

  // Verificados: son pocos; se filtra en la base por sus subs. Buscar por nombre: subs de vendedores que coinciden.
  let onlySubs: string[] | null = null;
  if (verified === 'true') {
    onlySubs = (await profilesBy((q) => q.eq('verified', true).limit(500))).map((r) => r.sub);
    if (!onlySubs.length) return { items: [], next_cursor: null, verified };
  }
  let nameSubs: string[] = [];
  if (tokens.length) {
    const longest = [...tokens].sort((a, b) => b.length - a.length)[0];
    const rows = await profilesBy((q) => q.ilike('display_name', ilikePattern(longest).replace(/\*/g, '%')).limit(50));
    nameSubs = rows.filter((r) => foldText(r.display_name).includes(longest)).map((r) => r.sub);
  }

  const BATCH = Math.max(limit * 3, 30);
  const items: any[] = [];
  const sellers = new Map<string, Seller>();
  let before = cursor; let next: string | null = null;
  for (let round = 0; round < 4; round++) {
    let q = db().from('orders').select('slug, brand, model, description, price_crc, photos, created_at, seller_user_id')
      .eq('kind', 'listing').eq('status', 'creado').eq('listing_status', 'activa').is('listing_slug', null);
    if (onlySubs) q = q.in('seller_user_id', onlySubs);
    if (tokens.length) {
      const pat = ilikePattern([...tokens].sort((a, b) => b.length - a.length)[0]);
      const ors = [`brand.ilike.${pat}`, `model.ilike.${pat}`, `description.ilike.${pat}`];
      if (nameSubs.length) ors.push(`seller_user_id.in.(${nameSubs.map((s) => `"${s.replace(/"/g, '')}"`).join(',')})`);
      q = q.or(ors.join(','));
    }
    if (before) q = q.lt('created_at', before);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(BATCH);
    if (error) storeDbErr(error);
    const rows: any[] = data ?? [];
    const missing = [...new Set(rows.map((o) => o.seller_user_id).filter((s) => s && !sellers.has(s)))] as string[];
    for (const [k, v] of await sellersFor(missing)) sellers.set(k, v);
    let full = false; let i = -1;
    for (const o of rows) {
      i++;
      const s = sellers.get(o.seller_user_id);
      before = o.created_at;
      if (!s || !s.listed) continue;
      if (verified === 'true' && !s.verified) continue;
      if (verified === 'false' && s.verified) continue;
      if (tokens.length && !matchesTokens(`${titleOf(o)} ${o.description ?? ''} ${s.display_name}`, tokens)) continue;
      items.push({ slug: o.slug, title: titleOf(o), price_crc: Number(o.price_crc), photo: o.photos?.[0] ?? null, created_at: o.created_at, seller: publicSeller(s) });
      if (items.length >= limit) { full = true; break; }
    }
    if (full) { next = i === rows.length - 1 && rows.length < BATCH ? null : encodeCursor(items[items.length - 1].created_at); break; }
    if (rows.length < BATCH) { next = null; break; }
    next = before ? encodeCursor(before) : null; // se revisó un lote completo sin llenar: seguir en la próxima vuelta
  }
  return { items, next_cursor: next, verified };
}

/** Cómo salieron las ventas del vendedor, SIN montos: completadas = liberadas + disputas resueltas. */
export interface SalesOutcome { completed: number; no_issues: number; disputes_resolved: number; disputes_open: number }
export async function salesOutcome(sub: string): Promise<SalesOutcome> {
  const { data, error } = await db().from('orders').select('status').eq('seller_user_id', sub).in('status', ['liberado', 'resuelto', 'en_disputa']).limit(5000);
  if (error) storeDbErr(error);
  const n = (st: string) => (data ?? []).filter((o: any) => o.status === st).length;
  const no_issues = n('liberado'), disputes_resolved = n('resuelto');
  return { completed: no_issues + disputes_resolved, no_issues, disputes_resolved, disputes_open: n('en_disputa') };
}
/** Vendedor de un pedido o link (para la ficha /p/<slug>): perfil corto + cómo salieron sus ventas. Sin datos privados. */
export async function sellerOfOrder(orderSlug: string) {
  const { data: o, error } = await db().from('orders').select('seller_user_id').eq('slug', orderSlug).maybeSingle();
  if (error) storeDbErr(error);
  if (!(o as any)?.seller_user_id) return null;
  const sub = (o as any).seller_user_id as string;
  const [sellers, sales] = await Promise.all([sellersFor([sub]), salesOutcome(sub)]);
  const s = sellers.get(sub);
  return s ? { ...publicSeller(s), sales } : null;
}
/** Reseñas públicas (más nuevas primero). comment y buyer_name: migración 018; sin ella, solo estrellas. Nunca el comprador. */
async function reviewsOf(sub: string): Promise<{ data: any[] }> {
  const q = (cols: string) => db().from('seller_ratings').select(cols).eq('seller_user_id', sub).order('created_at', { ascending: false }).limit(30);
  let { data, error } = await q('stars, created_at, comment, buyer_name');
  if (error && missingColumn(error)) ({ data, error } = await q('stars, created_at'));
  return { data: error ? [] : data ?? [] };
}
/** Perfil público del vendedor: lo de la tienda + reseñas, ventas, miembro desde y WhatsApp (solo si eligió mostrarlo). */
export async function sellerProfile(slug: string) {
  let row: any = null;
  // whatsapp_public (020): el vendedor elige mostrar su WhatsApp en el perfil. Hasta entonces el número solo lo ve el
  // comprador después de pagar (lo que se le prometió al guardarlo en 016), así que sin la columna no se muestra.
  for (const cols of ['sub, store_slug, display_name, avatar_url, verified, verified_at, created_at, contact_phone, whatsapp_public', 'sub, store_slug, display_name, avatar_url, verified, verified_at, created_at', 'sub, store_slug, display_name, verified, created_at']) {
    const { data, error } = await db().from('seller_profiles').select(cols).eq('store_slug', slug).maybeSingle();
    if (error && missingColumn(error)) continue;
    if (error) storeDbErr(error);
    row = data; break;
  }
  if (!row) return null;
  const [{ data: st }, { data: items, error: e2 }, sales, { data: rv }] = await Promise.all([
    db().from('public_stores').select('rating_avg, rating_count').eq('store_slug', slug).maybeSingle(),
    db().from('public_store_items').select('slug, title, price_crc, photo, created_at').eq('store_slug', slug).order('created_at', { ascending: false }).limit(60),
    salesOutcome(row.sub),
    reviewsOf(row.sub),
  ]);
  if (e2) storeDbErr(e2);
  const phone = row.whatsapp_public === true && typeof row.contact_phone === 'string' && row.contact_phone ? row.contact_phone : null;
  return {
    store_slug: row.store_slug, display_name: row.display_name, avatar_url: row.avatar_url ?? null,
    verified: row.verified === true, bio: null as string | null, location: null as string | null,
    rating_avg: st?.rating_avg == null ? null : Number(st.rating_avg), rating_count: Number(st?.rating_count ?? 0),
    sales_completed: sales.completed, sales,
    member_since: row.created_at ?? null,
    whatsapp: phone ? waLink(phone) : null,
    items: (items ?? []).map((i: any) => ({ slug: i.slug, title: i.title || 'Artículo', price_crc: Number(i.price_crc), photo: i.photo ?? null, created_at: i.created_at ?? null })),
    reviews: (rv ?? []).map((r: any) => ({ stars: Number(r.stars), comment: typeof r.comment === 'string' && r.comment ? r.comment : null,
      buyer_name: typeof r.buyer_name === 'string' && r.buyer_name ? r.buyer_name : null, created_at: r.created_at ?? null })),
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const BASE = 'https://pago.meteorito.app';
/** = COPY.identity.ogSuffix (lib/copy.ts; la API no importa de la app). t61 revisa que coincidan. */
export const OG_IDENTITY = 'identidad confirmada';
/** Meta tags OG/Twitter del perfil (para WhatsApp, Facebook, X, iMessage…). */
export function profileMeta(p: Awaited<ReturnType<typeof sellerProfile>> & object): string {
  const url = `${BASE}/t/${p.store_slug}`;
  const stars = p.rating_count > 0 && p.rating_avg != null ? `${(Math.round(p.rating_avg * 10) / 10).toFixed(1)} estrellas (${p.rating_count} reseña${p.rating_count === 1 ? '' : 's'}) · ` : '';
  const n = p.items.length;
  const title = `${p.display_name}${p.verified ? ` (${OG_IDENTITY})` : ''} en Meteorito`;
  const desc = `${stars}${n} producto${n === 1 ? '' : 's'} disponible${n === 1 ? '' : 's'}. Compra sin crear cuenta: tu pago queda en custodia hasta que recibas.`;
  const img = p.avatar_url ?? p.items.find((i: { photo: string | null }) => i.photo)?.photo ?? `${BASE}/icon-512.png`;
  return [
    `<title>${esc(title)}</title>`, `<meta name="description" content="${esc(desc)}" />`, `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="profile" />`, `<meta property="og:site_name" content="Meteorito" />`, `<meta property="og:locale" content="es_CR" />`,
    `<meta property="og:title" content="${esc(title)}" />`, `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`, `<meta property="og:image" content="${esc(img)}" />`,
    `<meta name="twitter:card" content="summary" />`, `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(desc)}" />`, `<meta name="twitter:image" content="${esc(img)}" />`,
  ].join('\n');
}
/** HTML de la app con los meta del perfil. Si no se puede leer el HTML de la app, una página mínima con link. */
export function injectMeta(appHtml: string | null, meta: string, url: string): string {
  if (appHtml && /<title>[^<]*<\/title>/.test(appHtml)) return appHtml.replace(/<title>[^<]*<\/title>/, meta);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />${meta}</head>`
    + `<body><a href="${esc(url)}">Abrir el perfil en Meteorito</a></body></html>`;
}
