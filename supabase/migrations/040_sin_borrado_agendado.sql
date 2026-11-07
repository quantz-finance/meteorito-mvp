-- 040 · Sin borrado automático/agendado de datos de usuarios (instrucción de Rolando).
-- Las migraciones históricas se conservan: esta anula sus tres tareas de retención.
-- Idempotente y compatible con instalaciones sin pg_cron. No borra datos ni funciones.
-- Mantiene release-24h, session-nonces-gc y rate-limits-gc sin cambios.
do $migration$
declare
  retention_job record;
begin
  if to_regclass('cron.job') is not null then
    for retention_job in execute $query$
      select jobid from cron.job where jobname in (
        'meteorito_seller_guest_retention',
        'meteorito-chat-retention',
        'meteorito_buyer_contacts_retention'
      )
    $query$ loop
      perform cron.unschedule(retention_job.jobid);
    end loop;
  end if;
end
$migration$;
