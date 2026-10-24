# Pago con tarjeta (formulario propio + Lendara headless)

El comprador (invitado o con cuenta) puede pagar con tarjeta además de SINPE Móvil. Usamos el **sandbox de
[Lendara](https://lendara-monorepo-fixh.vercel.app)** (rampa CRC → USDC sobre Stellar **testnet**, tarjetas de prueba,
no mueve dinero real). Repo: https://github.com/Lendara-Org/Lendara-monorepo (MIT).

## Flujo (default: formulario propio, `LENDARA_MODE` sin definir)

El comprador nunca sale de Meteorito ni ve a Lendara: la hoja **"Pagar con tarjeta"** es nuestra
(`components/CardSheet.tsx`) y el servidor hace lo que haría el widget, en modo *headless*.

1. `POST /api/escrow/pay {step:'start'}` despliega el escrow y responde `card: true` (si hay `LENDARA_API_KEY`) y
   `cardMode: 'inapp' | 'widget'`. Sin la variable, la UI muestra solo SINPE (como antes).
2. **"Elige cómo pagar"** → **Pagar con tarjeta** abre nuestra hoja: número (espacios automáticos + marca), vencimiento
   MM/AA, CVC, nombre y correo. Letra ≥ 16 px (sin zoom en iOS), `inputMode` numérico, `autocomplete` `cc-number`,
   `cc-exp`, `cc-csc`, `cc-name`, `email` (+ `name`) para el autollenado de iOS/Chrome. Validación en el navegador
   (`lib/card.ts`): Luhn, vencimiento (no vencida), CVC (3, Amex 4), correo. Sin scroll en iPhone SE (375×667).
3. **El número y el CVC nunca salen del navegador** (ni requests, ni logs, ni analítica). Hoy el procesador es el sandbox
   de Lendara, así que el navegador traduce la tarjeta a su resultado (`scenario`) y solo se aceptan las 4 tarjetas del
   sandbox; cualquier otra muestra "Tarjeta no aceptada" (sin rótulos de prueba en la UI). Al servidor va solo
   `{step:'card_pay', name, email, scenario}`; el servidor rechaza (400) cualquier cuerpo con claves de tarjeta
   (`number`, `cvc`, `pan`, `exp`…). PostHog: autocapture y grabación ya están apagados (`lib/analytics.ts`); además los
   campos llevan `data-ph-no-autocapture` y el contenedor `ph-no-capture ph-sensitive`. Al cerrar la hoja se borran
   número, vencimiento y CVC; tras un intento fallido se borra el CVC.
4. `step:'card_pay'` (`cardPay()` en `api/_lib/lendara.ts`): solo el comprador, solo en `escrow_creado`.
   - Si un intento anterior ya se completó → fondea (no cobra otra vez); si hay uno en curso → `{pending:true}`.
   - Asegura la trustline de la tesorería al USDC de Lendara.
   - `POST /v1/sessions {account: tesorería, fiat_currency:'CRC', amount: price_crc (DB), memo_type:'text', memo:'met:<slug>'}`
     y guarda el id en `order_events` (`kind='card_session'`, `detail.mode='inapp'`, `detail.buyer={name,email}`;
     insert directo, no `logEvent`, para que el nombre/correo no vayan a la analítica). **Sin migración.**
   - `POST /widget-api/sessions {transaction_id, token}` (token de un solo uso de la URL, 15 min) → `access_token`
     (JWT 30 min). **Nunca sale del servidor** ni se guarda.
   - `POST /widget-api/transaction/confirm {fiat_currency:'CRC', amount: price_crc.toFixed(2)}`: el monto sale de la
     DB; lo que mande el cliente se ignora. 409 (ya confirmado) se acepta solo si es el mismo monto.
   - `POST /widget-api/transaction/simulate-payment {scenario}`. 409 (ya pagado) → se lee el estado (no hay doble cobro).
   - `error` (KYC rechazado) → 402 `card_kyc_rejected` "Tu tarjeta fue rechazada…"; `expired` → 402 `card_expired`
     "No pudimos procesar el pago con tu tarjeta…"; ambos ofrecen SINPE. Si no → `{pending:true}`.
   - Arranque en frío (Railway): sesión y token con timeout (25 s / 20 s) y **un reintento** solo si Lendara no respondió
     (red, timeout, 5xx, 429). Si el token ya se había consumido (respuesta perdida) → 401 → error claro; el intento se
     marca `card_abandoned` y el siguiente toque crea otro.
   - Doble toque / dos pestañas: el intento in-app activo más viejo sigue; el otro se marca abandonado y responde
     `{pending:true}` sin cobrar. Mientras un intento está activo (60 s) `card_pay` / `card_confirm` responden pending.
5. El cliente consulta `step:'card_confirm'` cada 2.5 s (hasta 2 min; "demorada" tarda ~30 s) mostrando nuestra
   animación (mascota). `card_confirm` **no cambió**: lee `GET /v1/transactions/{id}` (solo ids de la bitácora de ESTE
   pedido) y exige `status=completed`, `amount_in == price_crc` (CRC), `to == tesorería`, `deposit_memo == met:<slug>`,
   `amount_out_asset == stellar:USDC:<emisor Lendara>`, y en **Horizon** la tx: exitosa, mismo memo, pago USDC a la
   tesorería por `amount_out`. Recién ahí `mockRampFund()` (mismo camino que "Ya pagué", idempotente) → PIN → hoja
   "Pago en custodia" de siempre.
6. Errores en español, siempre con SINPE como salida: rechazada (`card_kyc_rejected`), no procesada (`card_expired`,
   `card_failed`), monto fuera de límites (`card_amount`), Lendara caído (`card_provider_down`), pago que no cuadra
   (`card_mismatch`), sin configurar (`card_unavailable`), datos inválidos (`card_input`).

Nota: el USDC de Lendara que llega a la tesorería es de prueba y no se usa; los escrows siguen fondeándose con el USDC
de la tesorería (como el SINPE simulado). En mainnet la rampa entregaría el USDC real directo.

## Respaldo: widget de Lendara (`LENDARA_MODE=widget`)

El flujo del PR #61 sigue disponible poniendo `LENDARA_MODE=widget` en Vercel (sin redeploy del cliente: `start`
devuelve `cardMode:'widget'`). Entonces "Pagar con tarjeta" llama a `step:'card_session'` y abre `@lendara/widget` en modo
modal (iframe, `lib/cardPay.ts`); al cerrar, `card_confirm` como arriba. `card_session` sigue aceptándose en modo in-app
(PWAs con el bundle viejo en caché).

## Configuración

| Variable | Dónde | Valor |
|---|---|---|
| `LENDARA_API_KEY` | Vercel (Production + Preview), sensible | `lnd_test_…` del proyecto "Meteorito" (creado con `POST /v1/projects`) |
| `LENDARA_API_URL` | opcional | default `https://lendaraweb-production.up.railway.app` |
| `LENDARA_USDC_ISSUER` | opcional | default `GBVIQ7QVTTJ4NLFTYYFPEKWYJWAMKDAOFYSR52ZGWJFSGTSVOO5H47B5` |
| `LENDARA_MODE` | opcional | `widget` = respaldo con el widget de Lendara. Sin definir = formulario propio (in-app) |
| `LENDARA_RETRY_WAIT_MS` | opcional | espera antes del reintento por arranque en frío (default 1500) |

La API de Lendara corre en el plan gratis de Railway: el primer request tras un rato puede tardar ~10-20 s (timeout 25 s).
Límite: 1-10 000 USDC después de la comisión fija de 0.50 USDC (≈ ₡765 mínimo con la tasa del sandbox de ₡510).

## Tarjetas de prueba (no se muestran en la UI)

| Tarjeta | Resultado |
|---|---|
| `4242 4242 4242 4242` | aprobada |
| `4000 0000 0000 0002` | KYC rechazado |
| `4000 0000 0000 9995` | pago no recibido (vence) |
| `4000 0000 0000 0077` | demorada 30 s, luego aprobada |

Cualquier fecha futura, cualquier CVC, nombre y correo. Otras tarjetas: "Tarjeta no aceptada". (El widget de Lendara —solo en modo respaldo— sí lista estas tarjetas porque es un sandbox.)

## Pruebas

- Unit: `scripts/ci/t51-lendara-card.test.ts` (widget + verificación) y `scripts/ci/t52-card-inapp.test.ts` (Luhn,
  marca, vencimiento, CVC, tarjeta→escenario, cliente headless con fetch simulado: token reutilizado 401, 409 al
  confirmar/pagar dos veces, arranque en frío, rechazada, no recibida, demorada, doble toque, monto forzado a price_crc).
- E2E: `e2e/mock-guest.spec.ts (MCK-CARD-01..08)` (build real + `scripts/e2e/mock-server.mjs`): aprobada, rechazada,
  demorada, no recibida, validación, iPhone SE sin scroll / ≥16 px / autocomplete / sin captura de analítica, ninguna
  request con el número o el CVC ni hacia dominios de Lendara, sin textos "Lendara"/"sandbox"/"prueba", y el respaldo widget.
- Smoke en vivo / health check: `LENDARA_API_KEY=… npx tsx scripts/lendara-smoke.ts` (`SMOKE_ALL=1` agrega la rechazada)
  usa `cardPay`/`cardConfirm` reales con una tesorería testnet desechable (friendbot) y verifica Lendara + Horizon.
  Corre todos los días en `.github/workflows/lendara-health.yml` (necesita el secreto de GitHub `LENDARA_API_KEY`).

## Futuro: procesador real (Tilopay / ONVO) y Apple Pay

Punto de extensión (no implementado):

- **Formulario**: `CardSheet` ya es nuestro. Con un procesador real, sus campos se reemplazan por los campos alojados /
  tokenizados del SDK (Tilopay SDK v2 permite inputs propios con tokenización en su JS; ONVO tiene ONVO.js con
  `paymentMethod` tokenizado). El número y el CVC siguen sin pasar por nuestro servidor (PCI SAQ A / A-EP): el navegador
  manda solo un token. `lib/card.ts` sigue sirviendo para la validación instantánea y la marca.
- **Servidor**: un `step` nuevo en `api/escrow/pay.ts` (p. ej. `card_charge {token, name, email}`) que cree el cargo con
  monto = `price_crc` de la DB e idempotency key = id del pedido, guarde el id del cargo en `order_events` (igual que
  `card_session`), y un webhook/consulta que verifique el cargo del lado del servidor antes de fondear el escrow (en
  mainnet: comprar/recibir USDC y fondear; en testnet: `mockRampFund()`). 12/12 funciones de Vercel: va en los archivos
  existentes. `cardMode` ganaría un valor nuevo (`tilopay` / `onvo`) para cambiar de procesador sin tocar la UI.
- **3DS**: Tilopay/ONVO pueden pedir un reto 3-D Secure (iframe/redirect del banco); `CardSheet` mostraría ese paso en
  el estado "procesando".
- **Apple Pay**: botón en "Elige cómo pagar" con Apple Pay JS / Payment Request API (dominio verificado en el procesador
  y HTTPS; funciona en la PWA de iOS). El token de Apple Pay va al mismo `card_charge`.
