# Importar un anuncio desde un link

El vendedor pega el link de su anuncio en **Vender → Importar de un link**. Detectamos el proveedor por el dominio,
leemos la página pública y prellenamos nombre, precio en colones (sugerido; el vendedor lo confirma), descripción
(máx. 500 caracteres) y hasta 4 fotos. Nada se publica solo: el vendedor revisa y toca "Generar link".

- Código: `api/_lib/importers/` (`providers.ts` detección, `net.ts` red segura, `parse.ts` extractores, `index.ts` orquestador).
- Endpoint: el mismo de siempre, `POST /api/store` con `action: 'import_listing'` (sin funciones nuevas; siguen 12).
  `import_facebook` sigue existiendo para la invitación de Comprar.
- El pedido guarda `source_url` (sin query ni hash) y `source_provider` (migración `019_listing_source.sql`).
- Eventos PostHog: `import_started`, `import_succeeded`, `import_failed` (siempre con `provider`; nunca el link).

## Orden de extracción

1. API pública sin credenciales (si existe; hoy ninguno de los proveedores la ofrece sin token).
2. JSON-LD `Product` (incluye `@graph` y `ProductGroup`).
3. Open Graph (`og:title`, `og:image`, `product:price:*`).
4. Microdata (`itemprop`).

Extractores específicos donde la página no trae lo anterior completo: Encuentra24 (payload de Next.js: precio,
moneda, descripción y fotos; pedimos la versión JPEG quitando `f_auto`, que sirve AVIF) y Amazon (`productTitle`, `priceAmount`, `hiRes`/`data-a-hires`).

## Proveedores

| Proveedor | Dominios | Estado | Notas |
|---|---|---|---|
| Facebook Marketplace | facebook.com, fb.me | ok | importador existente |
| Mercado Libre | todos los ccTLD, articulo.*, mercadolivre.com.br, meli.la | ok* | desde IPs de datacenter redirige a `/gz/account-verification`; la API pide token. Si el muro aparece, el vendedor ve "No pudimos leer ese link; súbelo con la cámara." |
| Encuentra24 | encuentra24.com | ok | `f_auto` sirve AVIF (el bucket no lo acepta): pedimos la foto sin `f_auto` y llega JPEG |
| Amazon | .com, .com.mx, .com.br, a.co, amzn.to, amzn.eu | ok | con UA de navegador móvil |
| AliExpress | aliexpress.* | parcial | título y foto por Open Graph; sin precio (lo completa el vendedor) |
| Walmart | walmart.co.cr, walmart.com.mx | ok (CR) | CR por JSON-LD; MX respondió `/blocked` en las pruebas |
| Shopee | br, mx, co, cl | fuera | SPA sin datos en el HTML |
| OLX | br | fuera | Cloudflare 403 |
| Falabella | falabella.com* | fuera | 403 |
| Temu | temu.com | fuera | SPA sin datos en el HTML |
| Cualquier otro https | — | genérico | JSON-LD → OG → microdata |

Los proveedores "fuera" responden `provider_blocked` sin hacer ninguna llamada de red.

**Decisión: no nos hacemos pasar por bots de terceros.** Shopee, Amazon y otros entregan Open Graph completo a los UA
de WhatsApp/Slack/Telegram, pero usar esos UA sería suplantarlos. Solo usamos un UA de navegador móvil y uno propio
honesto: `MeteoritoLinkPreview/1.0 (+https://meteorito.app)`.

## Seguridad (SSRF)

- Solo `https`, puerto 443, sin usuario/contraseña, sin IPs literales ni nombres `.local`/`.internal`/`localhost`.
- Resolvemos DNS nosotros y bloqueamos privadas, loopback, link-local, CGNAT, metadata (169.254.169.254), benchmark,
  documentación, multicast, IPv6 ULA/link-local/mapeadas/NAT64/6to4. Si **una** IP resuelta es interna, se rechaza.
- Conectamos a la IP validada (lookup fijado + SNI), así un rebinding entre validar y conectar no sirve.
- Cada redirección se vuelve a validar (máx. 5 saltos). Los links cortos (a.co, amzn.to, meli.la…) se resuelven así.
- Timeout total, tamaño máximo después de descomprimir, `content-type` solo HTML (y solo jpeg/png/webp para fotos,
  verificando los bytes mágicos).

## Fotos

Las fotos importadas quedan exentas de la regla "solo cámara" (vienen del anuncio del propio vendedor). El servidor las
guarda al importar (`storeImportedPhotos`, ruta `import-<clave del source_url>-<uuid>`, de #68) y solo valen en un
producto que mande ese mismo `source_url`. Las que el vendedor agrega a mano siguen siendo solo de cámara.
