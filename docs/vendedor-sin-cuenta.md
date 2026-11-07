# Vendedor sin cuenta (opción A, solo testnet)

El vendedor abre `/i/<código>` y acepta **sin cuenta Cavos**: ve el resumen exacto del acuerdo (producto, monto,
entrega, plazo de reclamo, reglas), el aviso "Prueba en testnet: sin dinero real; no transferimos a tu banco",
el cobro por IBAN **simulado** (no se pide ni se guarda un IBAN real) y acepta con un código de 6 dígitos por correo.
"o entra con tu cuenta" mantiene el camino Cavos de siempre.

## Flag

| Variable (Vercel, Production) | Efecto |
|---|---|
| `SELLER_GUEST_ENABLED=1` | Activa OTP/aceptar sin cuenta **y** el despliegue/fondeo de pedidos de vendedor sin cuenta. Solo si la red es testnet. |
| `BREVO_API_KEY` + `GUEST_EMAIL_ENABLED=1` | Canal de correo (obligatorio). Sin él `seller_guest.available=false` (razón `email_unconfigured`) y la UI muestra la vista Cavos de antes. No se simulan códigos. |

También requiere `SERVICE_SECRET` (service provider backend), `PLATFORM_PUBLIC` y `ORDER_ACCESS_SECRET` o `PIN_PEPPER` (HMAC).
Apagar: quitar `SELLER_GUEST_ENABLED` y redeploy. Los pedidos de vendedor sin cuenta quedan bloqueados para fondear
(503 `seller_guest_disabled`); los ya fondeados siguen con las guardas normales de liberación y disputa.

## Flujo / API (`POST /api/invites`)

- `seller_otp_request {code, email, delivery_mode, agreement_hash}`: valida que no sea el comprador, el hash del acuerdo
  y los topes (8 códigos/invitación/h, 5/correo/h, rate limit `invites.otp`), envía el código (hash HMAC, 10 min, 5 intentos).
- `seller_accept {challenge_id, otp, agreement_hash}`: RPC `seller_guest_accept` atómica (FOR UPDATE): consume el código,
  crea **un** pedido (`seller_auth_kind='guest'`, `seller_address` = SP backend, `payout_method='iban'`,
  `payout_address` = cuenta de plataforma), guarda `seller_acceptances` inmutable (hash del acuerdo + snapshot del cobro),
  marca la invitación aceptada y abre una sesión HttpOnly `mss_<slug>` (Path=/api, 60 días, hash sha256 en DB).
- `seller_recover_request` / `seller_recover_verify`: nuevo código al mismo correo, revoca sesiones anteriores.
- La sesión del vendedor sirve para `ship`, fotos de envío/disputa, PIN y respuestas a disputas/reclamos (`sellerSubFor`).

## Custodia

`serviceProvider` = backend (`SERVICE_SECRET`), `receiver` = plataforma (cola de IBAN simulado). Deploy y fondeo
(`pay`, mock ramp, fondeo directo) exigen aceptación válida y snapshot coherente (`guestPayee`); nunca cae a Cavos.
"Fondos en custodia" solo con `funded_tx` confirmado.

Migración: `supabase/migrations/038_seller_guest.sql`. Pruebas: `t114` (API, QA del plan) y `t115` (SQL en PGlite).
