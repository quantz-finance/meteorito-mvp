-- 006: el app se movió a https://pago.meteorito.app; meteorito-mvp.vercel.app responde 308
-- y pg_net no sigue redirecciones. Re-define el tick con el dominio nuevo (mismo GET + Bearer de 004)
-- y re-agenda el job.
create or replace function public.meteorito_release_tick() returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare secret text; req_id bigint;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'meteorito_cron_secret';
  if secret is null then raise exception 'falta vault secret meteorito_cron_secret'; end if;
  if not exists (select 1 from orders where (status = 'enviado' and auto_release_at <= now())
                                         or (status = 'entregado' and released_tx is null)) then
    return null;
  end if;
  select net.http_get(
    url := 'https://pago.meteorito.app/api/escrow/cron',
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret),
    timeout_milliseconds := 60000
  ) into req_id;
  return req_id;
end $$;
revoke all on function public.meteorito_release_tick() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'meteorito-release-24h';
select cron.schedule('meteorito-release-24h', '*/5 * * * *', $$select public.meteorito_release_tick()$$);

-- Verificación (manual):
--   select jobid, schedule, command, active from cron.job where jobname = 'meteorito-release-24h';
--   select id, status_code, created from net._http_response order by created desc limit 5;
