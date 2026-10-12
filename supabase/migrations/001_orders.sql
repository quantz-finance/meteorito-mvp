-- Meteorito MVP: link de venta (orders) — 001
-- Reglas: RLS on; anon NO lee la tabla orders; la página pública lee la vista public_orders
-- (identificador enmascarado); precio y destino del vendedor inmutables.

create extension if not exists pgcrypto;

create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9]{6}$'),
  seller_address text not null check (seller_address ~ '^G[A-Z2-7]{55}$'),
  seller_email   text,
  category       text not null,
  brand          text not null,
  model          text not null,
  condition      text not null,
  price_crc      bigint not null check (price_crc > 0),
  description    text,
  identifier     text,
  photos         text[] not null default '{}' check (cardinality(photos) <= 4),
  checks         jsonb not null default '[]'::jsonb,
  status         text not null default 'creado',
  created_at     timestamptz not null default now()
);
create index if not exists orders_seller_idx on public.orders (seller_address, created_at desc);

-- Precio y destino inmutables: cualquier cambio = link nuevo.
create or replace function public.orders_immutable_guard() returns trigger
language plpgsql as $$
begin
  if new.price_crc is distinct from old.price_crc
     or new.seller_address is distinct from old.seller_address
     or new.slug is distinct from old.slug
     or new.identifier is distinct from old.identifier then
    raise exception 'price_crc, seller_address, slug e identifier son inmutables; creá un link nuevo';
  end if;
  return new;
end $$;
drop trigger if exists orders_immutable on public.orders;
create trigger orders_immutable before update on public.orders
  for each row execute function public.orders_immutable_guard();

alter table public.orders enable row level security;
revoke all on public.orders from anon, authenticated;
grant insert on public.orders to anon, authenticated;

-- MVP: cualquiera con la anon key puede crear un link, solo con status inicial.
-- TODO: exigir JWT de Cavos y que seller_address = claim del JWT.
drop policy if exists orders_insert_anon on public.orders;
create policy orders_insert_anon on public.orders for insert to anon, authenticated
  with check (status = 'creado');
-- Sin policies de select/update/delete para anon: la tabla no se lee directamente.

-- Vista pública: sin email ni identificador completo.
create or replace view public.public_orders
with (security_invoker = false) as
select slug, category, brand, model, condition, price_crc, description, photos, status,
       case when identifier is null or identifier = '' then null
            else '••••' || right(identifier, 4) end as identifier_masked,
       checks as checks_summary,
       created_at
from public.orders;
grant select on public.public_orders to anon, authenticated;

-- Mis pedidos (MVP): lista por dirección del vendedor.
-- TODO: reemplazar el parámetro por el claim del JWT de Cavos (hoy es spoofeable: solo muestra datos ya enmascarados).
create or replace function public.seller_orders(p_seller_address text)
returns table (slug text, category text, brand text, model text, price_crc bigint,
               status text, identifier_masked text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.slug, o.category, o.brand, o.model, o.price_crc, o.status,
         case when o.identifier is null or o.identifier = '' then null else '••••' || right(o.identifier, 4) end,
         o.created_at
  from orders o where o.seller_address = p_seller_address
  order by o.created_at desc limit 100;
$$;
revoke all on function public.seller_orders(text) from public;
grant execute on function public.seller_orders(text) to anon, authenticated;

-- Edición del vendedor (MVP): solo campos no críticos, solo si coincide seller_address.
-- TODO: validar con JWT de Cavos en vez de confiar en el parámetro.
create or replace function public.seller_update_order(
  p_slug text, p_seller_address text, p_description text, p_condition text, p_photos text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  update orders set description = coalesce(p_description, description),
                    condition   = coalesce(p_condition, condition),
                    photos      = coalesce(p_photos, photos)
   where slug = p_slug and seller_address = p_seller_address and status = 'creado';
  if not found then raise exception 'pedido no encontrado o no editable'; end if;
end $$;
revoke all on function public.seller_update_order(text, text, text, text, text[]) from public;
grant execute on function public.seller_update_order(text, text, text, text, text[]) to anon, authenticated;

-- Storage: bucket público 'listings' (fotos). Lectura pública + subida anon (MVP).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listings', 'listings', true, 8388608, array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update set public = true;

drop policy if exists listings_public_read on storage.objects;
create policy listings_public_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'listings');
drop policy if exists listings_anon_insert on storage.objects;
-- TODO: limitar a carpeta del vendedor con JWT de Cavos.
create policy listings_anon_insert on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'listings');
