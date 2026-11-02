-- C1 (auditoría de seguridad, nov 2026): las vistas públicas aceptaban escrituras con la key pública.
--  - Las migraciones solo hacían `grant select` sobre las vistas, pero los privilegios por defecto de Supabase en `public`
--    les dan ALL a anon y authenticated. public.public_orders es auto-actualizable (vista simple sobre orders) y su dueño
--    (postgres) salta RLS, así que con la publishable key se podía INSERT/UPDATE/DELETE en orders vía /rest/v1/public_orders.
--  - public_stores y public_store_items no son actualizables (JOIN/GROUP BY), pero tenían los mismos grants: se limpian igual.
--  - last_seen_consents (023) es solo del servidor (service role, api/_lib/activity.ts): se le quita todo a anon/authenticated.
--
-- SECURITY DEFINER vs security_invoker: las vistas SIGUEN siendo security definer (security_invoker=false) a propósito.
--   Las tablas base (orders, seller_profiles, seller_ratings, invitations) tienen RLS activo SIN políticas (deny-all) y sin
--   grants para anon. Con security_invoker=true, anon leería como sí mismo y las vistas devolverían 0 filas (o 42501):
--   se rompería la página de pago (lib/orders.ts lee public_orders con la key pública). Las vistas ya exponen solo
--   columnas públicas; el riesgo real eran las escrituras, que se cierran aquí. El advisor `security_definer_view` seguirá
--   en ERROR hasta un paso 2 (funciones security definer de solo lectura o políticas SELECT por columnas).
--
-- Además: search_path fijo en las 5 funciones de trigger (advisor function_search_path_mutable) y default privileges sin
-- escritura para anon/authenticated en tablas/vistas nuevas de `public` (SELECT por defecto se mantiene: las tablas usan RLS).
-- Test: scripts/ci/t102-vistas-sin-escritura.test.ts (estático) + el bloque de verificación al final de esta migración.

-- 1) Vistas públicas: solo lectura.
revoke insert, update, delete, truncate, references, trigger on public.public_orders      from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.public_stores      from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.public_store_items from public, anon, authenticated;
grant select on public.public_orders, public.public_stores, public.public_store_items to anon, authenticated;

-- 2) last_seen_consents: solo el servidor (service role).
revoke all on public.last_seen_consents from public, anon, authenticated;

-- 3) Objetos nuevos que cree postgres en public: sin escritura por defecto para anon/authenticated.
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from public, anon, authenticated;

-- 4) search_path fijo en las funciones de trigger (no son security definer; mismo valor que el resto del repo).
alter function public.orders_immutable_guard()   set search_path = public;
alter function public.orders_status_guard()      set search_path = public;
alter function public.orders_escrow_immutable()  set search_path = public;
alter function public.orders_dispute_immutable() set search_path = public;
alter function public.seller_follows_cap()       set search_path = public;

-- 5) Verificación: si anon/authenticated conserva cualquier escritura sobre una vista de public o sobre
--    last_seen_consents, la migración falla (y se revierte) en vez de dejar la base abierta.
do $$
declare bad text;
begin
  select string_agg(format('%s.%s:%s', r.rol, c.relname, p.priv), ', ') into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  cross join (values ('anon'), ('authenticated')) r(rol)
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
  where (c.relkind in ('v', 'm') or (c.relkind = 'r' and c.relname = 'last_seen_consents'))
    and has_table_privilege(r.rol, c.oid, p.priv);
  if bad is not null then
    raise exception 'vistas públicas con escritura para anon/authenticated: %', bad;
  end if;
end $$;

notify pgrst, 'reload schema';
