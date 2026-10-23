-- 014: foto de la tienda del vendedor (se ve en /t/<usuario>, Mi tienda y Mi cuenta).
-- 100% aditiva: una columna nueva (nullable) y la vista pública con avatar_url AL FINAL (create or replace solo agrega).
-- La URL la valida la API: solo una imagen subida por /api/photos/upload-url a la carpeta del propio vendedor.
alter table public.seller_profiles add column if not exists avatar_url text
  check (avatar_url is null or (char_length(avatar_url) <= 400 and avatar_url ~ '^https://'));

create or replace view public.public_stores
with (security_invoker = false) as
select p.store_slug, p.display_name, p.verified,
       coalesce(r.n, 0)::int as rating_count,
       r.avg_stars as rating_avg,
       p.avatar_url
from public.seller_profiles p
left join (
  select seller_user_id, count(*) as n, round(avg(stars)::numeric, 2) as avg_stars
  from public.seller_ratings group by seller_user_id
) r on r.seller_user_id = p.sub;
grant select on public.public_stores to anon, authenticated;
