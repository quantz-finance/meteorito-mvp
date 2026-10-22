-- 010: tienda personal del vendedor (/t/<usuario>) + calificaciones 1-5 por pedido.
-- 100% aditiva: solo CREATE ... IF NOT EXISTS, vistas nuevas y grants. No toca tablas ni vistas existentes.
-- Escrituras SOLO por la API (service role). anon/authenticated no leen las tablas; la tienda pública sale de vistas
-- que exponen únicamente nombre, usuario, puntuación y productos disponibles (sin correo, teléfono ni dirección Stellar).

create table if not exists public.seller_profiles (
  sub          text primary key,                                   -- sub de Cavos del vendedor
  store_slug   text not null unique check (store_slug ~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$'),
  display_name text not null check (char_length(display_name) between 1 and 40),
  verified     boolean not null default false,                     -- futuro: vendedor registrado con cédula (hoy no se muestra)
  verified_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.seller_profiles enable row level security;
revoke all on public.seller_profiles from anon, authenticated;

create table if not exists public.seller_ratings (
  order_id       uuid primary key references public.orders (id),   -- una sola calificación por pedido
  order_slug     text not null,
  seller_user_id text not null,
  buyer_user_id  text not null,
  stars          smallint not null check (stars between 1 and 5),
  created_at     timestamptz not null default now()
);
create index if not exists seller_ratings_seller_idx on public.seller_ratings (seller_user_id);
alter table public.seller_ratings enable row level security;
revoke all on public.seller_ratings from anon, authenticated;

-- Vista pública de la tienda: nombre, usuario, puntuación. `verified` queda disponible para el futuro check.
create or replace view public.public_stores
with (security_invoker = false) as
select p.store_slug, p.display_name, p.verified,
       coalesce(r.n, 0)::int as rating_count,
       r.avg_stars as rating_avg
from public.seller_profiles p
left join (
  select seller_user_id, count(*) as n, round(avg(stars)::numeric, 2) as avg_stars
  from public.seller_ratings group by seller_user_id
) r on r.seller_user_id = p.sub;
grant select on public.public_stores to anon, authenticated;

-- Productos publicados y disponibles (status 'creado', no reservados por una invitación de compra).
create or replace view public.public_store_items
with (security_invoker = false) as
select p.store_slug, o.slug,
       nullif(trim(coalesce(o.brand, '') || ' ' || coalesce(o.model, '')), '') as title,
       o.price_crc, o.photos[1] as photo, o.created_at
from public.orders o
join public.seller_profiles p on p.sub = o.seller_user_id
where o.status = 'creado'
  and not exists (select 1 from public.invitations i where i.order_slug = o.slug);
grant select on public.public_store_items to anon, authenticated;
