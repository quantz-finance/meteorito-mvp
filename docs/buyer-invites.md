# Invitación de compra (el comprador inicia)

Ambos lados pueden iniciar una operación:

- **Vendedor**: publica el artículo y comparte `/p/<slug>` (flujo de siempre).
- **Comprador**: crea una **invitación** (`/i/nueva`, con sesión Cavos) con qué quiere, a qué precio y una nota. Recibe `/i/<code>` para mandarle al vendedor.
  Puede precargarla pegando el link de un anuncio de Facebook Marketplace (ver `facebook-import.md`); el link queda en
  `invitations.source_url` (migración 015) y la foto del anuncio en `invitations.photos`.

## Flujo
1. Comprador → `POST /api/invites {op:'create'}` con Bearer Cavos. `buyer_user_id` guarda el sub de la cuenta, no la llave del dispositivo. Estado `abierta`.
2. Vendedor abre `/i/<code>` (vista de vendedor, pública), entra con Cavos y toca **Publicar para esta compra**: el formulario de venta se precarga (nombre, precio y las fotos de la invitación, que puede quitar o completar).
3. `POST /api/orders/create` con `invite: <code>`: exige invitación `abierta`, **mismo precio** acordado y que no sea del propio vendedor; las fotos pueden ser propias o de la invitación; al insertar el pedido, marca la invitación `aceptada` y guarda `order_slug` (una invitación = una publicación).
4. El link de pago del pedido queda **reservado** a quien invitó: `POST /api/escrow/pay start` rechaza (403 `invite_reserved`) a cualquier otra cuenta. El comprador ve en `/i/<code>` el botón **Ir a pagar en custodia** (se actualiza solo cada 7 s).
5. Desde ahí es el flujo normal (pago en custodia, PIN, envío, liberación/disputa).

## Sincronización entre ambos lados
Servidor centralizado + polling (`lib/refresh.ts`, `POLL_MS = 7000`, `lib/useOrdersRefresh.ts`): pausa en pestañas ocultas, refetch al volver el foco, y se detiene cuando el pedido está en estado final. La pantalla del comprador (`/p/<slug>`, `/i/<code>`) y la del vendedor (**Mis pedidos**) muestran **"Actualizado hace Xs · se actualiza solo"** (`components/Freshness.tsx`), en ámbar con "reintentando" si pasan 3 ciclos sin respuesta. No hay realtime por websockets (decisión: polling de 7 s es suficiente para este MVP y no agrega dependencias).

## Requiere migración
`supabase/migrations/015_invite_source_url.sql` (columna `invitations.source_url`, opcional). Sin ella todo funciona; solo no se guarda el link del anuncio.

`supabase/migrations/009_invitations.sql` (tabla `invitations`, RLS sin políticas: solo el API con service role). **Hay que aplicarla en Supabase** antes de usar las invitaciones; sin ella el API responde 503 `invites_unavailable` y el pago normal no se ve afectado.

## Límites
- Sin notificaciones push/email: el comprador y el vendedor se pasan el link por WhatsApp/Messenger.
- La invitación queda ligada a la cuenta del comprador; no acredita la identidad de nadie.
- El vendedor puede publicar solo si su wallet Cavos está activada (igual que en un listing normal).

## Comprador con cuenta (noviembre 2026)
- Crear invitación, abrir `/p/<slug>`, Comprar y Mis compras requieren sesión Cavos con dirección. El Gate muestra el login sin cambiar la URL (incluye query); al entrar continúa ahí.
- GET `/api/invites` sigue público; con Bearer Cavos reconoce al comprador incluso en otro dispositivo. `cancel` mantiene ownership por cuenta y compatibilidad con llaves antiguas.
- `start` de una compra nueva exige sesión, prueba firmada `pay:<slug>`, cuenta ligada y activada para USDC. Guarda `buyer_user_id = sub Cavos` y `buyer_address = dirección Cavos`; el pago directo USDC se firma desde esa dirección. Son dos vías distintas: el fondeo simulado del ramp (SINPE/tarjeta/cripto simulado) procede de la tesorería testnet, no del saldo de la cuenta del comprador; el pago directo USDC procede de la dirección del comprador y se firma desde su cuenta Cavos. No se cambia ninguna de esas vías.
- No se crean nuevas compras de invitado. Las invitaciones y pedidos históricos `guest:` mantienen sus llaves, rutas API, custodia y disputas; la interfaz pide entrar también al consultar esos pedidos. No se borran ni reasignan datos.
- `/i/<code>` continúa público para quien vende (flag `SELLER_GUEST_ENABLED` y controles de aceptación intactos).
- Sin migración nueva. No activar el flag ni fusionar sin revisión de Harvey.
