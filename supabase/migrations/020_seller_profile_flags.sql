-- 020: banderas del perfil del vendedor + índices del buscador del feed.
-- listed_in_feed: moderación. false = el vendedor no sale en el feed de Comprar (su perfil y links siguen funcionando).
-- whatsapp_public: el vendedor eligió mostrar su WhatsApp (contact_phone, 016) en su perfil público. Por defecto NO:
--   sin opt-in el número solo lo ve quien ya pagó (acción seller_contact).
alter table public.seller_profiles
  add column if not exists listed_in_feed boolean not null default true,
  add column if not exists whatsapp_public boolean not null default false;

-- Buscador del feed: ILIKE '%…%' (con comodín en vocales para ignorar tildes) sobre marca, modelo y descripción del
-- producto y el nombre del vendedor. pg_trgm hace que esos ILIKE usen índice. Solo acelera: sin esto, funciona igual.
create extension if not exists pg_trgm with schema extensions;
create index if not exists orders_brand_trgm_idx on public.orders using gin (brand extensions.gin_trgm_ops);
create index if not exists orders_model_trgm_idx on public.orders using gin (model extensions.gin_trgm_ops);
create index if not exists orders_description_trgm_idx on public.orders using gin (description extensions.gin_trgm_ops);
create index if not exists seller_profiles_display_name_trgm_idx on public.seller_profiles using gin (display_name extensions.gin_trgm_ops);
-- Página del feed: productos activos, más nuevos primero.
create index if not exists orders_feed_idx on public.orders (created_at desc)
  where kind = 'listing' and status = 'creado' and listing_slug is null;

notify pgrst, 'reload schema';
