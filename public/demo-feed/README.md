# Fotos de las ventas de EJEMPLO del feed

`venta-*.jpg` son las fotos de las 6 ventas cerradas ficticias de `lib/feedSales.ts` (etiqueta "Ejemplo",
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
