# Panel de disputas (admin)

Ruta: `/admin/disputas` (lista) y `/admin/disputa?slug=…` (detalle). Entrada: icono de martillo en el header de Home, **solo** si el
servidor dice que eres admin (`admin_me`). No hay 4.ª pestaña.

## Quién es admin
- `ADMIN_EMAILS` (separados por coma). Si no está, el default en código es `bobbyaliensshop@gmail.com`.
- Se valida en el servidor contra el token Cavos verificado (`requireCavosUser`): el claim `email` del JWT, nunca el body.
  `email_verified: false` nunca es admin. Sin sesión → 401; con sesión y no admin → **404** (no revela que existe).
- Todo vive como acciones de `api/escrow/dispute.ts` (límite de 12 funciones): `admin_me`, `admin_list`, `admin_get`,
  `admin_ai`, `admin_decide`, `admin_guest_refund`, y para el vendedor `seller_response_get` / `seller_respond`.

## Reglas (capa B/D, `api/_lib/disputeRules.ts`, puras)
| regla | condición | sugerencia |
|---|---|---|
| `sin_envio` | pagado hace ≥ 3 días, envío (no cara a cara) y nunca marcado como enviado | reembolso 100 % |
| `envio_sin_prueba` | marcado como enviado sin foto ni guía | reembolso 100 % |
| `vendedor_sin_respuesta` | 48 h desde la disputa sin respuesta del vendedor (requiere 027) | reembolso 100 % |

Devuelven `{ rule, outcome, buyerPct, title, why }`. `DISPUTES_AUTO_RESOLVE` / `app_flags.disputes_auto_resolve` (default
**apagado**): si se enciende **y** el servidor tiene `DISPUTE_RESOLVER_SECRET`, el cron resuelve las disputas con regla.

## IA (capa E, `api/_lib/disputeAi.ts`)
Vercel AI Gateway (`https://ai-gateway.vercel.sh/v1`, modelo `DISPUTES_AI_MODEL`, default `anthropic/claude-haiku-4.5`).
Credencial: `AI_GATEWAY_API_KEY` o el token OIDC de Vercel. Sin credencial: "Resumen IA no disponible". `DISPUTES_AI=0` la apaga.
Al modelo van solo datos mínimos: producto, monto, motivo, horas relativas, si hay foto/guía, textos con correos, teléfonos,
IBAN, links y direcciones Stellar tapados. Nunca ids, correos ni teléfonos del comprador. Caché por disputa (hash de la entrada)
en `dispute_ai_summaries` (027); sin 027 se genera solo al tocar el botón.

## Decisión
Reembolsar / Liberar al vendedor / Dividir (1–99 %) + nota obligatoria + confirmación. Ejecuta la misma resolución que
`scripts/resolve-dispute.ts` (`api/_lib/disputeResolve.ts`), audita (quién, correo, cuándo, por qué, regla, recomendación IA,
tx) en `dispute_decisions` (027) **y siempre** en `order_events`, actualiza pedido/disputa y avisa a las dos partes (push
`resuelto`). Comprador invitado con parte > 0: su parte llega a la wallet de la plataforma y queda la tarea "Pendiente devolver
al comprador" hasta marcarla como devuelta.

**Secreto del resolver:** sin `DISPUTE_RESOLVER_SECRET` en el servidor (default, como siempre), la decisión queda como
`pending_onchain` y el panel muestra el comando exacto del script. Con el secreto, el panel ejecuta on-chain. Trade-off:
desplegarlo amplía la superficie (quien comprometa el servidor puede resolver disputas abiertas); `DISPUTE_RESOLVER_PUBLIC`
se valida contra el secreto.

## Sin la migración 027
Todo funciona: auditoría en `order_events`, sin respuesta del vendedor (la UI la oculta, la regla de 48 h no aplica y las
disputas abiertas van a "Necesitan decisión"), IA sin caché, flags solo por env.
