-- 031: redes del vendedor en su tienda (Instagram, TikTok, Facebook, X, YouTube y un sitio web), públicas en /t/<usuario>.
-- Idempotente. La app funciona SIN esta migración: no se muestran redes y guardarlas responde 503 socials_unavailable.
-- Solo links canónicos https (los normaliza y valida api/_lib/socials.ts); aquí un tope de forma y tamaño.
alter table public.seller_profiles add column if not exists socials jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'seller_profiles_socials_chk') then
    alter table public.seller_profiles add constraint seller_profiles_socials_chk
      check (socials is null or (jsonb_typeof(socials) = 'object' and pg_column_size(socials) <= 2048));
  end if;
end $$;

notify pgrst, 'reload schema';
