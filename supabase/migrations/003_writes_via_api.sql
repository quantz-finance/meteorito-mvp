-- 003: todas las escrituras pasan por /api (JWT Cavos verificado server-side + prueba de dirección).
-- anon/authenticated ya no insertan ni actualizan orders. Lecturas públicas siguen por la vista.
drop policy if exists orders_insert_anon on public.orders;
revoke insert, update, delete on public.orders from anon, authenticated;

-- La edición del vendedor por RPC (001) confiaba en un parámetro: se revoca hasta moverla a /api.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'seller_update%' loop
    execute format('revoke execute on function %s from anon, authenticated', f.sig);
  end loop; end $$;

-- Storage: fotos solo vía upload firmado desde /api sería lo ideal; MVP mantiene la policy de 001 (TODO).
