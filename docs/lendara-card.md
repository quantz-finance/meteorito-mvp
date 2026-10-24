# Pago con tarjeta (Lendara)

El comprador (invitado o con cuenta) puede pagar con tarjeta además de SINPE Móvil. Usamos el **sandbox de
[Lendara](https://lendara-monorepo-fixh.vercel.app)** (rampa CRC → USDC sobre Stellar **testnet**, tarjetas de prueba,
no mueve dinero real). Repo: https://github.com/Lendara-Org/Lendara-monorepo (MIT).

## Flujo

1. `POST /api/escrow/pay {step:'start'}` (igual que antes) despliega el escrow y responde `card: true` si el servidor
   tiene `LENDARA_API_KEY`. Sin la variable, la UI muestra solo SINPE (como antes).
2. La hoja **"Elige cómo pagar"** ofrece **Pagar con tarjeta** (principal) y **Pagar por SINPE Móvil** (secundaria).
3. `step:'card_session'`: solo el comprador del pedido, solo en `escrow_creado`. El servidor:
   - asegura la trustline de la **tesorería** al USDC de Lendara (`GBVIQ7…H47B5`, distinto del USDC de los escrows),
   - crea `POST /v1/sessions {account: <tesorería G…>, fiat_currency:'CRC', amount: price_crc (de la DB), memo_type:'text', memo:'met:<slug>'}`,
   - guarda el id de Lendara en `order_events` (`kind='card_session'`): **no hace falta migración**.
   - Si un intento anterior ya se completó, fondea en vez de cobrar otra vez; si está en proceso (tarjeta demorada),
     responde `{pending:true}`.
4. El navegador abre `@lendara/widget` en modo **modal (iframe)**, no popup: en la PWA de iOS en pantalla completa los
   popups abiertos tras un `await` se bloquean o salen de la app. Antes de abrirlo se cierra nuestra hoja (el `Modal` de
   react-native-web atrapa el foco y el iframe no recibiría el teclado). `lib/cardPay.ts` agrega `safe-area-inset` al
   overlay en teléfonos.
5. Al completar, `step:'card_confirm'`: el servidor **no confía en el widget**. Lee `GET /v1/transactions/{id}` (solo
   ids de la bitácora de ESTE pedido) y exige: `status=completed`, `amount_in == price_crc` y `amount_in_asset=iso4217:CRC`,
   `to == tesorería`, `deposit_memo == met:<slug>`, `amount_out_asset == stellar:USDC:<emisor Lendara>`. Luego verifica
   en **Horizon** la tx `stellar_transaction_id`: exitosa, mismo memo, pago USDC (emisor Lendara) a la tesorería por
   `amount_out`. Recién ahí llama a `mockRampFund()` (el mismo camino que "Ya pagué": monto exacto del pedido en DB,
   verificado on-chain, idempotente por `ramp_mock_payments`), que registra `funded` con `ramp:'card'`, el id de Lendara
   y el hash. Avisos push: los mismos de siempre (`advance()` → `notifyOrder`).
6. Errores en español: KYC rechazado (`card_kyc_rejected`), vencido (`card_expired`), otro fallo (`card_failed`), monto
   fuera de límites (`card_amount`), Lendara caído (`card_provider_down`), pago que no cuadra (`card_mismatch`), sin
   configurar (`card_unavailable`). Siempre se puede seguir por SINPE.

Nota: el USDC de Lendara que llega a la tesorería es de prueba y no se usa; los escrows siguen fondeándose con el USDC
de la tesorería (como el SINPE simulado). En mainnet la rampa entregaría el USDC real directo.

## Configuración

| Variable | Dónde | Valor |
|---|---|---|
| `LENDARA_API_KEY` | Vercel (Production + Preview), sensible | `lnd_test_…` del proyecto "Meteorito" (creado con `POST /v1/projects`) |
| `LENDARA_API_URL` | opcional | default `https://lendaraweb-production.up.railway.app` |
| `LENDARA_USDC_ISSUER` | opcional | default `GBVIQ7QVTTJ4NLFTYYFPEKWYJWAMKDAOFYSR52ZGWJFSGTSVOO5H47B5` |

La API de Lendara corre en el plan gratis de Railway: el primer request tras un rato puede tardar ~10-20 s (timeout 25 s).
Límite: 1-10 000 USDC después de la comisión fija de 0.50 USDC (≈ ₡765 mínimo con la tasa del sandbox de ₡510).

## Tarjetas de prueba (no se muestran en la UI)

| Tarjeta | Resultado |
|---|---|
| `4242 4242 4242 4242` | aprobada |
| `4000 0000 0000 0002` | KYC rechazado |
| `4000 0000 0000 9995` | pago no recibido (vence) |
| `4000 0000 0000 0077` | demorada 30 s, luego aprobada |

Cualquier fecha futura y cualquier CVC. (El propio widget de Lendara lista estas tarjetas porque es un sandbox.)

## Pruebas

- Unit: `scripts/ci/t51-lendara-card.test.ts` (Lendara y Horizon simulados; sin red).
- E2E: `e2e/mock-guest.spec.ts (MCK-CARD-*)` (build real + `scripts/e2e/mock-server.mjs` con un widget simulado del mismo origen que
  postea `{ transaction }` como el real).
- Smoke en vivo (manual, no en CI): `LENDARA_API_KEY=… npx tsx scripts/lendara-smoke.ts /workspace/out` crea una
  tesorería desechable con friendbot, llena el widget real con la 4242 y verifica Lendara + Horizon.

## Futuro: Apple Pay

El punto de extensión es el mismo: otro `step` (p. ej. `applepay_session`) que cree el cobro con el proveedor y otro
`*_confirm` que verifique del lado del servidor y termine en `mockRampFund()` (o, en mainnet, en el fondeo con el USDC
que entregue la rampa). En la UI sería un tercer botón en "Elige cómo pagar" (Apple Pay JS / Payment Request API, que
requiere dominio verificado y HTTPS; funciona en la PWA de iOS). No implementado.
