-- 030: producto en el hilo del chat, estilo Messenger. El primer mensaje del comprador desde la ficha de un producto
--   (o el primero por un producto nuevo de la misma tienda) guarda su slug: la app dibuja la tarjeta del producto (foto,
--   título, precio, abre /p/<slug>) pegada a ese mensaje. La foto, el título y el precio salen de orders al leer (no se
--   copian). La bandeja del vendedor ya muestra el producto con chat_conversations.item_slug / subject / item_photo (025).
-- Idempotente: se puede correr más de una vez. NO la aplica el deploy: se corre a mano en el SQL Editor de Supabase.
-- Sin esta migración la app funciona igual (api/_lib/chat.ts lee y escribe sin la columna): solo no hay tarjetas dentro
--   del hilo, queda la tarjeta fija de arriba.
-- Privacidad: igual que 025 (RLS encendido, sin grants para anon/authenticated; solo el servicio lee y escribe).

alter table public.chat_messages add column if not exists item_slug text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chat_messages_item_slug_check') then
    alter table public.chat_messages add constraint chat_messages_item_slug_check check (item_slug is null or item_slug ~ '^[a-z0-9]{6}$');
  end if;
end $$;

-- Última tarjeta de la conversación (para no repetirla en cada mensaje): índice parcial, solo filas con producto.
create index if not exists chat_messages_item_idx on public.chat_messages (conversation_id, id desc) where item_slug is not null;

notify pgrst, 'reload schema';
