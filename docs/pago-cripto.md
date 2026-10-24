# Pago con cripto (USDC o XLM en Stellar)

La tarjeta (Lendara) sigue siendo el camino principal. Debajo aparece un botón chico **Cripto** que abre
"Pagar con cripto · Por ahora solo USDC o XLM en Stellar." Funciona igual para invitados y para cuentas.

## Flujo

1. `POST /api/escrow/pay {step:'start'}` despliega el escrow (igual que hoy) y devuelve `crypto: true|false`.
2. `{step:'crypto_quote', asset:'USDC'|'XLM', buyer?}` → destino (tesorería), memo `MET-<SLUG>`, monto, vencimiento,
   link SEP-7 `web+stellar:pay` y, si mandas la dirección del comprador con XLM, un `pathTx` (XDR + `web+stellar:tx`).
3. La pantalla consulta `{step:'crypto_status'}` cada 4 s. El backend lee los pagos de la tesorería en Horizon
   (memo + activo) y responde `waiting | underpaid | expired | processing | funded`.
4. Cuando llega el monto: la tesorería fondea **el mismo escrow en USDC** con `mockRampFund(..., {locked:true})`,
   igual que con tarjeta o SINPE. El pedido pasa a `fondeado`.
5. El cron (`/api/escrow/cron`) repite el paso 3 para pedidos con cotización en las últimas 24 h, por si el comprador cerró la pantalla.

¿Por qué la tesorería y no el contrato? Un pago clásico de Stellar no puede ir directo a un contrato Soroban con memo.
La tesorería recibe, identifica el pedido por memo y fondea el escrow; así todo método termina en el mismo escrow en USDC.

## XLM

- **Path payment (recomendado):** el comprador pone su dirección; firmamos un `pathPaymentStrictReceive` suyo que entrega
  USDC exacto a la tesorería (`sendMax` = cotización con colchón). Se abre con SEP-7 `web+stellar:tx`.
- **QR + memo (cualquier wallet):** paga XLM; la tesorería lo convierte con un path payment a sí misma
  (`destAmount` = USDC exacto, `sendMax` = XLM recibido) y devuelve el sobrante si supera 0.1 XLM.
- Colchón: `CRYPTO_XLM_SLIPPAGE` (0.03). Vigencia de la cotización: `CRYPTO_QUOTE_MINUTES` (15).

## Casos borde

| Caso | Qué pasa |
|---|---|
| Pago menor | `underpaid` con lo que falta; puede completar con el mismo memo (se suman). Si nunca completa, la devolución es manual (admin). |
| Pago mayor | Se fondea el monto y el exceso vuelve al que pagó (> 0.01 USDC / 0.1 XLM). |
| Cotización vencida (XLM) | `expired`; botón "Actualizar precio". Si paga XLM igual, se convierte al precio del momento si alcanza; si no, queda `underpaid` y puede completar. |
| Pago después de fondear | Se devuelve completo al que pagó. |
| Dos consultas a la vez | Lock en `ramp_mock_payments` (PK `order_id`): una sola fondea. |
| Falla la conversión | Se libera el lock y se reintenta en la siguiente consulta. |

Estado: solo `order_events` (`crypto_quote`, `crypto_converted`, `crypto_refund`, `funded`) y `ramp_mock_payments`. **Sin migración.**

## Variables

- `CRYPTO_PAY=0` apaga el botón. Requiere `TREASURY_SECRET` (ya existe para tarjeta/SINPE).

## Pruebas

- `scripts/ci/t88-crypto-pay.test.ts` (unitaria, deps inyectadas).
- `e2e/crypto.spec.ts` (demo, iPhone SE).
- `scripts/crypto-testnet-e2e.ts` (manual, TESTNET real: USDC, path payment XLM y XLM convertido, cada uno fondeado y liberado).
- Ojo: LOBSTR no abre links de testnet; para probar SEP-7 usa una wallet con testnet (p. ej. Freighter).
