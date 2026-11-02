-- Verificación en vivo (solo lectura) de C1: debe devolver 0 filas.
-- Uso: psql "$SUPABASE_DB_URL" -f scripts/ci/sql/assert-view-grants.sql   (o pegarlo en el SQL editor de Supabase)
select r.rol as grantee, c.relname as relation, p.priv as privilege
from pg_class c
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
cross join (values ('anon'), ('authenticated')) r(rol)
cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
where (c.relkind in ('v', 'm') or (c.relkind = 'r' and c.relname = 'last_seen_consents'))
  and has_table_privilege(r.rol, c.oid, p.priv)
order by 1, 2, 3;
