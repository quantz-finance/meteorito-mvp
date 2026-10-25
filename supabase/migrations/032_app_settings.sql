-- 032: ajustes globales de la app (solo el servidor). Primer ajuste: demo_data_enabled = datos de ejemplo del feed
-- (productos, tiendas y ventas de ejemplo). Apagado por defecto: la app muestra solo usuarios, tiendas y publicaciones reales.
-- Lo cambia solo el admin maestro desde la app (Mi cuenta -> "Datos de ejemplo"; api/escrow/dispute.ts action admin_demo_data),
-- con auditoría en admin_audit (031, kind demo_toggle). Idempotente. Sin esta migración la app sigue igual, con los ejemplos apagados.
create table if not exists public.app_settings (
  key        text primary key check (char_length(key) between 1 and 60),
  value      jsonb not null check (pg_column_size(value) <= 2048),
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

insert into public.app_settings (key, value) values ('demo_data_enabled', 'false'::jsonb) on conflict (key) do nothing;

notify pgrst, 'reload schema';
