# Invitación de compra (el comprador inicia)

Ambos lados pueden iniciar una operación:

- **Vendedor**: publica el artículo y comparte `/p/<slug>` (flujo de siempre).
- **Comprador**: crea una **invitación** (`/i/nueva`, sin cuenta) con qué quiere, a qué precio y una nota. Recibe `/i/<code>` para mandarle al vendedor.
  Puede precargarla pegando el link de un anuncio de Facebook Marketplace (ver `facebook-import.md`); el link queda en
  `invitations.source_url` (migración 015) y la foto del anuncio en `invitations.photos`.

## Flujo
1. Comprador → `POST /api/invites {op:'create'}` con su llave de invitado (`X-Guest-Key`, ver `guest-checkout.md`). Estado `abierta`.
2. Vendedor abre `/i/<code>` (vista de vendedor, pública), entra con Cavos y toca **Publicar para esta compra**: el formulario de venta se precarga (nombre, precio y las fotos de la invitación, que puede quitar o completar).
3. `POST /api/orders/create` con `invite: <code>`: exige invitación `abierta`, **mismo precio** acordado y que no sea del propio vendedor; las fotos pueden ser propias o de la invitación; al insertar el pedido, marca la invitación `aceptada` y guarda `order_slug` (una invitación = una publicación).
4. El link de pago del pedido queda **reservado** a quien invitó: `POST /api/escrow/pay start` rechaza (403 `invite_reserved`) a cualquier otra llave de invitado. El comprador ve en `/i/<code>` el botón **Ir a pagar en custodia** (se actualiza solo cada 7 s).
5. Desde ahí es el flujo normal (pago en custodia, PIN, envío, liberación/disputa).

## Sincronización entre ambos lados
Servidor centralizado + polling (`lib/refresh.ts`, `POLL_MS = 7000`, `lib/useOrdersRefresh.ts`): pausa en pestañas ocultas, refetch al volver el foco, y se detiene cuando el pedido está en estado final. La pantalla del comprador (`/p/<slug>`, `/i/<code>`) y la del vendedor (**Mis pedidos**) muestran **"Actualizado hace Xs · se actualiza solo"** (`components/Freshness.tsx`), en ámbar con "reintentando" si pasan 3 ciclos sin respuesta. No hay realtime por websockets (decisión: polling de 7 s es suficiente para este MVP y no agrega dependencias).

## Requiere migración
`supabase/migrations/015_invite_source_url.sql` (columna `invitations.source_url`, opcional). Sin ella todo funciona; solo no se guarda el link del anuncio.

`supabase/migrations/009_invitations.sql` (tabla `invitations`, RLS sin políticas: solo el API con service role). **Hay que aplicarla en Supabase** antes de usar las invitaciones; sin ella el API responde 503 `invites_unavailable` y el pago normal no se ve afectado.

## Límites
- Sin notificaciones push/email: el comprador y el vendedor se pasan el link por WhatsApp/Messenger.
- La invitación no verifica identidad de nadie; la llave de invitado vive en el navegador del comprador.
- El vendedor puede publicar solo si su wallet Cavos está activada (igual que en un listing normal).
