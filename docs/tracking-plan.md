# Plan de tracking — Meteorito MVP (PostHog)

PostHog org **Quantz**, host `https://us.i.posthog.com`. Key pública de proyecto (`phc_…`) en `EXPO_PUBLIC_POSTHOG_KEY` (cliente) y `POSTHOG_KEY` (server, Vercel). La misma key ya usa la landing (meteorito.app).

## Principios de privacidad (Ley 8968)
- **distinct_id** = `u_` + SHA-256(`meteorito-analytics-v1:` + sub de Cavos), 32 hex. El salt es una constante pública del cliente (`lib/analytics.ts`, `ANALYTICS_SALT`): sirve para no sacar el `sub` crudo del dispositivo; no es secreto. Nunca se envía `sub`, email, teléfono, IMEI, dirección de wallet ni llaves.
- **Montos**: en eventos de cliente (ligados a persona) solo en rangos (`price_bucket`). Montos exactos solo en eventos server (`srv_*`) con `distinct_id` = hash del pedido y `$process_person_profile: false` (sin vínculo a persona).
- **Sin grabación de sesión** (desactivada globalmente), sin autocapture, sin surveys, `ip: false`, URLs sin query string, slugs reemplazados por `:slug` en nombres de pantalla.
- **Opt-out**: Mi cuenta → "Analítica de uso" (persistente en localStorage en web; en nativo dura la sesión hasta añadir almacenamiento). `ANALYTICS_DISABLED=1` apaga el server.
- Helper único: `track(event, props)` en `lib/analytics.ts`. Server: `trackServer()` en `api/_lib/analytics.ts`, enganchado a `logEvent()` (`order_events`).

## Eventos de cliente
| Evento | Dónde | Props |
|---|---|---|
| `app_opened` | primer evento de cada carga de la app (web) | `first_touch` (true si esta carga guardó la atribución) + las UTMs first-touch |
| `screen_viewed` | cada cambio de ruta | `screen` (`/`, `/vender`, `/p/:slug`, `welcome`…) |
| `login_started` | Welcome → Entrar | – |
| `signed_in` | sesión activa (tras identify) | – |
| `sell_step_completed` | wizard Vender | `step` (0-3), `step_name` |
| `sell_submit_tapped` | último paso | `step` |
| `link_created` | link creado | `category`, `photos`, `price_bucket`, `from_facebook` |
| `facebook_import` | Comprar (Invitar a un vendedor) → Importar de Facebook (Vender usa `import_*`) | `context` (`invite` si fue el comprador), `result` (success/partial/failed), `has_title`, `has_price`, `photos`, `has_description`, `converted`, `code` (solo si falló la llamada). Nunca la URL, el título, el precio ni el texto. |
| `import_started` | Vender → Importar de un link → Importar | `provider` (facebook, mercadolibre, encuentra24, amazon, aliexpress, walmart, web…). Nunca la URL. |
| `import_succeeded` | Vender → el link se leyó (success o partial) | `provider`, `result`, `has_title`, `has_price`, `photos`, `has_description`, `converted` (precio sugerido desde otra moneda). Sin URL, título ni precio. |
| `import_failed` | Vender → no se pudo leer el link | `provider`, `code` (`wall` verificación/login, `provider_blocked`, `private_ip`, `timeout`, `http`, `bad_type`, `too_large`, `unreadable`, `import_url_invalid`, 401/429…). |
| `invite_created` | Comprar → Crear invitación | `photos`, `from_facebook` |
| `invite_shared` | Invitación → Enviar link al vendedor | `from_facebook` |
| `photo_upload_failed` | venta / disputa | `context`, `index`, `precompressed`, `stage` (compress/sign/storage), `code`, `http_status`, `mime` |
| `share_clicked` / `link_copied` | Compartir | `method` |
| `payment_link_opened` / `payment_link_not_found` | `/p/:slug` | `status`, `logged_in`, `category` |
| `seller_contact_opened` | `/p/:slug` (comprador, pedido pagado) | — (nunca el teléfono) |
| `rules_opened` | Cómo funciona (Home, Mi cuenta, pago, Vender) | `from` (home, account, pay, sell) |
| `pay_confirm_tapped` / `payment_funded_client` | PayBox "Ya pagué" | – |
| `pin_failed` | vendedor ingresa PIN | `locked` |
| `dispute_opened` | DisputeSheet | `reason`, `photos` |
| `error_shown` | errores de UI | `area`, `code` (texto truncado, ids largos ocultos) |
| `legal_opened` | links legales | `doc` |
| `analytics_opted_out` | antes de apagar | – |
Todos llevan `platform`, `network: testnet`, `app`.

### Atribución del landing (first-touch)
El landing enlaza a `https://pago.meteorito.app/?utm_source=landing&utm_medium=cta&utm_content=<nav|hero|demo_section|que_hace|gracias>`.
`lib/attribution.ts` lee `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` y el dominio del referrer externo al cargar (antes de que el router redirija), y los guarda **una sola vez** en `localStorage` (`meteorito:first-touch:v1`); las visitas posteriores no los pisan.
- Super propiedades (en todos los eventos): `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `initial_referring_domain`, `initial_landing_path` (ruta sin slug).
- Persona, al identificar: `$set_once` `initial_utm_*`, `initial_referring_domain`, `initial_landing_path`.
- `$current_url` sigue sin query (el query puede traer tokens). Con opt-out no se guarda ni se envía nada; en modo demo no hay analítica. IP desactivada y sin grabación de sesión, igual que antes.
- Pruebas: `scripts/ci/t42` (unit) y `MCK-UTM-01..03` (E2E con PostHog simulado en `scripts/e2e/mock-server.mjs`).

## Eventos server (fuente de verdad del dinero)
`srv_order_created` (`category`, `price_crc`), `srv_escrow_deployed`, `srv_funded` (`amount_usdc`, `ramp`), `srv_shipped`, `srv_approved` (`reason`: pin/received/auto), `srv_released` (`reason`, `hours_to_release`), `srv_release_refused`, `srv_pin_failed`, `srv_dispute_opened` (`reason`), `srv_dispute_resolved`. Props comunes: `order_key`, `network`, `source: server`.
Nota: `srv_order_created` usa `order_key` del slug (el insert no devuelve id); el resto, del id del pedido.

## Métricas
**Inversionistas**: registros (primer `signed_in` por persona), activación (`link_created` o `payment_funded_client` ≤7 días tras registro), links creados (`srv_order_created`), GMV en escrow (Σ `amount_usdc` de `srv_funded` − liberados/resueltos), pagos fondeados, tasa de liberación (`srv_released`/`srv_funded`), tasa de disputa (`srv_dispute_opened`/`srv_funded`), tiempo a liberar (mediana `hours_to_release`), retención D1/D7/D30 (Retention sobre `screen_viewed`), embudo `payment_link_opened → pay_confirm_tapped → srv_funded → srv_released`.
**Producto**: pantallas, abandono del wizard (embudo `sell_step_completed` 0→3 → `link_created`), errores por `area`, fallos de fotos, fallos de PIN, shares.
