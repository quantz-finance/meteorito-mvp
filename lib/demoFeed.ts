// Modo demo: feed de Comprar y perfiles públicos simulados (misma forma que GET /api/store?feed / ?profile). Sin red.
// Las fotos de ejemplo (/demo-feed/*.jpg) son opcionales: si no están en el build, la tarjeta muestra el ícono de producto.
// ?feed=empty en la URL simula un feed vacío (para ver el estado vacío).
import { foldText, matchesTokens, searchTokens, type VerifiedFilter } from '../api/_lib/feedText';
import { demoGetStore, demoStoreSlug } from './demo';
import { decodeRankCursor, encodeRankCursor, rankFeed } from '../api/_lib/feedRank';
import { followedSlugs } from './follows';
import type { FeedItem, FeedPage, SellerProfile } from './store';

const H = 3600e3;
const outcome = (n: number) => { const d = n > 10 ? 1 : 0; return { completed: n, no_issues: n - d, disputes_resolved: d, disputes_open: 0 }; };
interface DemoSeller { store_slug: string; display_name: string; verified: boolean; rating_avg: number | null; rating_count: number; avatar_url: string | null; sales: number; since: string; wa: string | null }
const SELLERS: DemoSeller[] = [
  { store_slug: 'jose-games', display_name: 'José Games', verified: true, rating_avg: 4.9, rating_count: 31, avatar_url: null, sales: 48, since: '2026-05-12T00:00:00Z', wa: 'https://wa.me/50670001234' },
  { store_slug: 'ana-solis', display_name: 'Ana Solís', verified: false, rating_avg: null, rating_count: 0, avatar_url: null, sales: 0, since: '2026-10-02T00:00:00Z', wa: null },
  { store_slug: 'carlos-bikes', display_name: 'Carlos Bikes', verified: false, rating_avg: 4.5, rating_count: 4, avatar_url: null, sales: 6, since: '2026-08-20T00:00:00Z', wa: 'https://wa.me/50660004321' },
];
const ITEMS: { slug: string; seller: string; title: string; price_crc: number; photo: string | null; ago: number }[] = [
  { slug: 'dmf001', seller: 'jose-games', title: 'PlayStation 3 con control', price_crc: 95000, photo: '/demo-feed/playstation.jpg', ago: 2 },
  { slug: 'dmf002', seller: 'valeria', title: 'Cámara Canon EOS 400D', price_crc: 120000, photo: '/demo-feed/camera.jpg', ago: 5 },
  { slug: 'dmf003', seller: 'carlos-bikes', title: 'Bicicleta de montaña aro 29', price_crc: 185000, photo: '/demo-feed/bicycle.jpg', ago: 26 },
  { slug: 'dmf004', seller: 'ana-solis', title: 'iPhone 13 Pro 128 GB', price_crc: 340000, photo: '/demo-feed/iphone.jpg', ago: 50 },
  { slug: 'dmf005', seller: 'jose-games', title: 'Nintendo Switch con base', price_crc: 165000, photo: '/demo-feed/switch.jpg', ago: 74 },
  { slug: 'dmf006', seller: 'ana-solis', title: 'Tenis Vans talla 42', price_crc: 28000, photo: '/demo-feed/sneakers.jpg', ago: 140 },
  { slug: 'dmf007', seller: 'jose-games', title: 'Control de PlayStation 4', price_crc: 22000, photo: null, ago: 200 },
  { slug: 'dmf008', seller: 'carlos-bikes', title: 'Casco de ciclismo talla M', price_crc: 18000, photo: null, ago: 300 },
];
const REVIEWS = [
  { stars: 5, comment: 'Todo perfecto, llegó igual que en las fotos. Muy recomendada.', buyer_name: 'María R.', h: 30 },
  { stars: 5, comment: 'Respondió rapidísimo y entregó el mismo día.', buyer_name: 'Diego A.', h: 120 },
  { stars: 4, comment: null, buyer_name: null, h: 400 },
];

const DEMO_ADS = ['dmf003', 'dmf005', 'dmf004'];
const ads = () => { try { return new URLSearchParams(window.location.search).get('ads') === '1'; } catch { return false; } };
const empty = () => { try { return new URLSearchParams(window.location.search).get('feed') === 'empty'; } catch { return false; } };
const valeria = (): DemoSeller => {
  const s = demoGetStore(demoStoreSlug());
  return { store_slug: s?.store_slug ?? 'valeria', display_name: s?.display_name ?? 'Valeria', verified: true,
    // con calificaciones reales del demo, esas; si no, una muestra para que el perfil no se vea vacío
    rating_avg: s?.rating_count ? s.rating_avg : 4.7, rating_count: s?.rating_count || 3, avatar_url: s?.avatar_url ?? null, sales: 23, since: '2026-06-03T00:00:00Z', wa: 'https://wa.me/50688881234' };
};
const sellerOf = (slug: string) => (slug === 'valeria' ? valeria() : SELLERS.find((s) => s.store_slug === slug)!);
const pub = (s: DemoSeller) => ({ store_slug: s.store_slug, display_name: s.display_name, avatar_url: s.avatar_url, verified: s.verified, rating_avg: s.rating_avg, rating_count: s.rating_count });

function all(): FeedItem[] {
  if (empty()) return [];
  const now = Date.now();
  return ITEMS.map((i) => ({ slug: i.slug, title: i.title, price_crc: i.price_crc, photo: i.photo, created_at: new Date(now - i.ago * H).toISOString(), seller: pub(sellerOf(i.seller)) }));
}
export async function demoFeed(o: { q?: string; cursor?: string | null; verified: VerifiedFilter; limit?: number }): Promise<FeedPage> {
  await new Promise((r) => setTimeout(r, 350)); // se ven los skeletons
  const tokens = searchTokens(o.q);
  const list = all().filter((i) => (o.verified === 'all' || String(i.seller.verified) === o.verified)
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
  const s = slug === valeria().store_slug ? valeria() : SELLERS.find((x) => x.store_slug === foldText(slug));
  if (!s) return null;
  const now = Date.now();
  const own = s.store_slug === valeria().store_slug ? (demoGetStore(s.store_slug)?.items ?? []).map((i) => ({ ...i, created_at: null })) : [];
  const items = [...own, ...all().filter((i) => i.seller.store_slug === s.store_slug || (s.store_slug === valeria().store_slug && i.seller.store_slug === 'valeria'))
    .map((i) => ({ slug: i.slug, title: i.title, price_crc: i.price_crc, photo: i.photo, created_at: i.created_at }))];
  return {
    ...pub(s), bio: null, location: null, sales_completed: s.sales, sales: outcome(s.sales), followers: Math.round(s.sales * 2.5) + s.rating_count, member_since: s.since, whatsapp: s.wa, items,
    reviews: s.rating_count && !empty() ? REVIEWS.slice(0, Math.min(3, s.rating_count)).map((r) => ({ stars: r.stars, comment: r.comment, buyer_name: r.buyer_name, created_at: new Date(now - r.h * H).toISOString() })) : [],
  };
}

/** Ficha del demo: los pedidos son de la tienda del demo. */
export async function demoOrderSeller() { const v = valeria(); return { ...pub(v), sales: outcome(v.sales) }; }
