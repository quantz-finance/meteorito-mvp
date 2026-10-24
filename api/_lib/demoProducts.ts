// Productos de EJEMPLO del feed de Comprar (y sus tiendas /t/<usuario>). HOY el feed tiene pocos productos reales; para que
// no se vea vacío se muestran estos, TODOS FICTICIOS: vendedores, nombres de usuario, reseñas, textos y fotos inventados
// (no se copió ningún anuncio, nombre ni foto real). Fotos: public/demo-feed/p-*.jpg, generadas, sin marcas ni personas.
// Reglas:
//  - Siempre marcados: demo: true -> iconito (i) discreto con popup en la tarjeta, la tienda y la ficha.
//  - Nunca se pagan: no existen en la base (no hay pedido); la ficha /p/ej-… dice que es un ejemplo y no tiene botón de
//    pago; orderBySlug rechaza estos slugs (409 demo_product) en todo el API de pagos.
//  - No están en la base: se agregan al feed DESPUÉS de los productos reales (los reales siempre primero) en el API
//    (api/store/index.ts, mergeDemo) y nunca en el bloque Patrocinado.
//  - Apagarlos: FEED_DEMO_PRODUCTS = false en api/_lib/demoFlag.ts (o FEED_DEMO_PRODUCTS=0 en el entorno del servidor).
// PURO (sin red ni base): lo usan la API, el modo demo (lib/demoFeed.ts) y la ficha de ejemplo (components/DemoProduct.tsx).
import { DEMO_PRODUCT_PREFIX, demoProductsOn, FEED_DEMO_PRODUCTS, looksLikeDemoProduct } from './demoFlag';
import { FEED_DEFAULT, FEED_MAX, foldText, matchesTokens, searchTokens, type VerifiedFilter } from './feedText';
import { rankFeed } from './feedRank';
export { DEMO_PRODUCT_PREFIX, demoProductsOn, FEED_DEMO_PRODUCTS, looksLikeDemoProduct };

const H = 3600e3;
export interface DemoReview { stars: 1 | 2 | 3 | 4 | 5; comment: string | null; buyer_name: string | null; h: number }
export interface DemoSeller {
  store_slug: string; display_name: string; verified: boolean; rating_avg: number | null; rating_count: number;
  sales: number; since: string; location: string; bio: string; reviews: DemoReview[];
}
export interface DemoProduct {
  slug: string; seller: string; title: string; price_crc: number; photo: string; /** horas desde que se "publicó" */ ago: number;
  condition: string; description: string;
}

const r = (stars: DemoReview['stars'], comment: string | null, buyer_name: string | null, h: number): DemoReview => ({ stars, comment, buyer_name, h });

/** 12 vendedores ficticios: 6 con identidad confirmada y 6 sin confirmar. */
export const DEMO_SELLERS: DemoSeller[] = [
  { store_slug: 'tecno-sabana', display_name: 'Tecno Sabana', verified: true, rating_avg: 4.8, rating_count: 24, sales: 38, since: '2026-04-10T00:00:00Z', location: 'San José',
    bio: 'Celulares y laptops revisados. Entregas en La Sabana y alrededores.', reviews: [r(5, 'El iPhone llegó tal cual lo describió. Muy atento.', 'Andrés V.', 20), r(5, 'Entrega puntual en la Sabana, todo bien.', 'Melissa R.', 140), r(4, null, null, 400)] },
  { store_slug: 'gaby-celulares', display_name: 'Gaby Celulares', verified: true, rating_avg: 4.9, rating_count: 17, sales: 29, since: '2026-05-02T00:00:00Z', location: 'Heredia',
    bio: 'Teléfonos y accesorios. Respondo rápido por el chat.', reviews: [r(5, 'Súper recomendada, me explicó todo antes de pagar.', 'Karla M.', 30), r(5, 'Los audífonos venían como nuevos.', 'José P.', 260)] },
  { store_slug: 'mundo-gamer-cr', display_name: 'Mundo Gamer CR', verified: true, rating_avg: 4.7, rating_count: 21, sales: 33, since: '2026-03-18T00:00:00Z', location: 'Alajuela',
    bio: 'Consolas, controles y juegos. Se prueban al entregar.', reviews: [r(5, 'Probamos la consola juntos antes de liberar el pago.', 'Diego S.', 50), r(4, 'Buen trato, llegó un poco tarde.', 'Fabián C.', 210), r(5, null, 'Luis G.', 520)] },
  { store_slug: 'hogar-escazu', display_name: 'Hogar Escazú', verified: true, rating_avg: 4.6, rating_count: 9, sales: 12, since: '2026-06-21T00:00:00Z', location: 'Escazú',
    bio: 'Muebles y electrodomésticos por mudanza. Entregas en Escazú y Santa Ana.', reviews: [r(5, 'El sofá estaba impecable.', 'Mariana F.', 90), r(4, null, 'Óscar L.', 300)] },
  { store_slug: 'ruedas-cartago', display_name: 'Ruedas Cartago', verified: true, rating_avg: 4.8, rating_count: 11, sales: 15, since: '2026-05-27T00:00:00Z', location: 'Cartago',
    bio: 'Bicis de montaña y de ruta con mantenimiento al día.', reviews: [r(5, 'La bici venía con mantenimiento recién hecho.', 'Esteban Q.', 70), r(5, 'Muy honesto con los detalles.', 'Paula N.', 330)] },
  { store_slug: 'pao-sneakers', display_name: 'Pao Sneakers', verified: true, rating_avg: 4.9, rating_count: 13, sales: 19, since: '2026-07-08T00:00:00Z', location: 'Curridabat',
    bio: 'Tenis en buen estado, con caja cuando la tengo.', reviews: [r(5, 'Talla exacta y en excelente estado.', 'Daniela R.', 40), r(5, null, 'Kevin A.', 190)] },
  { store_slug: 'kevin-mora', display_name: 'Kevin M.', verified: false, rating_avg: 4.3, rating_count: 3, sales: 3, since: '2026-09-01T00:00:00Z', location: 'Desamparados',
    bio: 'Vendo cosas que ya no uso.', reviews: [r(5, 'Todo bien con la compra.', 'Sofía C.', 100), r(4, null, null, 280), r(4, 'Tardó en responder pero cumplió.', 'Marco V.', 600)] },
  { store_slug: 'vane-ventas', display_name: 'Vane Ventas', verified: false, rating_avg: 4.5, rating_count: 4, sales: 5, since: '2026-08-14T00:00:00Z', location: 'Moravia',
    bio: 'Artículos de la casa y tecnología.', reviews: [r(5, 'Muy amable, entregó el mismo día.', 'Gabriela S.', 60), r(4, null, null, 350)] },
  { store_slug: 'luis-electro', display_name: 'Luis Electro', verified: false, rating_avg: null, rating_count: 0, sales: 0, since: '2026-10-12T00:00:00Z', location: 'San Pedro, Montes de Oca',
    bio: 'Electrónica nueva y usada.', reviews: [] },
  { store_slug: 'dani-tibas', display_name: 'Dani Q.', verified: false, rating_avg: 5, rating_count: 2, sales: 2, since: '2026-09-20T00:00:00Z', location: 'Tibás',
    bio: 'Vendo porque me mudo.', reviews: [r(5, 'Todo perfecto.', 'Natalia B.', 120), r(5, null, null, 500)] },
  { store_slug: 'marce-cr', display_name: 'Marce C.', verified: false, rating_avg: 4, rating_count: 1, sales: 1, since: '2026-10-01T00:00:00Z', location: 'Santo Domingo, Heredia',
    bio: 'Fotografía y computadoras.', reviews: [r(4, 'Buen producto, la entrega se movió un día.', 'Ricardo T.', 160)] },
  { store_slug: 'jorge-alajuela', display_name: 'Jorge A.', verified: false, rating_avg: null, rating_count: 0, sales: 0, since: '2026-10-18T00:00:00Z', location: 'Alajuela',
    bio: 'Cosas de la casa en buen estado.', reviews: [] },
];

const p = (slug: string, seller: string, title: string, price_crc: number, photo: string, ago: number, condition: string, description: string): DemoProduct =>
  ({ slug: `${DEMO_PRODUCT_PREFIX}${slug}`, seller, title, price_crc, photo: `/demo-feed/p-${photo}.jpg`, ago, condition, description });

/** 40 productos ficticios con precios de referencia del mercado de segunda mano en Costa Rica. */
export const DEMO_PRODUCTS: DemoProduct[] = [
  p('iphone-13', 'tecno-sabana', 'iPhone 13 128 GB azul medianoche', 240000, 'iphone13', 3, 'Usado, como nuevo', 'Batería al 88 %, sin golpes y la pantalla sin rayas. Liberado para cualquier operador. Incluye caja y cable. Lo puedes revisar antes de pagar.'),
  p('iphone-15', 'tecno-sabana', 'iPhone 15 128 GB rosado', 430000, 'iphone15', 20, 'Como nuevo', 'Cuatro meses de uso, batería al 98 %. Siempre con protector y estuche. Cable USB-C incluido.'),
  p('macbook-air-m1', 'tecno-sabana', 'MacBook Air M1 8 GB / 256 GB', 390000, 'macbookair', 52, 'Usado', 'Teclado en español, 180 ciclos de batería. Ideal para estudiar o trabajar. Con cargador original.'),
  p('iphone-14-pro', 'gaby-celulares', 'iPhone 14 Pro 256 GB morado', 420000, 'iphone14pro', 6, 'Usado', 'Batería al 86 %, Face ID funcionando, nunca abierto ni reparado. Se entrega con un estuche.'),
  p('galaxy-s23', 'gaby-celulares', 'Samsung Galaxy S23 256 GB crema', 330000, 'galaxys23', 30, 'Usado, como nuevo', 'Pantalla impecable, cámara de 50 MP. Liberado. Incluye cargador rápido.'),
  p('airpods-pro-2', 'gaby-celulares', 'AirPods Pro (2.ª generación)', 95000, 'airpodspro', 44, 'Usado', 'Cancelación de ruido perfecta, estuche con carga inalámbrica. Almohadillas de repuesto nuevas.'),
  p('apple-watch-8', 'gaby-celulares', 'Apple Watch Series 8 45 mm', 150000, 'reloj', 96, 'Usado', 'Batería al 90 %, con cargador magnético y correa deportiva negra.'),
  p('ps5-lector', 'mundo-gamer-cr', 'PlayStation 5 con lector de discos y 2 controles', 300000, 'ps5', 2, 'Usado', 'Consola en perfecto estado, con dos controles y todos los cables. La probamos juntos al entregarla.'),
  p('switch-oled', 'mundo-gamer-cr', 'Nintendo Switch OLED con base', 190000, 'switcholed', 26, 'Usado', 'Pantalla OLED sin rayas, controles sin drift. Incluye base, cargador y estuche.'),
  p('control-ps5', 'mundo-gamer-cr', 'Control inalámbrico de PlayStation 5', 38000, 'control', 70, 'Usado', 'Control blanco original, sin drift. Cable de carga incluido.'),
  p('xbox-series-s', 'mundo-gamer-cr', 'Xbox Series S 512 GB', 175000, 'xboxs', 110, 'Usado', 'Consola digital compacta con un control. Cuenta borrada, lista para usar.'),
  p('tv-55-4k', 'hogar-escazu', 'Pantalla Samsung 55" 4K Smart TV', 230000, 'tv55', 12, 'Usado', 'Imagen 4K, aplicaciones de streaming y control remoto original. Se entrega en Escazú.'),
  p('sofa-seccional', 'hogar-escazu', 'Sofá seccional gris de 3 piezas', 280000, 'sofa', 40, 'Usado', 'Tela fácil de limpiar, dos años de uso, sin manchas. Mide 2,60 m x 1,60 m.'),
  p('comedor-4-sillas', 'hogar-escazu', 'Juego de comedor de madera con 4 sillas', 185000, 'comedor', 85, 'Usado', 'Mesa de madera sólida de 1,40 m y sillas tapizadas. Muy buen estado.'),
  p('silla-oficina', 'hogar-escazu', 'Silla de oficina ergonómica con cabecera', 75000, 'silla', 130, 'Usado', 'Malla transpirable, brazos y altura ajustables. Ideal para teletrabajo.'),
  p('bici-montana-29', 'ruedas-cartago', 'Bicicleta de montaña aro 29 doble suspensión', 210000, 'bicimtb', 8, 'Usado', 'Talla M, frenos de disco hidráulicos, 12 velocidades. Mantenimiento recién hecho.'),
  p('bici-ruta-54', 'ruedas-cartago', 'Bicicleta de ruta talla 54', 380000, 'biciruta', 60, 'Usado', 'Cuadro de aluminio, frenos de disco y 22 velocidades. Muy liviana.'),
  p('bici-electrica', 'ruedas-cartago', 'Bicicleta eléctrica plegable aro 20', 450000, 'biciel', 140, 'Usado, como nuevo', 'Autonomía de unos 40 km, batería removible y cargador incluido.'),
  p('tenis-blancos-42', 'pao-sneakers', 'Tenis blancos de cuero talla 42', 38000, 'tenisblancos', 5, 'Como nuevo', 'Usados dos veces, con caja. Talla 42 (US 9).'),
  p('tenis-basket-40', 'pao-sneakers', 'Tenis de básquet tipo botín talla 40', 48000, 'tenisbasket', 36, 'Usado', 'Rojo, blanco y negro. Suela en muy buen estado.'),
  p('tenis-retro-38', 'pao-sneakers', 'Tenis retro con suela de goma talla 38', 32000, 'tenisretro', 100, 'Usado', 'Cuero blanco y gamuza. Cómodos para todos los días.'),
  p('iphone-12', 'kevin-mora', 'iPhone 12 64 GB blanco', 175000, 'iphone12', 9, 'Usado', 'Batería al 82 %, funciona todo. Tiene un rayón pequeño en el marco. Con estuche transparente.'),
  p('ps5-digital', 'kevin-mora', 'PlayStation 5 Digital con 1 control', 255000, 'ps5digital', 33, 'Usado', 'Versión digital, sin lector de discos. Poco uso: la vendo porque casi no juego.'),
  p('galaxy-s21-fe', 'kevin-mora', 'Samsung Galaxy S21 FE 128 GB lila', 160000, 'galaxys21fe', 75, 'Usado', 'Buen estado general, batería dura todo el día. Liberado.'),
  p('scooter-electrico', 'kevin-mora', 'Scooter eléctrico plegable 350 W', 260000, 'scooter', 150, 'Usado', 'Llantas de 10 pulgadas, hasta 25 km/h. Con cargador.'),
  p('iphone-11', 'vane-ventas', 'iPhone 11 128 GB verde', 140000, 'iphone11', 14, 'Usado', 'Batería al 79 %, pantalla original. Algunos detalles en el marco (se ven en la foto).'),
  p('switch-lite', 'vane-ventas', 'Nintendo Switch Lite turquesa con estuche', 110000, 'switchlite', 48, 'Usado', 'Con estuche y tres juegos físicos. Batería en buen estado.'),
  p('ipad-9', 'vane-ventas', 'iPad 9.ª generación 64 GB', 150000, 'tablet', 90, 'Usado', 'Pantalla sin rayas, con funda que sirve de base. Ideal para clases.'),
  p('escritorio-madera', 'vane-ventas', 'Escritorio de madera con 3 gavetas', 65000, 'escritorio', 190, 'Usado', 'Madera de pino, 1,20 m de ancho. Se entrega en Moravia.'),
  p('galaxy-a54', 'luis-electro', 'Samsung Galaxy A54 128 GB verde', 150000, 'galaxya54', 4, 'Nuevo (caja abierta)', 'Sin uso, con estuche negro de regalo.'),
  p('redmi-note-13', 'luis-electro', 'Xiaomi Redmi Note 13 256 GB', 105000, 'redminote13', 22, 'Nuevo (caja abierta)', 'Con caja y cargador. Liberado para cualquier operador.'),
  p('laptop-ryzen-5', 'luis-electro', 'Laptop Lenovo IdeaPad 15" Ryzen 5, 16 GB, 512 GB SSD', 265000, 'laptop15', 66, 'Usado', 'Rápida para estudiar y trabajar. Batería de unas 5 horas. Con cargador.'),
  p('parlante-bluetooth', 'luis-electro', 'Parlante bluetooth portátil resistente al agua', 35000, 'parlante', 120, 'Usado', 'Suena muy bien, batería de 12 horas.'),
  p('iphone-se-2022', 'dani-tibas', 'iPhone SE (2022) 64 GB rojo', 120000, 'iphonese', 16, 'Usado', 'Compacto, batería al 85 %. Con cargador.'),
  p('airpods-3', 'dani-tibas', 'AirPods (3.ª generación)', 70000, 'airpods3', 58, 'Usado', 'Funcionan perfecto, con estuche y cable.'),
  p('tv-43-tcl', 'dani-tibas', 'Smart TV TCL 43" Full HD', 140000, 'tv43', 100, 'Usado', 'Con control remoto y patas. Me mudo y no me cabe.'),
  p('laptop-hp-14', 'marce-cr', 'Laptop HP 14" Core i5, 8 GB, 256 GB SSD', 220000, 'laptop14', 18, 'Usado', 'Windows 11, teclado en español. Con cargador.'),
  p('camara-reflex', 'marce-cr', 'Cámara réflex Canon EOS Rebel T7 con lente 18-55', 260000, 'camara', 80, 'Usado', 'Pocos disparos, con correa y batería extra.'),
  p('audifonos-inalambricos', 'jorge-alajuela', 'Audífonos inalámbricos de diadema con estuche', 45000, 'audifonos', 11, 'Usado', 'Cancelación de ruido, batería de 30 horas.'),
  p('microondas', 'jorge-alajuela', 'Microondas de acero inoxidable 20 L', 40000, 'microondas', 170, 'Usado', 'Funciona perfecto, perillas mecánicas. Me cambio a uno más grande.'),
];

const SELLER = new Map(DEMO_SELLERS.map((s) => [s.store_slug, s]));
const PRODUCT = new Map(DEMO_PRODUCTS.map((x) => [x.slug, x]));
export const isDemoProductSlug = (slug: unknown): boolean => looksLikeDemoProduct(slug) && PRODUCT.has(String(slug));
export const isDemoStoreSlug = (slug: unknown): boolean => SELLER.has(foldText(slug));
export const demoSellerOf = (slug: string) => SELLER.get(foldText(slug)) ?? null;

const outcome = (n: number) => { const d = n > 10 ? 1 : 0; return { completed: n, no_issues: n - d, disputes_resolved: d, disputes_open: 0 }; };
/** Lo mismo que publicSeller (api/_lib/feed.ts) + demo: true. */
export const demoPublicSeller = (s: DemoSeller) => ({ store_slug: s.store_slug, display_name: s.display_name, avatar_url: null as string | null, verified: s.verified, rating_avg: s.rating_avg, rating_count: s.rating_count, demo: true as const });
export type DemoCard = { slug: string; title: string; price_crc: number; photo: string | null; created_at: string; demo: true; seller: ReturnType<typeof demoPublicSeller> };
const card = (x: DemoProduct, asOf: number): DemoCard => ({ slug: x.slug, title: x.title, price_crc: x.price_crc, photo: x.photo, created_at: new Date(asOf - x.ago * H).toISOString(), demo: true, seller: demoPublicSeller(SELLER.get(x.seller)!) });

/** Productos de ejemplo que cumplen filtro y búsqueda, ordenados con el MISMO algoritmo del feed (sin "seguidos"). */
export function demoList(o: { q?: unknown; verified: VerifiedFilter; asOf: number }): DemoCard[] {
  const tokens = searchTokens(o.q);
  const list = DEMO_PRODUCTS.filter((x) => {
    const s = SELLER.get(x.seller)!;
    if (o.verified === 'true' && !s.verified) return false;
    if (o.verified === 'false' && s.verified) return false;
    return !tokens.length || matchesTokens(`${x.title} ${x.description} ${s.display_name}`, tokens);
  });
  const ranked = rankFeed(list.map((x) => {
    const s = SELLER.get(x.seller)!;
    return { slug: x.slug, created_at: new Date(o.asOf - x.ago * H).toISOString(), seller_key: s.store_slug, photos: 1, title: x.title, description: x.description, x,
      seller: { verified: s.verified, rating_avg: s.rating_avg, rating_count: s.rating_count, sales_completed: s.sales, followed: false, last_seen_at: null } };
  }), o.asOf);
  return ranked.map((it) => card(it.x, o.asOf));
}

/** Cursor de las páginas de ejemplo (después de los reales): e<posición>_<ms>. No choca con r…_… ni con fechas ISO. */
export const encodeDemoCursor = (offset: number, asOf: number) => `e${offset}_${asOf}`;
export function decodeDemoCursor(c: unknown): { offset: number; asOf: number } | null {
  const m = /^e(\d{1,4})_(\d{13})$/.exec(String(c ?? ''));
  return m ? { offset: Number(m[1]), asOf: Number(m[2]) } : null;
}
export const feedLimit = (l: unknown) => Math.min(FEED_MAX, Math.max(1, Number.parseInt(String(l ?? FEED_DEFAULT), 10) || FEED_DEFAULT));

/** Página SOLO de ejemplos (el cursor ya pasó todos los reales). */
export function demoPage(o: { q?: unknown; verified: VerifiedFilter; cursor: { offset: number; asOf: number }; limit: unknown }) {
  const all = demoList({ q: o.q, verified: o.verified, asOf: o.cursor.asOf });
  const n = feedLimit(o.limit);
  const items = all.slice(o.cursor.offset, o.cursor.offset + n);
  const end = o.cursor.offset + items.length;
  return { items, next_cursor: end < all.length ? encodeDemoCursor(end, o.cursor.asOf) : null };
}
/**
 * Agrega los ejemplos DESPUÉS de los productos reales: solo cuando los reales se terminaron (next_cursor null), primero
 * rellena la página y después sigue con el cursor e…_…. Los reales nunca se mueven ni se mezclan con ejemplos antes.
 */
export function mergeDemo<P extends { items: any[]; next_cursor: string | null }>(page: P, o: { q?: unknown; verified: VerifiedFilter; limit: unknown; now?: number }): P {
  if (page.next_cursor) return page;
  const asOf = o.now ?? Date.now();
  const all = demoList({ q: o.q, verified: o.verified, asOf });
  if (!all.length) return page;
  const room = Math.max(0, feedLimit(o.limit) - page.items.length);
  const seen = new Set(page.items.map((i: any) => i.slug));
  const fill = all.filter((i) => !seen.has(i.slug)).slice(0, room);
  return { ...page, items: [...page.items, ...fill], next_cursor: fill.length < all.length ? encodeDemoCursor(fill.length, asOf) : null };
}

/** Perfil público de una tienda de ejemplo (misma forma que sellerProfile + demo: true). null si no es de ejemplo. */
export function demoProfile(slug: string, now = Date.now()) {
  const s = demoSellerOf(slug);
  if (!s) return null;
  return {
    ...demoPublicSeller(s), bio: s.bio, location: s.location, sales_completed: s.sales, sales: outcome(s.sales),
    followers: Math.round(s.sales * 2.5) + s.rating_count, member_since: s.since, whatsapp: null as string | null,
    items: DEMO_PRODUCTS.filter((x) => x.seller === s.store_slug).map((x) => ({ slug: x.slug, title: x.title, price_crc: x.price_crc, photo: x.photo, created_at: new Date(now - x.ago * H).toISOString(), demo: true as const })),
    reviews: s.reviews.map((rv) => ({ stars: rv.stars, comment: rv.comment, buyer_name: rv.buyer_name, created_at: new Date(now - rv.h * H).toISOString() })),
  };
}
/** Ficha de un producto de ejemplo (para /p/ej-…). Sin pago: la app no muestra ningún botón para pagar. */
export function demoProduct(slug: string, now = Date.now()) {
  const x = PRODUCT.get(slug);
  if (!x) return null;
  const s = SELLER.get(x.seller)!;
  return { ...x, created_at: new Date(now - x.ago * H).toISOString(), location: s.location, demo: true as const, payable: false as const, seller: { ...demoPublicSeller(s), sales: outcome(s.sales) } };
}
