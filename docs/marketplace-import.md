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

Probados el 2026-10-24 **desde producción** (IPs de Vercel). Desde una IP residencial varios funcionaban (Encuentra24,
Amazon MX, AliExpress parcial), pero lo que cuenta es lo que ve el servidor:

| Proveedor | Dominios | Estado | Qué vio el servidor |
|---|---|---|---|
| Facebook Marketplace | facebook.com, fb.me | ok | importador existente |
| Walmart CR | walmart.co.cr | ok | JSON-LD: nombre, ₡, foto |
| Cualquier otra tienda https | — | genérico | JSON-LD → OG → microdata (walmart.com.mx cae aquí y responde `/blocked`) |
| Mercado Libre | todos los ccTLD, articulo.*, mercadolivre.com.br, meli.la | fuera | redirige a `/gz/account-verification`; la API pide token |
| Encuentra24 | encuentra24.com | fuera | HTTP de error a IPs de datacenter (desde IP residencial: 200) |
| Amazon | .com, .com.mx, .com.br, a.co, amzn.to, amzn.eu | fuera | captcha (`/errors/validateCaptcha`, título "Amazon.com.mx") |
| AliExpress | aliexpress.* | fuera | página sin datos del producto |
| Shopee | br, mx, co, cl | fuera | SPA sin datos en el HTML |
| OLX | br | fuera | Cloudflare 403 |
| Falabella | falabella.com* | fuera | 403 |
| Temu | temu.com | fuera | SPA sin datos en el HTML |

Al pegar un link de un proveedor "fuera" la hoja lo dice de una vez ("Todavía no podemos leer anuncios de X; súbelo con
la cámara.") y no se intenta. Los extractores de Encuentra24, Amazon y Mercado Libre se quedan con sus tests de fixtures
(`ignoreStatus` solo en tests) por si se reabren (API oficial, acuerdo o salida por otra red).
Las fallas guardan un código de diagnóstico (`wall`, `http_403`, `unreadable`…), sin datos del vendedor.

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

## Comprar → Invitar a un vendedor

El comprador (sin cuenta) pega el link del anuncio de cualquier marketplace en **Importar de un link** (`app/i/nueva.tsx`).
Se usa el mismo `providers.ts` para detectar el proveedor al pegar ("Anuncio de {proveedor}" con su icono) y el mismo
`import_listing` (con su llave de invitado y el límite por IP) donde se deja leer:

| Proveedor | Qué pasa en la invitación |
|---|---|
| Facebook, Walmart CR, tiendas genéricas https | se lee: nombre, precio y foto precargados ("Importado de X"). Si falla (privado, borrado): aviso neutro "Anuncio de X" y se completa a mano |
| Mercado Libre, Encuentra24, Amazon, AliExpress, Shopee, OLX, Falabella, Temu | NO se pide (bloquean nuestros servidores). El link se acepta sin error ("Anuncio de X: tú escribes el nombre y el precio.") |

En todos los casos el link queda en la invitación (`invitations.source_url`, migración 015: solo exige `https://`) y el
vendedor ve "Ver anuncio en {proveedor}" y "Vieron tu anuncio en {proveedor}". `/api/invites` valida el link con
`checkListingUrl` (https público, sin IPs ni nombres internos, máx. 1000). Tests: `t68`, `e2e/invite-markets.spec.ts`.
