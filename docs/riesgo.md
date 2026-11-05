# Límites de riesgo

Topes y señales al publicar un link, al crear una invitación y al **iniciar** un pago
(`api/orders/create.ts`, `api/invites/index.ts`, `api/escrow/pay.ts`). El código vive en `api/_lib/risk.ts`.

Si algo no pasa, la API responde **403** con el texto fijo «No pudimos completar esto. Intenta más tarde.»
y el código `unavailable`. No dice cuál tope se pasó ni por qué. En el servidor queda un log `[risk]`
y, si ya hay pedido, una fila en `order_events` con `kind` `risk_limit`, `risk_velocity`, `risk_signal`
o `risk_block`.

## Qué se revisa y qué se bloquea

| Señal | Default | Efecto |
| --- | --- | --- |
| Monto de un pedido | ₡5 000 000 | Rechaza ese intento. No deja bloqueo. |
| Gasto del comprador en 24 h | ₡15 000 000 | Rechaza ese intento. No deja bloqueo. |
| Pedidos o invitaciones por hora (quien publica o invita) | 20 | Rechaza ese intento. No deja bloqueo. |
| Pasos que inician un pago, por hora (`start`, `confirm_sinpe`, `card_pay`, `fund_direct`) | 30 | Rechaza ese intento. No deja bloqueo. |
| Misma IP | 4 × el tope de la persona | Rechaza ese intento (la ventana de 037 es el cooldown). **No** se guarda un bloqueo de IP ni de la persona. |
| Ráfaga de la persona | 8 en 10 min | Rechaza y bloquea a esa persona (`rb_`, 24 h). |
| Cuenta nueva (wallet de menos de 48 h, o invitado sin pedidos) y monto sobre ₡1 500 000 | — | Rechaza ese intento. No deja bloqueo: es un solo intento. |
| Monto atípico (≥ ₡2 000 000) en una cuenta que ya tiene historia | — | Solo se anota. |
| Lista manual `risk_blocks` | — | Rechaza mientras el id siga en la lista. |

Un solo intento sobre un tope no escribe `rb_`. El bloqueo persistente es para la ráfaga de esa persona
y para la lista manual. Nunca para una IP.

`card_session`, `card_confirm`, `fund_xdr` y `crypto_status` **no** pasan por riesgo: son liquidación o
sondeo. Un pedido con `funded_tx`, o con un estado posterior a `escrow_creado`, tampoco: un `confirm_sinpe`
repetido sigue siendo idempotente. Reabrir un `start` que ya tiene `contract_id` no suma velocity.

Si la base no responde al **publicar**, se rechaza (fail-closed), salvo `RISK_LIMITS_DISABLED=1`.
Si no responde al **pagar**, el pago sigue y queda un log `[risk] fail-open`: un timeout no puede dejar
el dinero a medias. El sondeo del cliente (`card_confirm`, cripto) se detiene si llega `unavailable`.

## Gasto de 24 h del comprador

Cuenta pedidos **fondeados o en curso** (`escrow_creado` con escrow, `fondeado` y los estados que siguen),
por el momento del pago: `funded_at`, o si no está el evento `funded` / `escrow_deployed`. No usa
`orders.created_at` de un link viejo. No cuenta un start abandonado (`creado`), un pedido cancelado ni
las invitaciones (eso duplicaba el mismo monto).

Para un invitado el tope es un mejor esfuerzo: la identidad es `guest:<hash de la llave>`. Si borra la
llave del navegador, el contador empieza de cero.

Quien publica sigue sumando sus pedidos de las últimas 24 h por `created_at`. Quien invita suma sus
invitaciones. Esas dos sumas no entran en el gasto del pago.

La velocity usa `rate_limit_hit` (037) con una llave HMAC (no se guarda la IP). Si esa función no está,
se cuentan filas recientes. La IP solo se puede contar con 037.

## Cómo configurarlo

La fila `app_flags.risk_limits` (json) pisa los defaults. La env pisa la fila. Apagar todo:
`RISK_LIMITS_DISABLED=1` (también si la base no responde).

| json | env |
| --- | --- |
| `enabled` | `RISK_LIMITS_DISABLED=1` lo apaga |
| `max_order_crc` | `RISK_MAX_ORDER_CRC` |
| `max_daily_crc` | `RISK_MAX_DAILY_CRC` |
| `orders_per_hour` | `RISK_ORDERS_PER_HOUR` |
| `pays_per_hour` | `RISK_PAYS_PER_HOUR` |
| `new_account_hours` | `RISK_NEW_ACCOUNT_HOURS` |
| `new_account_max_crc` | `RISK_NEW_ACCOUNT_MAX_CRC` |
| `atypical_crc` | `RISK_ATYPICAL_CRC` |
| `burst_count` | `RISK_BURST_COUNT` |
| `burst_window_sec` | `RISK_BURST_WINDOW_SEC` |
| `block_hours` | `RISK_BLOCK_HOURS` |

Un número fuera de rango se ignora y queda el default. Ejemplo (SQL Editor, después de 027):

```sql
update public.app_flags
   set value = value || '{"max_order_crc":3000000,"orders_per_hour":10}'::jsonb,
       updated_at = now()
 where key = 'risk_limits';
```

Lista manual (`risk_blocks`): subs de Cavos o ids `guest:…`. No pongas IPs ni la llave del invitado.

```sql
update public.app_flags
   set value = '{"subjects":["el-sub-de-cavos"]}'::jsonb, updated_at = now()
 where key = 'risk_blocks';
```

Una ráfaga también escribe `app_flags` con clave `rb_` + 40 hex (HMAC de la persona, no de la IP). El valor es
`{"until":"<iso>","reason":"burst"}`. Para soltar a alguien antes de tiempo, borra esa fila o pon
`until` en el pasado. Las filas vencidas se borran solas al pasar un chequeo. La lista manual se quita
sacando el id de `subjects`.

## Migración 050

`supabase/migrations/050_risk_flags.sql` solo inserta las dos filas (si no existen) y los índices
(pedidos por vendedor, pedidos por comprador, e invitaciones por comprador — el mismo índice que 009).
**No la aplica el deploy.** Hay que avisarle a Vitalik y correrla a mano después de 027.
Sin ella, los defaults del código valen igual.
