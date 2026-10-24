-- 026: retención del chat en pausa mientras haya una disputa abierta (revisión legal, Neo).
-- Idempotente: solo reemplaza la función chat_purge_old() de 025 (create or replace). NO la aplica el deploy: se corre a
--   mano en el SQL Editor de Supabase DESPUÉS de 025. El job de pg_cron 'meteorito-chat-retention' (025) sigue igual: llama
--   a esta misma función, así que no hay que reprogramarlo.
-- Regla: una conversación se borra (con sus mensajes y reportes, por cascada) 12 meses después de lo ÚLTIMO entre:
--   (a) su último mensaje (o su creación si no tiene mensajes) y (b) la resolución de una disputa ligada.
--   Mientras haya una disputa ligada ABIERTA no se borra nunca.
-- Disputas ligadas:
--   - conversación de una compra (order_slug): la disputa de ESE pedido;
--   - conversación de la tienda (antes de comprar, order_slug null): cualquier pedido entre el MISMO comprador y vendedor.
-- Disputa abierta: pedido en 'en_disputa' o fila de disputes en 'pending'/'open' (005). Resuelta: disputes.resolved_at u
--   orders.resolved_at (se toma la más reciente).

create or replace function public.chat_purge_old() returns bigint
language sql security definer set search_path = public as $$
  with linked as (
    select c.id,
           coalesce(c.last_message_at, c.created_at) as last_at,
           o.status as order_status,
           d.state  as dispute_state,
           greatest(o.resolved_at, d.resolved_at) as resolved_at
      from public.chat_conversations c
      left join public.orders o
        on (c.order_slug is not null and o.slug = c.order_slug)
        or (c.order_slug is null and o.buyer_user_id = c.buyer_id and o.seller_user_id = c.seller_user_id)
      left join public.disputes d on d.order_id = o.id
  ), conv as (
    select id,
           bool_or(order_status = 'en_disputa' or dispute_state in ('pending', 'open')) as dispute_open,
           greatest(max(last_at), max(resolved_at)) as retain_from
      from linked
     group by id
  ), gone as (
    delete from public.chat_conversations c
     using conv
     where c.id = conv.id
       and not coalesce(conv.dispute_open, false)
       and conv.retain_from < now() - interval '12 months'
    returning 1
  ) select count(*) from gone;
$$;
revoke all on function public.chat_purge_old() from public, anon, authenticated;

notify pgrst, 'reload schema';
