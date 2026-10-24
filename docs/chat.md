# Chat comprador-vendedor

Mensajes de texto entre quien compra y quien vende, dentro de Meteorito. Dos entradas:

1. **Antes de comprar** — "Enviar mensaje" en la tienda `/t/<usuario>` y "Preguntar al vendedor" en la ficha de un producto
   sin pagar. La conversación queda ligada a la tienda (y al producto si vino de uno): `ctx = 'store'`.
2. **Dentro de una compra** — tarjeta en el seguimiento `/p/<pedido>` (solo en el dispositivo del comprador, con el pedido pagado)
   y "Chatear con el comprador" en la hoja del pedido en Home. Ligada al pedido: `ctx = 'order:<slug>'`.

Bandejas sin pestaña nueva: vendedor en Home (botón con insignia), comprador en Comprar › Mis compras (fila "Tus mensajes"
y punto en el icono). La insignia cuenta **conversaciones** sin leer, no mensajes.

## Privacidad

- El comprador no necesita cuenta: se identifica con la llave de invitado de su dispositivo (`guest:` + sha256) y/o su sesión Cavos.
  Nunca se guarda la llave cruda.
- Cada conversación tiene un token de 32 caracteres (base64url, 192 bits). El token solo **localiza** la conversación: cada acción
  vuelve a comprobar en el servidor que quien llama sea el comprador o el vendedor de esa conversación (si no, 404).
- El token va en el query (`/chat?c=…&r=b|s`): la analítica descarta el query, así que nunca sale en `$current_url`.
- Al vendedor se le muestra el comprador como "Comprador · XXXX" (etiqueta estable y anónima).
- Las tablas tienen RLS activado y sin permisos para `anon`/`authenticated`: solo el servidor (service role) las lee.
- Los mensajes se guardan en el servidor (Supabase). El acceso del comprador sin cuenta va ligado a la llave de su dispositivo.
- Retención: 12 meses desde el último mensaje (`chat_purge_old()`, pg_cron diario si existe). Con una disputa abierta ligada
  la conversación no se borra, y los 12 meses cuentan desde lo último entre el último mensaje y la resolución de la disputa
  (migración 026). Disputa ligada: la del pedido en el chat de una compra; en el chat de la tienda, cualquier pedido entre el
  mismo comprador y vendedor.

## Tiempo real: polling inteligente (no Supabase Realtime)

- El cliente no carga supabase-js (~400 KB) y no usamos Supabase Auth: con RLS no se pueden acotar filas por usuario, y Realtime
  pediría abrir permisos a `anon` o confiar solo en el nombre del canal.
- Con polling todo pasa por `/api/store` (ninguna función nueva: siguen 12), cada lectura se valida en el servidor y degrada
  bien sin la migración. En iOS (PWA) los sockets mueren en segundo plano; el polling se reanuda solo al volver.
- Ritmo: 2,5 s con el chat abierto y activo, 6 s tras 30 s sin actividad, 15 s tras 2 min; detenido con la pestaña oculta;
  inmediato al volver. Insignias: cada 45 s con la pantalla visible. Bandeja abierta: cada 10 s.
- "Escribiendo…" viaja en el mismo poll (`typing: true`); el servidor lo escribe como mucho cada 3 s y caduca a los 6 s.

## Avisos (web push)

Se reutiliza el push de pedidos. Se omite si la otra parte vio el chat hace menos de 25 s; después, un aviso cada 10 min
como mucho mientras no lea (si leyó desde el último aviso, vuelve a avisar).

Solo llega si esa persona activó las notificaciones en ese navegador. El vendedor tiene la tarjeta en Home; el comprador solo
la ve en el seguimiento de una compra pagada (y en iPhone solo con la app en la pantalla de inicio). Un comprador que
escribe desde una tienda o un producto normalmente no tiene push, así que el copy no promete aviso: "Su respuesta aparecerá aquí."
Ni email ni SMS.

## Abuso

1000 caracteres por mensaje; 12 mensajes por minuto por remitente (memoria + base, entre instancias) y 30 por IP para invitados;
20 conversaciones nuevas por hora. "Reportar" (spam, insultos, estafa, otro; uno por lado): solo se guarda para el equipo, la otra
parte no recibe aviso ni ve ningún cambio. El vendedor puede bloquear o desbloquear, pero **no puede bloquear** mientras
haya una compra en curso (un pedido del par que no esté liberado, resuelto o cancelado) o una disputa abierta: la opción
aparece deshabilitada con la explicación y el servidor responde 409 `chat_block_locked`. Desbloquear siempre se puede. La
disputa del comprador (`/api/escrow/dispute`, "Tengo un problema") no pasa por el chat, así que funciona aunque esté bloqueado. Si se comparte un teléfono, un correo o un link antes de pagar, aparece un aviso suave (no bloquea):
"Para que tu compra quede en custodia, paga dentro de Meteorito."

## Sin la migración 025

`GET /api/store?chat=status` responde `{ available: false }` y las acciones `chat_*` responden 503 `chat_unavailable`.
La app oculta todos los botones y bandejas; nada más cambia.

## API (`POST /api/store`)

| acción | quién | |
|---|---|---|
| `chat_open` | comprador (`store_slug` [+ `item_slug`] o `order_slug`) / vendedor (`order_slug`) | crea o retoma |
| `chat_get` | las dos partes | `full`, `after`, `before`, `typing`; marca leído; con `full`, `can_block` (vendedor) |
| `chat_send` | las dos partes | `body`, `client_id` (idempotente) |
| `chat_list` | `as: 'seller'` (sesión) / `'buyer'` (llave o sesión) | `summary: true` → `{ unread, total }` |
| `chat_block` | vendedor | `blocked: boolean`; 409 `chat_block_locked` con compra en curso o disputa abierta |
| `chat_report` | las dos partes | `reason`, `detail?` |
