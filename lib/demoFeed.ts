// Modo demo: feed de Comprar y perfiles públicos simulados (misma forma que GET /api/store?feed / ?profile). Sin red.
// Fotos: public/demo-feed/p-*.jpg (las mismas de los productos de ejemplo, generadas, sin marcas ni personas).
// ?feed=empty en la URL simula un feed vacío (para ver el estado vacío).
// ?ejemplos=1 agrega los productos de EJEMPLO del feed de producción (api/_lib/demoProducts.ts) igual que el API:
// después de estos, con un iconito (i) discreto, y sus tiendas /t/<usuario> (para probar y fotografiar esa vista sin backend).
import type { Activity } from './activity';
import { foldText, matchesTokens, searchTokens, type VerifiedFilter } from '../api/_lib/feedText';
import { demoGetStore, demoStoreSlug } from './demo';
import { decodeRankCursor, encodeRankCursor, rankFeed } from '../api/_lib/feedRank';
import { demoProductsOn } from '../api/_lib/demoFlag';
// Los datos de ejemplo se cargan en diferido (mismo chunk que usa la ficha /p/ej-…; un import estático aquí los duplicaba).
const ej = () => import('../api/_lib/demoProducts');
import { followedSlugs } from './follows';
import type { FeedItem, FeedPage, SellerProfile } from './store';

const H = 3600e3;
const outcome = (n: number) => { const d = n > 10 ? 1 : 0; return { completed: n, no_issues: n - d, disputes_resolved: d, disputes_open: 0 }; };
interface DemoSeller { store_slug: string; display_name: string; verified: boolean; rating_avg: number | null; rating_count: number; avatar_url: string | null; sales: number; since: string; wa: string | null; seen?: Activity | null }
const SELLERS: DemoSeller[] = [
  { store_slug: 'jose-games', display_name: 'José Games', verified: true, rating_avg: 4.9, rating_count: 31, avatar_url: null, sales: 48, since: '2026-05-12T00:00:00Z', wa: 'https://wa.me/50670001234', seen: { k: 'min', n: 15 } },
  { store_slug: 'ana-solis', display_name: 'Ana Solís', verified: false, rating_avg: null, rating_count: 0, avatar_url: null, sales: 0, since: '2026-10-02T00:00:00Z', wa: null, seen: { k: 'days', n: 4 } },
  { store_slug: 'carlos-bikes', display_name: 'Carlos Bikes', verified: false, rating_avg: 4.5, rating_count: 4, avatar_url: null, sales: 6, since: '2026-08-20T00:00:00Z', wa: 'https://wa.me/50660004321', seen: { k: 'h', n: 3 } },
];
const ITEMS: { slug: string; seller: string; title: string; price_crc: number; photo: string | null; ago: number }[] = [
  { slug: 'dmf001', seller: 'jose-games', title: 'PlayStation 5 Digital con control', price_crc: 255000, photo: '/demo-feed/p-ps5digital.jpg', ago: 2 },
  { slug: 'dmf002', seller: 'valeria', title: 'Cámara réflex con lente 18-55', price_crc: 220000, photo: '/demo-feed/p-camara.jpg', ago: 5 },
  { slug: 'dmf003', seller: 'carlos-bikes', title: 'Bicicleta de montaña aro 29', price_crc: 185000, photo: '/demo-feed/p-bicimtb.jpg', ago: 26 },
  { slug: 'dmf004', seller: 'ana-solis', title: 'iPhone 13 Pro 128 GB', price_crc: 300000, photo: '/demo-feed/p-iphone14pro.jpg', ago: 50 },
  { slug: 'dmf005', seller: 'jose-games', title: 'Nintendo Switch con base', price_crc: 165000, photo: '/demo-feed/p-switcholed.jpg', ago: 74 },
  { slug: 'dmf006', seller: 'ana-solis', title: 'Tenis blancos talla 42', price_crc: 28000, photo: '/demo-feed/p-tenisblancos.jpg', ago: 140 },
  { slug: 'dmf007', seller: 'jose-games', title: 'Control de PlayStation 5', price_crc: 35000, photo: '/demo-feed/p-control.jpg', ago: 200 },
  { slug: 'dmf008', seller: 'carlos-bikes', title: 'Scooter eléctrico plegable', price_crc: 240000, photo: '/demo-feed/p-scooter.jpg', ago: 300 },
];
const REVIEWS = [
  { stars: 5, comment: 'Todo perfecto, llegó igual que en las fotos. Muy recomendada.', buyer_name: 'María R.', h: 30 },
  { stars: 5, comment: 'Respondió rapidísimo y entregó el mismo día.', buyer_name: 'Diego A.', h: 120 },
  { stars: 4, comment: null, buyer_name: null, h: 400 },
];

const DEMO_ADS = ['dmf003', 'dmf005', 'dmf004'];
const ads = () => { try { return new URLSearchParams(window.location.search).get('ads') === '1'; } catch { return false; } };
const empty = () => { try { return new URLSearchParams(window.location.search).get('feed') === 'empty'; } catch { return false; } };
const EJ_KEY = 'meteorito:demo-ejemplos';
/** ?ejemplos=1 queda activo en la pestaña (sessionStorage) aunque la navegación cambie la URL. */
const ejemplos = () => {
  try {
    if (!demoProductsOn()) return false;
    if (new URLSearchParams(window.location.search).get('ejemplos') === '1') window.sessionStorage.setItem(EJ_KEY, '1');
    return window.sessionStorage.getItem(EJ_KEY) === '1';
  } catch { return false; }
};
const valeria = (): DemoSeller => {
  const s = demoGetStore(demoStoreSlug(), true); // con show_last_seen (solo lo usamos para el nombre, foto, puntuación y la última conexión)
  return { store_slug: s?.store_slug ?? 'valeria', display_name: s?.display_name ?? 'Valeria', verified: true,
    // con calificaciones reales del demo, esas; si no, una muestra para que el perfil no se vea vacío
    rating_avg: s?.rating_count ? s.rating_avg : 4.7, rating_count: s?.rating_count || 3, avatar_url: s?.avatar_url ?? null, sales: 23, since: '2026-06-03T00:00:00Z', wa: 'https://wa.me/50688881234',
    seen: s?.show_last_seen === true ? { k: 'online' } : null }; // el vendedor del demo es quien usa la app; solo si la encendió
};
const sellerOf = (slug: string) => (slug === 'valeria' ? valeria() : SELLERS.find((s) => s.store_slug === slug)!);
const pub = (s: DemoSeller) => ({ store_slug: s.store_slug, display_name: s.display_name, avatar_url: s.avatar_url, verified: s.verified, rating_avg: s.rating_avg, rating_count: s.rating_count });
/** Igual que GET /api/store?activity=: solo los vendedores que la encendieron (los de ejemplo, sí; Valeria, si consintió). */
export async function demoActivity(slugs: string[]): Promise<Record<string, Activity>> {
  const out: Record<string, Activity> = {};
  for (const slug of slugs) { const s = slug === demoStoreSlug() ? valeria() : SELLERS.find((x) => x.store_slug === slug); if (s?.seen) out[slug] = s.seen; }
  return out;
}

function all(): FeedItem[] {
  if (empty()) return [];
  const now = Date.now();
  return ITEMS.map((i) => ({ slug: i.slug, title: i.title, price_crc: i.price_crc, photo: i.photo, created_at: new Date(now - i.ago * H).toISOString(), seller: pub(sellerOf(i.seller)) }));
}
export async function demoFeed(o: { q?: string; cursor?: string | null; verified: VerifiedFilter; limit?: number; view?: 'for_you' | 'following' }): Promise<FeedPage> {
  await new Promise((r) => setTimeout(r, 350)); // se ven los skeletons
  if (o.view === 'following') { // Siguiendo: solo las tiendas que sigues en este dispositivo; sin ejemplos ni Patrocinado
    const mine = new Set(followedSlugs());
    const p = await basePage(o, (i) => mine.has(i.seller.store_slug));
    return { ...p, sponsored: [] };
  }
  if (!ejemplos()) return basePage(o);
  const { decodeDemoCursor, demoPage, mergeDemo } = await ej();
  const dc = decodeDemoCursor(o.cursor);
  return dc ? { ...demoPage({ q: o.q, verified: o.verified, cursor: dc, limit: o.limit }), sponsored: [] } : mergeDemo(await basePage(o), { q: o.q, verified: o.verified, limit: o.limit });
}
async function basePage(o: { q?: string; cursor?: string | null; verified: VerifiedFilter; limit?: number }, only: (i: FeedItem) => boolean = () => true): Promise<FeedPage> {
  const tokens = searchTokens(o.q);
  const list = all().filter((i) => only(i) && (o.verified === 'all' || String(i.seller.verified) === o.verified)
    && (!tokens.length || matchesTokens(`${i.title} ${i.seller.display_name}`, tokens)));
  // El mismo algoritmo que la API (api/_lib/feedRank.ts), con los vendedores que sigues en este dispositivo.
  const cur = decodeRankCursor(o.cursor);
  const now = cur?.asOf ?? Date.now();
  const followed = new Set(followedSlugs());
  const ranked = rankFeed(list.map((i) => ({ ...i, seller_key: i.seller.store_slug, photos: i.photo ? 1 : 0, description: null,
    seller: { ...i.seller, sales_completed: sellerOf(i.seller.store_slug).sales, followed: followed.has(i.seller.store_slug), last_seen_at: null } })), now);
  const start = cur?.offset ?? 0;
  const page = ranked.slice(start, start + (o.limit ?? 10)).map((r) => list.find((i) => i.slug === r.slug)!);
  const end = start + page.length;
  // Bloque Patrocinado del demo: SOLO con ?ads=1 en la URL (el demo normal, como producción sin patrocinios, no lo muestra).
  const sponsored = !cur && ads() ? list.filter((i) => DEMO_ADS.includes(i.slug)).map((i, k) => ({ id: k + 1, slug: i.slug, title: i.title, price_crc: i.price_crc, photo: i.photo, seller: i.seller })) : [];
  return { items: page, next_cursor: end < ranked.length ? encodeRankCursor(end, now) : null, sponsored };
}
export async function demoProfile(slug: string): Promise<SellerProfile | null> {
  if (demoProductsOn()) { // tienda de ejemplo (productos de ejemplo del feed)
    const m = await ej();
    if (m.isDemoStoreSlug(slug)) return m.demoProfile(slug);
  }
  const s = slug === valeria().store_slug ? valeria() : SELLERS.find((x) => x.store_slug === foldText(slug));
  if (!s) return null;
  const now = Date.now();
  const own = s.store_slug === valeria().store_slug ? (demoGetStore(s.store_slug)?.items ?? []).map((i) => ({ ...i, created_at: null })) : [];
  const items = [...own, ...all().filter((i) => i.seller.store_slug === s.store_slug || (s.store_slug === valeria().store_slug && i.seller.store_slug === 'valeria'))
    .map((i) => ({ slug: i.slug, title: i.title, price_crc: i.price_crc, photo: i.photo, created_at: i.created_at }))];
  return {
    ...pub(s), bio: null, location: null, sales_completed: s.sales, sales: outcome(s.sales), followers: Math.round(s.sales * 2.5) + s.rating_count, member_since: s.since, whatsapp: s.wa, socials: s.store_slug === valeria().store_slug ? (demoGetStore(s.store_slug, true) as { socials?: SellerProfile['socials'] } | null)?.socials ?? {} : {}, items,
    reviews: s.rating_count && !empty() ? REVIEWS.slice(0, Math.min(3, s.rating_count)).map((r) => ({ stars: r.stars, comment: r.comment, buyer_name: r.buyer_name, created_at: new Date(now - r.h * H).toISOString() })) : [],
  };
}

/** Ficha del demo: los pedidos son de la tienda del demo. */
export async function demoOrderSeller() { const v = valeria(); return { ...pub(v), sales: outcome(v.sales) }; }
