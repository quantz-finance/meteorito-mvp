# Límites de riesgo

Topes y señales al publicar un link, al crear una invitación y al pagar (`api/orders/create.ts`,
`api/invites/index.ts`, `api/escrow/pay.ts`). El código vive en `api/_lib/risk.ts`.

Si algo no pasa, la API responde **403** con el texto fijo «No pudimos completar esto. Intenta más tarde.»
y el código `unavailable`. No dice cuál tope se pasó ni por qué. En el servidor queda un log `[risk]`
y, si ya hay pedido, una fila en `order_events` con `kind` `risk_limit`, `risk_velocity`, `risk_signal`
o `risk_block`.

El límite por IP de la migración 037 sigue aparte y es fail-open. Estos topes, si se vencen o si la
persona ya está bloqueada, **rechazan** la operación.

## Qué se revisa

| Señal | Default | Efecto |
| --- | --- | --- |
| Monto de un pedido | ₡5 000 000 | Rechaza y bloquea |
| Suma de esa persona en 24 h (pedidos + invitaciones) | ₡15 000 000 | Rechaza y bloquea |
| Pedidos o invitaciones por hora | 20 | Rechaza y bloquea |
| Pasos de pago que mueven dinero, por hora (`start`, `confirm_sinpe`, `card_pay`, `fund_direct`) | 30 | Rechaza y bloquea |
| Misma IP | 4 × el tope de la persona | Rechaza y bloquea a la persona y a la IP |
| Ráfaga | 8 en 10 min | Rechaza y bloquea |
| Cuenta nueva (wallet de menos de 48 h, o invitado sin pedidos) y monto sobre ₡1 500 000 | — | Rechaza y bloquea |
| Monto atípico (≥ ₡2 000 000) en una cuenta que ya tiene historia | — | Solo se anota; no bloquea |

`card_session`, `card_confirm`, `fund_xdr` y `crypto_status` vuelven a mirar bloqueo y topes de monto,
pero no suman velocity: el cliente los consulta muchas veces mientras espera, o solo piden la transacción para firmar.

La velocity usa `rate_limit_hit` (037) con una llave HMAC (no se guarda la IP). Si esa función no
está, se cuentan filas recientes. La IP solo se puede contar con 037.

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

Un disparo alto también escribe `app_flags` con clave `rb_` + 40 hex (HMAC). El valor es
`{"until":"<iso>","reason":"…"}`. Para soltar a alguien antes de tiempo, borra esa fila o pon
`until` en el pasado. La lista manual se quita sacando el id de `subjects`.

## Migración 050

`supabase/migrations/050_risk_flags.sql` solo inserta las dos filas (si no existen) y dos índices.
**No la aplica el deploy.** Hay que avisarle a Vitalik y correrla a mano después de 027.
Sin ella, los defaults del código valen igual.
