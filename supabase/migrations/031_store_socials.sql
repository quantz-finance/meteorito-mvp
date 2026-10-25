-- 031: redes del vendedor (+ admin_audit para borrarlas si las reportan) en su tienda (Instagram, TikTok, Facebook, X, YouTube y un sitio web), públicas en /t/<usuario>.
-- Idempotente. La app funciona SIN esta migración: no se muestran redes y guardarlas responde 503 socials_unavailable.
-- Solo links canónicos https (los normaliza y valida api/_lib/socials.ts); aquí un tope de forma y tamaño.
alter table public.seller_profiles add column if not exists socials jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'seller_profiles_socials_chk') then
    alter table public.seller_profiles add constraint seller_profiles_socials_chk
      check (socials is null or (jsonb_typeof(socials) = 'object' and pg_column_size(socials) <= 2048));
  end if;
end $$;

-- Auditoría de acciones del admin (p. ej. borrar redes reportadas): qué y a quién, NUNCA los links. Solo el servicio.
create table if not exists public.admin_audit (
  id          bigserial primary key,
  kind        text not null check (char_length(kind) between 1 and 60),
  admin_email text not null check (char_length(admin_email) <= 200),
  target      text not null check (char_length(target) <= 200),
  detail      jsonb check (detail is null or pg_column_size(detail) <= 2048),
  created_at  timestamptz not null default now()
);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated;

notify pgrst, 'reload schema';
