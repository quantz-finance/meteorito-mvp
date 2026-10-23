# Importar de Facebook Marketplace

Vender → **Importar de Facebook**: el vendedor pega el link de su anuncio (Compartir → Copiar link). El app
precarga nombre, precio en colones, foto y descripción. El vendedor revisa y toca **Generar link**. Nunca se crea
nada sin esa revisión, porque los datos leídos de FB pueden venir mal.

## Qué expone Facebook sin login (probado 2026-10-23 desde un IP de datacenter, AS54113 Fastly)

| Pedido | Resultado |
| --- | --- |
| `GET /marketplace/item/<id>/` con UA de Safari iOS | 200, ~46 KB. `og:title`, `og:image` (1 foto, CDN `scontent-*.fbcdn.net`, firmada con `oe=`, vence), `og:description` = `"<título> - ₡18000, in San Joaquin, Heredia."` |
| ídem con `facebookexternalhit/1.1` | 200, ~600 KB. Mismo `og:title`/`og:image` (a veces `lookaside.fbsbx.com/lookaside/crawler/media/?media_id=…`); `og:description` = **la descripción del vendedor** (multilínea), sin precio |
| `GET /share/<code>/` | 302. Con Safari, va a `m.facebook.com/share/<code>/` (200 con OG); con `facebookexternalhit`, va a `/marketplace/item/<id>/?…` |
| `m.facebook.com/marketplace/item/<id>/` con `facebookexternalhit` | 302 a un anuncio viejo y luego a `/login.php` (**muro de login**) |
| `fb.me/<code>` | 302 a `www.facebook.com/` (no sirve para anuncios; se acepta, pero termina en "no pudimos leer") |
| anuncio inexistente | 200 con `<title>Facebook</title>` y sin OG |
| JSON-LD / `product:price:*` | **No vienen** (se soportan igual por si aparecen) |
| HTML completo de escritorio | Sin precio ni fotos extra: el anuncio carga después por GraphQL con sesión |

Por eso el server hace dos pedidos en paralelo (Safari → título, foto y precio; crawler → descripción), lee solo
hasta `</head>` (las etiquetas OG están en los primeros ~2 KB) y baja la foto del CDN enseguida.

**Límite real:** si el título es largo, FB recorta el resumen y **el precio no viene**. Pasa lo mismo en anuncios de
vehículos o propiedades con otro formato. En esos casos el resultado es `partial` y el vendedor escribe el precio.

## Seguridad y límites

- Solo `https://` de `facebook.com` (y sus subdominios) o `fb.me`, sin usuario ni puerto. La ruta tiene que ser
  `/marketplace/item/<id>` o `/share/…`. Cada redirección se valida igual (SSRF). Las fotos solo vienen de
  `*.fbcdn.net` y `lookaside.fbsbx.com`, solo JPEG/PNG/WebP (revisando los bytes) y pesan ≤4 MB.
- Timeout de 6 s, lectura de HTML ≤512 KB, a lo sumo 5 redirecciones.
- Requiere sesión de vendedor (Bearer Cavos). 8 importaciones por minuto por vendedor (por instancia).
- Vive dentro de `/api/store` (`action:'import_facebook'`), así que no suma función: siguen siendo 12.
- La foto vuelve como data URL. El cliente la comprime igual que una foto del teléfono y la sube por
  `/api/photos/upload-url` al generar el link. No quedan archivos huérfanos y la foto no depende de la URL de FB, que vence.
- El link de FB no se guarda en el producto ni se manda a analítica. Evento `facebook_import` con `result`.

## Riesgos

- FB puede cambiar el HTML, bloquear IPs de datacenter (Vercel/AWS) o pedir login en cualquier momento. Si eso pasa,
  el app degrada a "No pudimos leer ese anuncio, completa los datos." y el vendedor sigue a mano.
- Los Términos de Meta prohíben la recolección automatizada sin permiso. Aquí se lee **un** anuncio, a pedido de su
  dueño, con el mismo dato que FB publica para vistas previas de links (OG), sin login y con límite de frecuencia.
  Revisarlo con legal antes de promocionarlo mucho.

Tests: `scripts/ci/t44-facebook-import.test.ts` (fixtures reales en `scripts/ci/fixtures/facebook/`),
`e2e/api-contract.spec.ts` (API-FB), `e2e/seller.spec.ts` (VEN-07, VEN-08).
