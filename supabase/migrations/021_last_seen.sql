-- 021: última conexión del vendedor (estilo P2P: "En línea", "Activo hace 15 min"...). Idempotente.
-- last_seen_at: la API la actualiza cuando el usuario con sesión abre o usa la app, como máximo 1 vez cada 5 min
--   (UPDATE condicional). Nunca sale de la API: al público solo le llega un rango grueso (Ley 8968).
-- show_last_seen: el vendedor la muestra o la oculta desde Mi cuenta. Por defecto se muestra.
-- Sin esta migración la app funciona igual y no muestra nada.
alter table public.seller_profiles
  add column if not exists last_seen_at timestamptz,
  add column if not exists show_last_seen boolean not null default true;

notify pgrst, 'reload schema';
