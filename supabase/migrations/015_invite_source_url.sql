-- 015: link del anuncio de Facebook Marketplace del que el comprador armó la invitación (Comprar → Importar de Facebook).
-- Referencia para el vendedor ("Ver anuncio en Facebook") y para soporte. 100% aditiva: una columna nullable.
-- La URL la valida la API (/api/invites op:'create'): solo https de facebook.com / fb.me, ruta /marketplace/item/ o /share/.
-- Sin esta migración la API crea la invitación igual, sin guardar el link (PostgREST PGRST204 -> se reintenta sin la columna).
alter table public.invitations add column if not exists source_url text
  check (source_url is null or (char_length(source_url) <= 1000 and source_url ~ '^https://'));
