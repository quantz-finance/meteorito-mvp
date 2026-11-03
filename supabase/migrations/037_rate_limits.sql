-- 037 · Límite de peticiones persistente (auditoría de seguridad, nov 2026, punto 7).
-- Los límites en memoria (fbimport/follows/chat) se reinician en cada instancia de Vercel: un atacante que reparte
-- peticiones entre instancias frías no los nota. Esto guarda un contador por ventana fija en Postgres.
--  - key: HMAC-SHA256 (hex) de ruta + IP calculado en el servidor (api/_lib/rateLimit.ts). Nunca se guarda la IP.
--  - TTL corto: cada fila vence 2 ventanas después; limpieza oportunista en la función + pg_cron cada 10 min.
--  - Solo el servidor (service role) toca la tabla y la función. RLS activo sin políticas.
-- Test: scripts/ci/t108-rate-limit.test.ts (estático + comportamiento con DB falsa).

create table if not exists public.rate_limits (
  key          text        not null check (key ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  hits         integer     not null default 0,
  expires_at   timestamptz not null,
  primary key (key, window_start)
);
create index if not exists rate_limits_expires_idx on public.rate_limits (expires_at);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from public, anon, authenticated;

-- Suma 1 hit (atómico: insert ... on conflict do update) y dice si sigue dentro del límite.
create or replace function public.rate_limit_hit(p_key text, p_max integer, p_window_seconds integer)
returns table (allowed boolean, hit_count integer, retry_after_s integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  w timestamptz;
  n integer;
begin
  if p_key !~ '^[0-9a-f]{64}$' or p_max < 1 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'rate_limit_hit: argumentos inválidos';
  end if;
  w := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits as r (key, window_start, hits, expires_at)
    values (p_key, w, 1, w + make_interval(secs => p_window_seconds * 2))
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into n;
  if random() < 0.02 then
    delete from public.rate_limits where expires_at < now();
  end if;
  return query select n <= p_max, n,
    greatest(1, ceil(extract(epoch from (w + make_interval(secs => p_window_seconds) - now())))::integer);
end;
$$;
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- Limpieza periódica (si pg_cron está, como en 004).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'meteorito-rate-limits-gc';
    perform cron.schedule('meteorito-rate-limits-gc', '*/10 * * * *', 'delete from public.rate_limits where expires_at < now()');
  end if;
end $$;
