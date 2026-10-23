-- Meteorito MVP — 012: productos permanentes (un link se vende muchas veces) + fotos en invitaciones.
-- 100% ADITIVA: solo ADD COLUMN (con default), índices nuevos, CREATE OR REPLACE de vistas (mismas columnas + columnas
-- nuevas al final, como pide Postgres) y una función nueva. Nada de DROP ni cambios de tipo. Los pedidos existentes
-- quedan como siempre (kind='single').
--
-- Modelo:
--   kind='listing': producto permanente en /p/<slug>. Nunca se fondea; siempre queda en status 'creado'.
--   Cada comprador que empieza a pagar crea un pedido hijo (kind='single', listing_slug=<slug del producto>) con su
--   propio escrow. El producto sigue disponible.
--   listing_status: 'activa' | 'pausada' | 'archivada' (se cambia desde Mi tienda). stock null = ilimitado.

alter table public.orders add column if not exists kind text not null default 'single';
alter table public.orders add column if not exists listing_slug text;
alter table public.orders add column if not exists listing_status text not null default 'activa';
alter table public.orders add column if not exists stock integer;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_kind_chk') then
    alter table public.orders add constraint orders_kind_chk check (kind in ('single', 'listing')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_listing_status_chk') then
    alter table public.orders add constraint orders_listing_status_chk check (listing_status in ('activa', 'pausada', 'archivada')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_stock_chk') then
    alter table public.orders add constraint orders_stock_chk check (stock is null or stock >= 0) not valid;
  end if;
end $$;

create index if not exists orders_listing_idx on public.orders (listing_slug, buyer_user_id) where listing_slug is not null;

-- Invitación del comprador: fotos opcionales (máx. 4), igual que la creación del vendedor.
alter table public.invitations add column if not exists photos text[] not null default '{}';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'invitations_photos_chk') then
    alter table public.invitations add constraint invitations_photos_chk check (cardinality(photos) <= 4) not valid;
  end if;
end $$;

-- Página pública: mismas columnas que 005 + kind/listing_slug/listing_status al final.
create or replace view public.public_orders
with (security_invoker = false) as
select slug, category, brand, model, condition, price_crc, description, photos, status,
       case when identifier is null or identifier = '' then null
            else '••••' || right(identifier, 4) end as identifier_masked,
       checks as checks_summary, created_at,
       amount_usdc, contract_id, funded_tx, shipped_tx, released_tx, approval_reason, auto_release_at,
       disputed_at, dispute_tx, resolved_tx,
       kind, listing_slug, listing_status
from public.orders;
grant select on public.public_orders to anon, authenticated;

-- Tienda pública: productos activos. Excluye pedidos hijos (son de un comprador) y productos pausados/archivados.
create or replace view public.public_store_items
with (security_invoker = false) as
select p.store_slug, o.slug,
       nullif(trim(coalesce(o.brand, '') || ' ' || coalesce(o.model, '')), '') as title,
       o.price_crc, o.photos[1] as photo, o.created_at
from public.orders o
join public.seller_profiles p on p.sub = o.seller_user_id
where o.status = 'creado'
  and o.listing_slug is null
  and o.listing_status = 'activa'
  and not exists (select 1 from public.invitations i where i.order_slug = o.slug);
grant select on public.public_store_items to anon, authenticated;

-- Pedidos del vendedor con el tipo (producto / pedido de un comprador). La v1 queda igual.
create or replace function public.seller_orders_v2(p_seller_address text)
returns table (slug text, category text, brand text, model text, price_crc bigint,
               status text, identifier_masked text, created_at timestamptz,
               kind text, listing_slug text, listing_status text)
language sql stable security definer set search_path = public as $$
  select o.slug, o.category, o.brand, o.model, o.price_crc, o.status,
         case when o.identifier is null or o.identifier = '' then null else '••••' || right(o.identifier, 4) end,
         o.created_at, o.kind, o.listing_slug, o.listing_status
  from orders o where o.seller_address = p_seller_address
  order by o.created_at desc limit 200;
$$;
revoke all on function public.seller_orders_v2(text) from public;
grant execute on function public.seller_orders_v2(text) to anon, authenticated;
