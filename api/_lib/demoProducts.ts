// Productos de EJEMPLO del feed de Comprar (y sus tiendas /t/<usuario>). Para que la beta se vea como una app con vida,
// se muestran estos, TODOS FICTICIOS: vendedores, nombres de usuario, reseñas, textos, fotos de perfil y de producto
// (no se copió ningún anuncio, nombre ni foto real; las caras son generadas por IA y no son de personas reales).
// Fotos: public/demo-feed/ (ver su README: origen y licencia de cada una).
// Reglas:
//  - Siempre marcados: demo: true -> iconito (i) discreto con popup en la tarjeta, la tienda y la ficha.
//  - Nunca se pagan: no existen en la base (no hay pedido); la ficha /p/ej-… dice que es un ejemplo y no tiene botón de
//    pago; orderBySlug rechaza estos slugs (409 demo_product) en todo el API de pagos.
//  - No están en la base: se agregan al feed DESPUÉS de los productos reales (los reales siempre primero) en el API
//    (api/store/index.ts, mergeDemo) y nunca en el bloque Patrocinado.
//  - Redes de las tiendas: SOLO cuentas de Meteorito (nunca de una persona real).
//  - Última conexión: relativa a "ahora" (seenMin minutos antes de cada pedido), así nunca se ve vieja.
//  - Verlos: cada persona elige el "Modo de la app" "Datos de ejemplo" en Mi cuenta (lib/demoPref.ts; la app manda
//    ?ejemplos=1). Default "Testnet": no se ven. Freno de emergencia: FEED_DEMO_PRODUCTS=0 en el entorno del servidor.
//    Borrarlos del todo: este archivo, los usos de demoFlag/demoProducts y public/demo-feed/ (ver su README).
// PURO (sin red ni base): lo usan la API, el modo demo (lib/demoFeed.ts) y la ficha de ejemplo (components/DemoProduct.tsx).
import { DEMO_PRODUCT_PREFIX, looksLikeDemoProduct } from './demoFlag';
import { FEED_DEFAULT, FEED_MAX, foldText, matchesTokens, searchTokens, type VerifiedFilter } from './feedText';
import { rankFeed } from './feedRank';
export { DEMO_PRODUCT_PREFIX, looksLikeDemoProduct };

const H = 3600e3;
export interface DemoReview { stars: 1 | 2 | 3 | 4 | 5; comment: string | null; buyer_name: string | null; h: number }
export interface DemoSeller {
  store_slug: string; display_name: string; verified: boolean; rating_avg: number | null; rating_count: number;
  sales: number; since: string; location: string; bio: string; reviews: DemoReview[];
  /** foto de perfil (generada, persona ficticia) en /public/demo-feed */ avatar: string; followers: number;
  /** minutos desde la "última conexión" (relativo a cada pedido) */ seenMin: number;
  /** cómo entrega (se muestra en cada ficha si el producto no trae la suya) */ delivery: string;
}
export interface DemoProduct {
  slug: string; seller: string; title: string; price_crc: number; photo: string; /** 1-3 fotos; la primera = photo */ photos: string[];
  /** horas desde que se "publicó" */ ago: number; condition: string; description: string; delivery: string | null;
}

const r = (stars: DemoReview['stars'], comment: string | null, buyer_name: string | null, h: number): DemoReview => ({ stars, comment, buyer_name, h });
const av = (slug: string) => `/demo-feed/a-${slug}.webp`;
type S = Omit<DemoSeller, 'avatar'>;
const s = (x: S): DemoSeller => ({ ...x, avatar: av(x.store_slug) });

/** 16 tiendas ficticias en distintas categorías: 7 con identidad confirmada y 9 sin confirmar. */
export const DEMO_SELLERS: DemoSeller[] = [
  s({ store_slug: 'tecno-sabana', display_name: 'Tecno Sabana', verified: true, rating_avg: 4.8, rating_count: 46, sales: 71, since: '2026-04-10T00:00:00Z', location: 'La Sabana, San José', followers: 412, seenMin: 2,
    bio: 'Celulares, laptops y monitores revisados. Entregas en La Sabana y alrededores.', delivery: 'Entrega en persona en La Sabana o envío por Correos de Costa Rica. Plazo: 1 a 3 días hábiles.',
    reviews: [r(5, 'El iPhone llegó tal cual lo describió. Muy atento.', 'Andrés V.', 20), r(5, 'Entrega puntual en la Sabana, todo bien.', 'Melissa R.', 140), r(5, 'El monitor venía impecable y con todos los cables.', 'Jonathan P.', 260), r(4, null, null, 400), r(5, 'Me respondió todas las dudas antes de pagar.', 'Raquel M.', 700)] }),
  s({ store_slug: 'gaby-celulares', display_name: 'Gaby Celulares', verified: true, rating_avg: 4.9, rating_count: 38, sales: 55, since: '2026-05-02T00:00:00Z', location: 'Heredia', followers: 286, seenMin: 9,
    bio: 'Teléfonos y accesorios. Respondo rápido por el chat.', delivery: 'Entrega en Heredia centro o envío por mensajería a todo el país. Plazo: 1 a 2 días hábiles.',
    reviews: [r(5, 'Súper recomendada, me explicó todo antes de pagar.', 'Karla M.', 30), r(5, 'Los audífonos venían como nuevos.', 'José P.', 260), r(5, 'El Galaxy estaba igual que en las fotos.', 'Allan R.', 410), r(4, 'Buen trato, el envío tardó un día más.', 'Silvia H.', 650)] }),
  s({ store_slug: 'mundo-gamer-cr', display_name: 'Mundo Gamer CR', verified: true, rating_avg: 4.7, rating_count: 52, sales: 80, since: '2026-03-18T00:00:00Z', location: 'Alajuela', followers: 534, seenMin: 1,
    bio: 'Consolas, controles, juegos y accesorios. Se prueban al entregar.', delivery: 'Entrega en Alajuela centro o en el Aeropuerto; también envío por Correos. Plazo: 1 a 3 días hábiles.',
    reviews: [r(5, 'Probamos la consola juntos antes de liberar el pago.', 'Diego S.', 50), r(4, 'Buen trato, llegó un poco tarde.', 'Fabián C.', 210), r(5, null, 'Luis G.', 520), r(5, 'Los audífonos suenan increíble.', 'Mauricio J.', 800)] }),
  s({ store_slug: 'hogar-escazu', display_name: 'Hogar Escazú', verified: true, rating_avg: 4.6, rating_count: 19, sales: 26, since: '2026-06-21T00:00:00Z', location: 'Escazú', followers: 158, seenMin: 95,
    bio: 'Muebles y electrodomésticos por mudanza. Entregas en Escazú y Santa Ana.', delivery: 'Entrega en Escazú y Santa Ana; flete a otras zonas por cuenta de quien compra. Plazo: 2 a 4 días.',
    reviews: [r(5, 'El sofá estaba impecable.', 'Mariana F.', 90), r(4, null, 'Óscar L.', 300), r(5, 'La mesa de centro es muy sólida, tal cual las fotos.', 'Verónica A.', 520)] }),
  s({ store_slug: 'ruedas-cartago', display_name: 'Ruedas Cartago', verified: true, rating_avg: 4.8, rating_count: 22, sales: 31, since: '2026-05-27T00:00:00Z', location: 'Cartago', followers: 203, seenMin: 180,
    bio: 'Bicis de montaña y de ruta con mantenimiento al día. También cascos y repuestos.', delivery: 'Entrega en Cartago centro o Tres Ríos; la bici va con ajuste de frenos y cambios. Plazo: 1 a 3 días.',
    reviews: [r(5, 'La bici venía con mantenimiento recién hecho.', 'Esteban Q.', 70), r(5, 'Muy honesto con los detalles.', 'Paula N.', 330), r(5, 'Me ayudó a escoger la talla correcta.', 'Gerardo B.', 610)] }),
  s({ store_slug: 'pao-sneakers', display_name: 'Pao Sneakers', verified: true, rating_avg: 4.9, rating_count: 29, sales: 40, since: '2026-07-08T00:00:00Z', location: 'Curridabat', followers: 367, seenMin: 14,
    bio: 'Tenis en buen estado, con caja cuando la tengo. Tallas de la 36 a la 44.', delivery: 'Entrega en Curridabat o San Pedro, o envío por Correos de Costa Rica. Plazo: 1 a 3 días hábiles.',
    reviews: [r(5, 'Talla exacta y en excelente estado.', 'Daniela R.', 40), r(5, null, 'Kevin A.', 190), r(5, 'Los tenis para correr venían casi nuevos.', 'Priscilla V.', 450), r(4, 'Todo bien, solo cambió la hora de entrega.', 'Marvin S.', 720)] }),
  s({ store_slug: 'bella-glam', display_name: 'Bella Glam', verified: true, rating_avg: 4.8, rating_count: 34, sales: 47, since: '2026-05-15T00:00:00Z', location: 'Heredia centro', followers: 318, seenMin: 3,
    bio: 'Maquillaje, perfumes, cuidado de la piel y accesorios. Productos sellados o casi llenos.', delivery: 'Entrega en Heredia centro o envío por mensajería a la GAM. Plazo: 1 a 2 días hábiles.',
    reviews: [r(5, 'El perfume venía casi lleno, huele delicioso.', 'Tatiana L.', 25), r(5, 'Muy linda la paleta, llegó bien empacada.', 'Yorleny C.', 180), r(4, null, 'Ana Lucía M.', 390), r(5, 'Las argollas son preciosas.', 'Fiorella D.', 640)] }),
  s({ store_slug: 'closet-rohrmoser', display_name: 'Closet Rohrmoser', verified: false, rating_avg: 4.7, rating_count: 15, sales: 21, since: '2026-07-20T00:00:00Z', location: 'Rohrmoser, San José', followers: 245, seenMin: 28,
    bio: 'Ropa y bolsos de segunda en muy buen estado. Todo lavado y planchado.', delivery: 'Entrega en Rohrmoser o Pavas, o envío por Correos de Costa Rica. Plazo: 2 a 3 días hábiles.',
    reviews: [r(5, 'La chaqueta está como nueva.', 'Mónica E.', 60), r(5, 'Me quedó perfecto el vestido.', 'Andrea P.', 230), r(4, null, null, 500)] }),
  s({ store_slug: 'libros-escalante', display_name: 'Libros Escalante', verified: false, rating_avg: 4.9, rating_count: 12, sales: 16, since: '2026-06-05T00:00:00Z', location: 'Barrio Escalante, San José', followers: 97, seenMin: 240,
    bio: 'Libros usados: novelas, clásicos, infantiles y novelas gráficas. Pregúntame por títulos.', delivery: 'Entrega en Barrio Escalante o envío por Correos de Costa Rica a todo el país. Plazo: 2 a 4 días hábiles.',
    reviews: [r(5, 'Los libros venían bien cuidados y envueltos.', 'Ignacio R.', 80), r(5, 'Excelente selección para mis hijos.', 'Laura B.', 340)] }),
  s({ store_slug: 'bebe-tres-rios', display_name: 'Bebé Tres Ríos', verified: false, rating_avg: 4.8, rating_count: 17, sales: 23, since: '2026-06-28T00:00:00Z', location: 'Tres Ríos, Cartago', followers: 174, seenMin: 50,
    bio: 'Cosas de bebé que ya no usamos: coches, moisés, sillas y ropa. Todo limpio y revisado.', delivery: 'Entrega en Tres Ríos o Curridabat; envío por mensajería a la GAM. Plazo: 1 a 3 días.',
    reviews: [r(5, 'El coche está impecable y se pliega fácil.', 'Carolina V.', 45), r(5, 'Ropa muy bonita y limpia.', 'Wendy A.', 260), r(4, null, null, 480)] }),
  s({ store_slug: 'kevin-mora', display_name: 'Kevin M.', verified: false, rating_avg: 4.3, rating_count: 3, sales: 3, since: '2026-09-01T00:00:00Z', location: 'Desamparados', followers: 23, seenMin: 600,
    bio: 'Vendo cosas que ya no uso.', delivery: 'Entrega en Desamparados o San José centro. Plazo: 1 a 2 días.',
    reviews: [r(5, 'Todo bien con la compra.', 'Sofía C.', 100), r(4, null, null, 280), r(4, 'Tardó en responder pero cumplió.', 'Marco V.', 600)] }),
  s({ store_slug: 'vane-ventas', display_name: 'Vane Ventas', verified: false, rating_avg: 4.5, rating_count: 6, sales: 7, since: '2026-08-14T00:00:00Z', location: 'Moravia', followers: 41, seenMin: 1500,
    bio: 'Artículos de la casa y tecnología.', delivery: 'Entrega en Moravia o Guadalupe. Plazo: 1 a 3 días.',
    reviews: [r(5, 'Muy amable, entregó el mismo día.', 'Gabriela S.', 60), r(4, null, null, 350)] }),
  s({ store_slug: 'luis-electro', display_name: 'Luis Electro', verified: false, rating_avg: null, rating_count: 0, sales: 0, since: '2026-10-12T00:00:00Z', location: 'San Pedro, Montes de Oca', followers: 12, seenMin: 2900,
    bio: 'Electrónica nueva y usada.', delivery: 'Entrega en San Pedro, frente a la UCR, o envío por Correos. Plazo: 2 a 3 días hábiles.', reviews: [] }),
  s({ store_slug: 'dani-tibas', display_name: 'Dani Q.', verified: false, rating_avg: 5, rating_count: 2, sales: 2, since: '2026-09-20T00:00:00Z', location: 'Tibás', followers: 18, seenMin: 320,
    bio: 'Vendo porque me mudo.', delivery: 'Entrega en Tibás o Santo Domingo. Plazo: 1 a 2 días.',
    reviews: [r(5, 'Todo perfecto.', 'Natalia B.', 120), r(5, null, null, 500)] }),
  s({ store_slug: 'marce-cr', display_name: 'Marce C.', verified: false, rating_avg: 4, rating_count: 1, sales: 1, since: '2026-10-01T00:00:00Z', location: 'Santo Domingo, Heredia', followers: 9, seenMin: 4300,
    bio: 'Fotografía y computadoras.', delivery: 'Entrega en Santo Domingo de Heredia o envío por Correos. Plazo: 2 a 4 días hábiles.',
    reviews: [r(4, 'Buen producto, la entrega se movió un día.', 'Ricardo T.', 160)] }),
  s({ store_slug: 'jorge-alajuela', display_name: 'Jorge A.', verified: false, rating_avg: null, rating_count: 0, sales: 0, since: '2026-10-18T00:00:00Z', location: 'Alajuela', followers: 6, seenMin: 7000,
    bio: 'Cosas de la casa en buen estado.', delivery: 'Entrega en Alajuela centro. Plazo: 1 a 3 días.', reviews: [] }),
];

/** Producto con la foto original (.jpg) + un acercamiento (.webp). */
const p = (slug: string, seller: string, title: string, price_crc: number, photo: string, ago: number, condition: string, description: string, delivery: string | null = null): DemoProduct =>
  ({ slug: `${DEMO_PRODUCT_PREFIX}${slug}`, seller, title, price_crc, photo: `/demo-feed/p-${photo}.jpg`, photos: [`/demo-feed/p-${photo}.jpg`, `/demo-feed/p-${photo}-2.webp`], ago, condition, description, delivery });
/** Producto nuevo (.webp): foto principal + 2 acercamientos (w) o 1 (w2: fotos de stock, más chicas). */
const w = (slug: string, seller: string, title: string, price_crc: number, photo: string, ago: number, condition: string, description: string, delivery: string | null = null): DemoProduct =>
  ({ slug: `${DEMO_PRODUCT_PREFIX}${slug}`, seller, title, price_crc, photo: `/demo-feed/p-${photo}.webp`, photos: [`/demo-feed/p-${photo}.webp`, `/demo-feed/p-${photo}-2.webp`, `/demo-feed/p-${photo}-3.webp`], ago, condition, description, delivery });
const w2 = (...a: Parameters<typeof w>): DemoProduct => { const x = w(...a); return { ...x, photos: x.photos.slice(0, 2) }; };

/** 73 productos ficticios con precios de referencia del mercado de segunda mano en Costa Rica. */
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
  // --- Ropa ---
  w2('jeans-recto-30', 'closet-rohrmoser', 'Jeans de mezclilla corte recto talla 30', 14000, 'jeans', 7, 'Usado, como nuevo', 'Mezclilla gruesa azul medio, corte recto. Usados pocas veces, sin roturas ni manchas.'),
  w2('chaqueta-cuero-m', 'closet-rohrmoser', 'Chaqueta de cuero sintético negra talla M', 22000, 'chaqueta', 31, 'Usado', 'Forro interno suave, cierres funcionando perfecto. Ideal para las noches frías de Cartago o San José.'),
  w('vestido-floral-s', 'closet-rohrmoser', 'Vestido floral midi talla S', 12000, 'vestido', 3, 'Como nuevo', 'Tela fresca con flores azules, cruzado al frente. Lo usé una vez para una boda.'),
  w('blusa-lino-m', 'closet-rohrmoser', 'Blusa de lino blanca manga larga talla M', 8500, 'blusa', 64, 'Usado', 'Lino 100 %, botones de nácar. Fresca para el calor.'),
  w2('bolso-cuero-weekender', 'closet-rohrmoser', 'Bolso de cuero café tipo weekender', 28000, 'bolso', 120, 'Usado', 'Cuero genuino con correa para el hombro. Cabe ropa para un fin de semana en la playa.'),
  // --- Belleza y accesorios ---
  w('perfume-100ml', 'bella-glam', 'Perfume de mujer 100 ml (casi lleno)', 32000, 'perfume', 4, 'Usado', 'Aroma ámbar y vainilla, le queda más del 90 %. Frasco de vidrio con tapa dorada.'),
  w('set-cuidado-piel', 'bella-glam', 'Set de cuidado de la piel: sérum, crema y limpiador', 18500, 'skincare', 22, 'Nuevo', 'Tres productos sellados para piel mixta. Vencen en 2028.'),
  w2('paleta-sombras-35', 'bella-glam', 'Paleta de sombras de 35 tonos', 9500, 'sombras', 40, 'Nuevo', 'Tonos mate y brillantes, sellada. Ideal para maquillaje de día y de noche.'),
  w2('set-brochas', 'bella-glam', 'Set de brochas y paleta de maquillaje', 12000, 'brochas', 75, 'Como nuevo', 'Incluye 6 brochas, labiales y una paleta de colores. Las brochas están lavadas.'),
  w('secadora-difusor', 'bella-glam', 'Secadora de pelo 2000 W con difusor', 18000, 'secadora', 98, 'Usado', 'Tres temperaturas y dos velocidades. El difusor es ideal para cabello rizado.'),
  w('aretes-plata-925', 'bella-glam', 'Aretes de plata 925 tipo argolla', 9000, 'aretes', 15, 'Nuevo', 'Argollas medianas con cierre de bisagra. Vienen en su cajita.'),
  w2('lentes-sol-retro', 'bella-glam', 'Lentes de sol estilo retro amarillos', 7500, 'lentesretro', 52, 'Nuevo', 'Marco amarillo con lente oscuro, filtro UV400.'),
  w2('lentes-sol-aviador', 'bella-glam', 'Lentes de sol tipo aviador con lente espejo', 11000, 'lentesaviador', 130, 'Usado, como nuevo', 'Marco dorado y lente espejo azul. Con estuche rígido.'),
  // --- Libros ---
  w2('clasicos-tapa-dura', 'libros-escalante', 'Lote de 7 clásicos de tapa dura', 30000, 'novelas', 10, 'Usado', 'Ediciones antiguas de tapa dura, algunas en inglés. Lomos en buen estado, páginas completas.'),
  w2('pila-libros-usados', 'libros-escalante', 'Pila de 12 libros variados (novela y ensayo)', 25000, 'clasicos', 46, 'Usado', 'Novelas, ensayos y libros de texto en español. Te mando la lista de títulos por el chat.'),
  w('libros-infantiles-8', 'libros-escalante', 'Libros infantiles ilustrados (lote de 8)', 14000, 'librosinfantiles', 27, 'Como nuevo', 'Cuentos de animales de tapa dura para niños de 2 a 6 años. Sin rayones.'),
  w('novelas-graficas-5', 'libros-escalante', 'Novelas gráficas de ciencia ficción (lote de 5)', 18000, 'comics', 88, 'Usado', 'Cinco tomos independientes, en español. Se leen en orden o por separado.'),
  w2('revistas-coleccion', 'libros-escalante', 'Colección de revistas y libros de bolsillo', 12000, 'revistas', 160, 'Usado', 'Más de 30 ejemplares. Ideal para decorar un estante o para leer en el bus.'),
  // --- Bebé ---
  w('coche-bebe-plegable', 'bebe-tres-rios', 'Coche para bebé plegable con canasta', 65000, 'coche', 6, 'Usado', 'Se pliega con una mano, reclinable en 3 posiciones, capota grande y canasta abajo. Llantas en buen estado.'),
  w('silla-carro-bebe', 'bebe-tres-rios', 'Silla de carro para bebé (0 a 13 kg)', 38000, 'sillacarro', 35, 'Usado', 'Con base y arnés de 5 puntos. Funda lavada. Sin golpes.'),
  w2('moises-mimbre', 'bebe-tres-rios', 'Moisés de mimbre para bebé', 35000, 'moises', 58, 'Usado', 'Mimbre natural con patas de madera. Incluye colchoneta.'),
  w2('moises-tul', 'bebe-tres-rios', 'Moisés con tul y base mecedora', 42000, 'moisesbase', 102, 'Usado, como nuevo', 'Tul removible y lavable, base que mece suavecito. Lo usamos 4 meses.'),
  w2('ropa-bebe-0-3', 'bebe-tres-rios', 'Ropa de bebé 0-3 meses (lote de 12 piezas)', 15000, 'ropabebe', 19, 'Usado', 'Mamelucos, camisetas y pantaloncitos de algodón. Todo lavado y en buen estado.'),
  // --- Más de las tiendas de siempre ---
  w('galaxy-a15', 'gaby-celulares', 'Samsung Galaxy A15 128 GB negro', 85000, 'galaxya15', 12, 'Usado, como nuevo', 'Tres meses de uso, batería excelente. Liberado. Incluye cargador.'),
  w('monitor-27', 'tecno-sabana', 'Monitor de 27" Full HD con bordes delgados', 75000, 'monitor', 17, 'Usado', 'Sin píxeles muertos. Incluye cable HDMI y base original.'),
  w('teclado-mecanico', 'luis-electro', 'Teclado mecánico compacto con luces', 28000, 'teclado', 9, 'Nuevo (caja abierta)', 'Switches táctiles, luces de colores y cable USB-C desmontable.'),
  w('audifonos-gamer', 'mundo-gamer-cr', 'Audífonos gamer con micrófono', 22000, 'headset', 13, 'Usado', 'Sonido envolvente, micrófono flexible y almohadillas cómodas. Funcionan en PS5, Xbox y PC.'),
  w('mesa-centro-madera', 'hogar-escazu', 'Mesa de centro de madera y metal', 60000, 'mesacentro', 24, 'Usado', 'Sobre de madera maciza y patas de hierro negro. Mide 1,10 m x 0,60 m.'),
  w('casco-ciclismo-m', 'ruedas-cartago', 'Casco de ciclismo blanco talla M', 18000, 'casco', 33, 'Usado', 'Muy liviano, con buena ventilación y ajuste trasero. Nunca ha recibido golpes.'),
  w('tenis-correr-41', 'pao-sneakers', 'Tenis para correr azul y verde talla 41', 30000, 'teniscorrer', 8, 'Usado, como nuevo', 'Livianos y con buena amortiguación. Menos de 50 km de uso.'),
  w('cafetera-12-tazas', 'vane-ventas', 'Cafetera de goteo de 12 tazas', 16000, 'cafetera', 70, 'Usado', 'Jarra de vidrio y filtro permanente. Hace un café rico para toda la familia.'),
  w('licuadora-vidrio', 'jorge-alajuela', 'Licuadora con vaso de vidrio de 1,5 L', 18000, 'licuadora', 54, 'Usado', 'Base de acero, 5 velocidades. Buena para batidos y salsas.'),
  w('lente-50mm', 'marce-cr', 'Lente 50 mm f/1.8 para cámara réflex', 65000, 'lente50', 29, 'Usado', 'Ideal para retratos con fondo desenfocado. Con tapas delantera y trasera.'),
];

const SELLER = new Map(DEMO_SELLERS.map((s) => [s.store_slug, s]));
const PRODUCT = new Map(DEMO_PRODUCTS.map((x) => [x.slug, x]));
export const isDemoProductSlug = (slug: unknown): boolean => looksLikeDemoProduct(slug) && PRODUCT.has(String(slug));
export const isDemoStoreSlug = (slug: unknown): boolean => SELLER.has(foldText(slug));
export const demoSellerOf = (slug: string) => SELLER.get(foldText(slug)) ?? null;

const outcome = (n: number) => { const d = n > 10 ? 1 : 0; return { completed: n, no_issues: n - d, disputes_resolved: d, disputes_open: 0 }; };
/** Lo mismo que publicSeller (api/_lib/feed.ts) + demo: true. */
export const demoPublicSeller = (s: DemoSeller) => ({ store_slug: s.store_slug, display_name: s.display_name, avatar_url: s.avatar as string | null, verified: s.verified, rating_avg: s.rating_avg, rating_count: s.rating_count, demo: true as const });
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
    followers: s.followers, member_since: s.since, whatsapp: null as string | null, socials: demoSocials(),
    items: DEMO_PRODUCTS.filter((x) => x.seller === s.store_slug).sort((a, b) => a.ago - b.ago).map((x) => ({ slug: x.slug, title: x.title, price_crc: x.price_crc, photo: x.photo, created_at: new Date(now - x.ago * H).toISOString(), demo: true as const })),
    reviews: s.reviews.map((rv) => ({ stars: rv.stars, comment: rv.comment, buyer_name: rv.buyer_name, created_at: new Date(now - rv.h * H).toISOString() })),
  };
}
/** Ficha de un producto de ejemplo (para /p/ej-…). Sin pago: la app no muestra ningún botón para pagar. */
export function demoProduct(slug: string, now = Date.now()) {
  const x = PRODUCT.get(slug);
  if (!x) return null;
  const s = SELLER.get(x.seller)!;
  return { ...x, delivery: x.delivery ?? s.delivery, created_at: new Date(now - x.ago * H).toISOString(), location: s.location, demo: true as const, payable: false as const, seller: { ...demoPublicSeller(s), sales: outcome(s.sales) } };
}

/** Redes de las tiendas de ejemplo: SOLO cuentas de Meteorito (nunca de una persona real). Forma de seller_profiles.socials. */
export const demoSocials = () => ({ instagram: 'https://www.instagram.com/meteorito.app', website: 'https://pago.meteorito.app/' });

export type DemoActivity = { k: 'online' } | { k: 'min'; n: number } | { k: 'h'; n: number } | { k: 'yesterday' } | { k: 'days'; n: number };
/** Última conexión de una tienda de ejemplo, RELATIVA a ahora (mismos rangos que activityOf en api/_lib/activity.ts). */
export function demoSeen(slug: string, now = Date.now()): DemoActivity | null {
  const s = demoSellerOf(slug);
  if (!s) return null;
  // Se mueve un poco con el tiempo (ciclos de 40 min) para que no sea siempre el mismo número.
  const min = s.seenMin < 5 ? s.seenMin : s.seenMin + (Math.floor(now / 2400e3) % 4) * (s.seenMin < 60 ? 2 : 10);
  if (min < 5) return { k: 'online' };
  if (min < 60) return { k: 'min', n: Math.floor(min / 5) * 5 };
  if (min < 1440) return { k: 'h', n: Math.floor(min / 60) };
  if (min < 2880) return { k: 'yesterday' };
  const d = Math.floor(min / 1440);
  return d <= 7 ? { k: 'days', n: d } : null;
}
/** Igual que activityBySlug, para las tiendas de ejemplo de la lista. */
export function demoActivityBySlug(slugs: string[], now = Date.now()): Record<string, DemoActivity> {
  const out: Record<string, DemoActivity> = {};
  for (const slug of slugs) { const a = demoSeen(slug, now); if (a) out[slug] = a; }
  return out;
}
/** Tiendas de ejemplo para sugerir (Siguiendo vacío): las de más seguidores primero. */
export const demoSuggestedStores = (n = 6) => [...DEMO_SELLERS].sort((a, b) => b.followers - a.followers).slice(0, n).map(demoPublicSeller);
