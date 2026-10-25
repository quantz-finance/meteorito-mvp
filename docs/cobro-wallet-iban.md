# Dónde cobra el vendedor (migración 029)

En "Arma un gran perfil" / Mi tienda → **Dónde cobrar**:

| Opción | Qué pasa al liberarse la venta |
|---|---|
| **Recibir USDC en tu wallet Stellar** | El escrow libera directo a esa dirección (receiver de Trustless Work). Validamos `G…` (checksum), que la cuenta exista y que tenga trustline USDC. Sin trustline se guarda con aviso y, mientras tanto, el escrow libera a la cuenta de Meteorito (Cavos) del vendedor. |
| **Recibir en tu cuenta (IBAN)** | El escrow libera a la wallet `platform`. Queda una fila `pendiente` en `payout_queue` y el admin la ve en **/admin/pagos** ("Beta: sin pago al banco") y toca **Marcar como revisado** con una nota. En la beta no hay pago al banco. |
| Sin elegir (o sin 029) | Como siempre: la cuenta Stellar del vendedor en Meteorito. |

- El receiver se fija **al desplegar el escrow** (cuando el comprador inicia el pago). Cambiar la opción aplica a ventas nuevas.
- Disputas: la parte del vendedor va a `orders.payout_address` (o `seller_address`); con IBAN también entra a la cola.
- API: `/api/store` `payout_get` (→ `choice`), `payout_set {method:'wallet', stellar_address}` / `{iban, holder_name, sinpe_phone?}`, `payout_check`.
  Admin: `/api/escrow/dispute` `admin_payouts`, `admin_payout_reviewed {slug, note}` (alias viejo `admin_payout_paid`) (ADMIN_EMAILS). Siguen siendo 12 funciones.
- Sin 029: `choice:false`, solo Cuenta IBAN (registro, como antes), `admin_payouts` → `available:false`, liberar igual que hoy.
- Requisito: la wallet `PLATFORM_PUBLIC` necesita trustline USDC (si no, la opción IBAN cae a la cuenta de Meteorito).

## Automatizar los pagos a IBAN
Hace falta un off-ramp USDC → colones con salida SINPE/IBAN en Costa Rica (anchor SEP-24/SEP-31 de Stellar o un proveedor
con API de payouts locales). Lendara hoy es solo on-ramp. Con eso, `payout_queue` pasaría de "pendiente" a "enviado" por API.

Pruebas: `scripts/ci/t89-cobro-wallet-iban.test.ts`, `e2e/cobro.spec.ts`.

## Beta en testnet: la Cuenta IBAN es un dato de ejemplo (revisión legal, Neo)
- El flujo IBAN sigue armado (elección, `payout_queue`, /admin/pagos), pero **nunca se guarda una cuenta real**: `payout_set`
  descarta lo que llegue y guarda `iban='CR00000000000000000000'`, `holder_name='Dato de ejemplo'`, `sinpe_phone='00000000'`
  (cumplen `^CR[0-9]{20}$` y `^[0-9]{8}$`). La cola copia siempre el mismo dato de ejemplo.
- La app manda solo `{action:'payout_set', method:'iban'}`. Los campos vienen prellenados, de solo lectura y con `ph-no-capture`
  (clase + `data-ph-no-capture`). PostHog: `autocapture:false`, `disable_session_recording:true`, `maskAllInputs` como respaldo.
- No hay pagos al banco. "Marcar como revisado" solo guarda la nota (update en `payout_queue` + evento `payout_reviewed`), sin proveedor de pagos. Compatibilidad: el estado guardado sigue siendo `pagado` (se muestra "Revisado") y los eventos viejos `payout_paid` cuentan igual (`PAYOUT_REVIEWED_KINDS`).
- No se tocan datos existentes en la base.
- Pruebas: `scripts/ci/t90-neo-testnet-privacy.test.ts` y `e2e/cobro.spec.ts` (COB-01).
