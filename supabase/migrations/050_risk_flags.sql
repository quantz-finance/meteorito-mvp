-- 050 · Límites de riesgo (antifraude, punto 9). NO la aplica el deploy.
-- Avisar a Vitalik antes de correrla en el SQL Editor de Supabase.
-- Depende de app_flags (027). Reusa esa tabla y el contador de 037 (rate_limit_hit); no crea tablas nuevas.
-- Sin esta migración la app igual aplica los defaults de api/_lib/risk.ts.
-- Sin 027 no hay dónde guardar topes ni bloqueos (el tope en código sigue; el bloqueo no persiste).
-- Sin 037 la velocity por persona cae a un conteo de orders/invitations; la velocity por IP no corre.
-- Idempotente. Montos en colones.

insert into public.app_flags (key, value) values
  ('risk_limits', '{"enabled":true,"max_order_crc":5000000,"max_daily_crc":15000000,"orders_per_hour":20,"pays_per_hour":30,"new_account_hours":48,"new_account_max_crc":1500000,"atypical_crc":2000000,"burst_count":8,"burst_window_sec":600,"block_hours":24}'::jsonb),
  ('risk_blocks', '{"subjects":[]}'::jsonb)
on conflict (key) do nothing;

-- Sumas del día y ráfagas leen por persona + fecha. Sin estos índices funciona igual, más lento.
create index if not exists orders_seller_user_created_idx on public.orders (seller_user_id, created_at desc);
create index if not exists orders_buyer_user_created_idx on public.orders (buyer_user_id, created_at desc);

notify pgrst, 'reload schema';
