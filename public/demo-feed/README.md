# Fotos de las ventas de EJEMPLO del feed

`venta-*.jpg` son las fotos de las 6 ventas cerradas ficticias de `lib/feedSales.ts` (iconito (i) discreto,
`FEED_DEMO_SALES`). Son **imágenes generadas por IA** el 2026-10-24 (no son fotos de personas, productos ni marcas
reales; sin logos ni texto). No hay licencia de terceros ni créditos que dar: son propias del proyecto.

400×400 px, JPEG progresivo, ≤ 40 KB cada una. Si se apagan las ventas de ejemplo, se pueden borrar.

| Archivo | Venta de ejemplo |
|---|---|
| venta-bicicleta.jpg | María R. → Carlos M. · Bicicleta de montaña |
| venta-control.jpg | Pablo J. → Natalia S. · Control de consola |
| venta-audifonos.jpg | Laura G. → Andrés P. · Audífonos inalámbricos |
| venta-chaqueta.jpg | Andrea L. → Felipe R. · Chaqueta de mezclilla |
| venta-camara-instantanea.jpg | Sofía V. → Daniel C. · Cámara instantánea |
| venta-lampara.jpg | Esteban M. → Valeria Q. · Lámpara de escritorio |

## Productos de ejemplo (`p-*.jpg`)

`p-*.jpg` son las fotos de los 40 productos de EJEMPLO de Comprar (`api/_lib/demoProducts.ts`, flag
`FEED_DEMO_PRODUCTS` en `api/_lib/demoFlag.ts`) y de los 8 productos del modo demo (`lib/demoFeed.ts`). También son
**imágenes generadas por IA** el 2026-10-24, con aspecto de foto de celular: objetos genéricos, sin personas, sin logos
ni marcas visibles y sin texto. No vienen de Facebook Marketplace ni de ningún anuncio real.

800×800 px, JPEG progresivo, ≤ 120 KB cada una. Se sirven desde `/public` (no se importan en JS ni las precachea el
service worker). Si se apagan los productos de ejemplo para siempre, se pueden borrar junto con `demoProducts.ts`.


## Ampliación 2026-10-24: 16 tiendas, 73 productos, fotos de perfil

- `a-*.webp` (256×256, ≤ 40 KB): fotos de perfil de las tiendas de ejemplo, de los vendedores del modo demo y de las
  ventas de ejemplo. **Generadas por IA**: personas ficticias (no son personas reales ni figuras públicas).
- `p-<foto>-2.webp` / `p-<foto>-3.webp`: acercamientos (recortes) de la foto principal de cada producto (2.ª y 3.ª foto).
- `p-*.webp` nuevos: generados por IA (sin marcas ni personas), salvo estos, que son fotos de stock con licencia
  **CC0** (dominio público, sin atribución obligatoria) de StockSnap, descargadas y servidas desde aquí (sin hotlink):

| Archivo | Foto original | Fuente | Licencia |
|---|---|---|---|
| p-jeans*.webp | Blue Jeans — Seacoast Sage | [StockSnap](https://stocksnap.io/photo/blue-jeans-VM5QPG2JT1) | CC0 |
| p-jeans-2*.webp | Blue Jeans — Seacoast Sage | [StockSnap](https://stocksnap.io/photo/blue-jeans-BCRQWOTPWM) | CC0 |
| p-chaqueta*.webp | Leather Jacket — Robbie Noble | [StockSnap](https://stocksnap.io/photo/leather-jacket-DK118BUX57) | CC0 |
| p-bolso*.webp | Handbag Leather — Harsh Jadav | [StockSnap](https://stocksnap.io/photo/handbag-leather-Z9ESJO45V5) | CC0 |
| p-sombras*.webp | Beauty Makeup — Alexandre Vanier | [StockSnap](https://stocksnap.io/photo/beauty-makeup-34MSYVUYS0) | CC0 |
| p-brochas*.webp | Beauty Makeup — Beauty and Fashion | [StockSnap](https://stocksnap.io/photo/beauty-makeup-MKGGIJ360Q) | CC0 |
| p-lentesretro*.webp | Sunglasses Summer — Jakub Rostkowski | [StockSnap](https://stocksnap.io/photo/sunglasses-summer-EVAARS1W4M) | CC0 |
| p-lentesaviador*.webp | Sunglasses Blue — Dave Meier | [StockSnap](https://stocksnap.io/photo/sunglasses-blue-YUJAISV8PW) | CC0 |
| p-novelas*.webp | Books Oldbooks — Suzy Hazelwood | [StockSnap](https://stocksnap.io/photo/books-oldbooks-ZMINJHNLV1) | CC0 |
| p-clasicos*.webp | Books Stacked — Candace McDaniel | [StockSnap](https://stocksnap.io/photo/books-stacked-W5VAXXV2RP) | CC0 |
| p-revistas*.webp | Still Items — Robyn Budlender | [StockSnap](https://stocksnap.io/photo/still-items-Y74AX3CEUY) | CC0 |
| p-moises*.webp | Baby Crib — Matt Bango | [StockSnap](https://stocksnap.io/photo/baby-crib-SITUKGWGWJ) | CC0 |
| p-moisesbase*.webp | Room Curtain — Freestocks.org | [StockSnap](https://stocksnap.io/photo/room-curtain-AME7OP0H65) | CC0 |
| p-ropabebe*.webp | Baby Clothes — Matt Bango | [StockSnap](https://stocksnap.io/photo/baby-clothes-Q2NLOOVQBU) | CC0 |

- `venta-*.jpg` nuevos (tenis-correr, perfume, coche-bebe, audifonos-gamer, libros-infantiles, vestido): recortes de
  las fotos de producto de arriba.

**Borrar todos los ejemplos**: `FEED_DEMO_PRODUCTS = false` (api/_lib/demoFlag.ts) y `FEED_DEMO_SALES = false`
(lib/feedSales.ts) los apagan sin deploy de datos; para quitarlos del repo:
`git rm -r public/demo-feed && git rm api/_lib/demoProducts.ts` (y sus imports, ver `rg demoProducts`).
