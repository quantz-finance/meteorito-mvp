-- 022: última conexión SOLO con consentimiento (Ley 8968, art. 5). Idempotente: se puede correr más de una vez.
-- 1) Apagada por defecto para quienes se registren desde ahora.
-- 2) Registro de consentimiento: una fila por cada cambio (encender o apagar) con usuario, valor, fecha y versión del texto
--    que vio (p. ej. 'v1-2026-10-24'). Solo la API (service role) lee y escribe: RLS activo y sin políticas.
-- 3) Apagada para todos los que no tienen un registro de consentimiento (021 la dejó en true por defecto), y sin hora
--    guardada: sin consentimiento no se guarda ni se muestra nada.
-- La API solo la muestra si show_last_seen = true Y el último registro dice true. Sin esta migración no muestra nada.
alter table public.seller_profiles
  add column if not exists last_seen_at timestamptz,
  add column if not exists show_last_seen boolean not null default false;
alter table public.seller_profiles alter column show_last_seen set default false;

create table if not exists public.last_seen_consents (
  id           bigint generated always as identity primary key,
  user_id      text not null,                  -- sub de Cavos (= seller_profiles.sub)
  value        boolean not null,               -- true = encendió, false = apagó
  text_version text not null,                  -- versión del texto que aceptó o retiró
  created_at   timestamptz not null default now()
);
create index if not exists last_seen_consents_user_created_idx on public.last_seen_consents (user_id, created_at desc);
alter table public.last_seen_consents enable row level security;

update public.seller_profiles p
   set show_last_seen = false, last_seen_at = null
 where (p.show_last_seen or p.last_seen_at is not null)
   and not exists (select 1 from public.last_seen_consents c where c.user_id = p.sub);

notify pgrst, 'reload schema';
