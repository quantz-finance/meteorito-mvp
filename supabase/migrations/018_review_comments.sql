-- 018: reseñas de compra liberada. seller_ratings (010) ya guarda 1-5 estrellas, una por pedido (order_id PK).
-- Agrega el comentario opcional (máx. 280, sin links: lo valida la API) y el nombre corto público del comprador
-- ("María R."). Nunca se publica buyer_user_id. Sin esta migración la API guarda solo las estrellas.
alter table public.seller_ratings
  add column if not exists comment text,
  add column if not exists buyer_name text;

alter table public.seller_ratings drop constraint if exists seller_ratings_comment_len;
alter table public.seller_ratings add constraint seller_ratings_comment_len
  check (comment is null or char_length(comment) between 1 and 280);
alter table public.seller_ratings drop constraint if exists seller_ratings_buyer_name_len;
alter table public.seller_ratings add constraint seller_ratings_buyer_name_len
  check (buyer_name is null or char_length(buyer_name) between 1 and 24);

-- El perfil público lista las reseñas de un vendedor, más nuevas primero.
create index if not exists seller_ratings_seller_created_idx
  on public.seller_ratings (seller_user_id, created_at desc);

-- Anti-fraude (API): entre el mismo comprador (cuenta o dirección Stellar) y el mismo vendedor, una reseña cada 30 días
-- y máximo 3 en total; sin auto-reseñas. Índices para esas búsquedas.
create index if not exists orders_seller_buyer_user_idx on public.orders (seller_user_id, buyer_user_id);
create index if not exists orders_seller_buyer_address_idx on public.orders (seller_user_id, buyer_address);

notify pgrst, 'reload schema';
