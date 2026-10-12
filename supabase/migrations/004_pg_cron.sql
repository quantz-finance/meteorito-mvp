-- 004: liberación automática 24h vía pg_cron + pg_net -> /api/escrow/cron cada 5 min.
-- PRE-REQUISITO (una vez, en SQL Editor, NO commitear el valor real):
--   select vault.create_secret('<CRON_SECRET de vercel.env>', 'meteorito_cron_secret', 'Bearer para /api/escrow/cron');
-- Para rotarlo:
--   select vault.update_secret((select id from vault.secrets where name = 'meteorito_cron_secret'), '<nuevo>');

create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.orders add column if not exists release_lock_until timestamptz;
create index if not exists orders_due_idx on public.orders (status, auto_release_at);

create or replace function public.meteorito_release_tick() returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare secret text; req_id bigint;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'meteorito_cron_secret';
  if secret is null then raise exception 'falta vault secret meteorito_cron_secret'; end if;
  -- Barato: solo llama si hay algo vencido o pendiente de liberar.
  if not exists (select 1 from orders where (status = 'enviado' and auto_release_at <= now())
                                         or (status = 'entregado' and released_tx is null)) then
    return null;
  end if;
  select net.http_get(
    url := 'https://meteorito-mvp.vercel.app/api/escrow/cron',
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret),
    timeout_milliseconds := 60000
  ) into req_id;
  return req_id;
end $$;
revoke all on function public.meteorito_release_tick() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'meteorito-release-24h';
select cron.schedule('meteorito-release-24h', '*/5 * * * *', $$select public.meteorito_release_tick()$$);
