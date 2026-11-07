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

## Privacidad (revisión de Harvey, migración 039)

- **Aviso**: `/legal/vendedor` ("Aviso de privacidad para quien vende sin cuenta", `LEGAL.vendedor` en `lib/legal.ts`,
  versión `SELLER_NOTICE_VERSION`). Responsable: Rolando Arguello Lizano (Costa Rica), contacto team@meteorito.app.
  **Dirección física:** Torres de Heredia, A701, Barreal, Heredia, Costa Rica (`CONTROLLER_ADDRESS`).
  Cubre finalidades (OTP, acceso, recuperación, constancia de la aceptación; sin publicidad), que es necesario para este
  camino, proveedores (Brevo, Supabase, Vercel; fuera de Costa Rica), derechos ARCO/revocar/PRODHAB y retención.
- **Casilla** (no marcada; sin ella el botón "Enviarme el código" y el de recuperar están deshabilitados), con el link al
  aviso antes del botón: "Autorizo el tratamiento de mi correo para verificar acceso y registrar mi aceptación, según el
  aviso de privacidad. No incluye publicidad." El servidor rechaza `seller_otp_request` / `seller_recover_request` sin
  `consent: true` (400 `consent_required`) o con otra `consent_version` (409 `consent_outdated`), antes de guardar nada.
- **Registro aparte** de la aceptación comercial: `seller_guest_consents` (versión del texto, versión del aviso, sha256 del
  texto, fecha; inmutable). Cada código (`seller_otp_challenges.consent_id`) apunta a su consentimiento.
- **Sin borrado automático ni agendado** (040). La eliminación se realiza a pedido o por un administrador manualmente.
  `seller_guest_purge(p_days, p_guest)` conserva su umbral de elegibilidad de 90 días para el lote manual;
  con `p_guest` permite atender una solicitud puntual antes del umbral. Nunca con una venta abierta o reclamo pendiente.
  Eliminamos el correo almacenado y sustituimos su identificador de búsqueda; conservamos las constancias indicadas.
  La función pone `contact_enc = null`, sustituye `contact_hmac` al azar y marca `erased_at`;
  borra sesiones y códigos que no respaldan una aceptación. Conserva `seller_acceptances` y `seller_guest_consents`.
  Otras constancias pueden permitir relacionar la operación con una persona; no se promete anonimización total.
  - No hay tarea pg_cron de retención del vendedor, chats ni contactos de compradores.
  - **Op admin** `POST /api/invites {op:'seller_guest_purge'}` (Bearer de admin): ejecución manual;
    con `email` atiende a ese vendedor a pedido (si tiene una venta abierta responde `blocked: 1`).

## Excepción de cobro (visible en el flujo y en los legales)

> En esta prueba, Meteorito opera el rol serviceProvider mediante su backend. Al liberarse, los tokens de prueba llegan a una wallet de la plataforma, no a la del vendedor. El cobro es simulado: no hay transferencia bancaria ni dinero real.

Se muestra en "Dónde cobras" y en el panel de la venta (`ExceptionBox`), en el aviso del vendedor, y como excepción en la
Política de privacidad ("Pagos y escrow") y en los Términos ("El servicio" y "Escrow"). La custodia hasta la liberación
no cambia: el pago queda apartado en el contrato de escrow de Trustless Work, no en una cuenta de Meteorito. Va dentro
del hash del acuerdo (`agreementFor`).

## Flujo / API (`POST /api/invites`)

- `seller_otp_request {code, email, delivery_mode, agreement_hash, consent, consent_version}`: exige el consentimiento, valida que no sea el comprador, el hash del acuerdo
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

Migraciones: `038_seller_guest.sql`, `039_seller_guest_privacy.sql`. Pruebas: `t114` (API, QA del plan), `t115` (038 en PGlite) y `t116` (privacidad, retención y excepción).
