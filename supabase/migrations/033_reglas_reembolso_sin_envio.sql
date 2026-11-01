-- 033: reglas con VERSIÓN por pedido + regla "Reembolso si no se envía" (v1, lib/rules.ts SHIP_REFUND_RULE).
-- NO la aplica el deploy: se corre a mano en el SQL Editor de Supabase. Idempotente y 100% aditiva.
--  - orders.rules_version: versión de reglas con la que se creó el pedido (la que quien vende aceptó al publicar; los
--    pedidos hijos de un producto copian la del producto). DEFAULT 0 = pedidos existentes SIN reglas nuevas: nada
--    retroactivo. Una regla rige solo si rules_version >= su versión (api/_lib/orderRules.ts).
--  - orders.ship_reminded_at: aviso del día 2 a quien vende ya enviado (una sola vez).
--  - orders.ship_cancel: {by:'buyer'|'auto', at} cuando se canceló por falta de envío (reembolso 100% desde la custodia por
--    el camino de las disputas: dispute-escrow + resolución al comprador).
-- La app funciona SIN esta migración (como antes: los pedidos no guardan versión y la regla no rige para ninguno).
alter table public.orders add column if not exists rules_version integer not null default 0
  check (rules_version between 0 and 100);
alter table public.orders add column if not exists ship_reminded_at timestamptz;
alter table public.orders add column if not exists ship_cancel jsonb
  check (ship_cancel is null or (ship_cancel->>'by') in ('buyer', 'auto'));
create index if not exists orders_ship_rule_idx on public.orders (status, funded_at)
  where status = 'fondeado' and rules_version >= 1 and shipped_at is null;

-- Vista pública: mismas columnas que 017 + al final lo que la app necesita para mostrar el plazo de envío a las dos partes
-- (fecha del pago, versión de reglas y si se canceló por falta de envío).
create or replace view public.public_orders
with (security_invoker = false) as
select slug, category, brand, model, condition, price_crc, description, photos, status,
       case when identifier is null or identifier = '' then null
            else '••••' || right(identifier, 4) end as identifier_masked,
       checks as checks_summary, created_at,
       amount_usdc, contract_id, funded_tx, shipped_tx, released_tx, approval_reason, auto_release_at,
       disputed_at, dispute_tx, resolved_tx,
       kind, listing_slug, listing_status,
       resolution,
       delivery_mode, protection_minutes, release_ext, release_ext_minutes,
       funded_at, rules_version,
       case when ship_cancel is null then null else jsonb_build_object('by', ship_cancel->>'by', 'at', ship_cancel->>'at') end as ship_cancel
from public.orders;
grant select on public.public_orders to anon, authenticated;

-- Tick de pg_cron (cada 5 min, 004/006/017): también despierta /api/escrow/cron para el aviso del día 2 y el reembolso
-- automático del día 5 (y reanuda un reembolso por esta regla que quedó a medias).
create or replace function public.meteorito_release_tick() returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare secret text; req_id bigint;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'meteorito_cron_secret';
  if secret is null then raise exception 'falta vault secret meteorito_cron_secret'; end if;
  if not exists (select 1 from orders where (status = 'enviado' and auto_release_at <= now())
                                         or (status = 'fondeado' and delivery_mode = 'cara_a_cara' and auto_release_at <= now())
                                         or (status = 'entregado' and released_tx is null)
                                         or (status = 'fondeado' and delivery_mode = 'envio' and rules_version >= 1 and shipped_at is null
                                             and ((ship_reminded_at is null and funded_at <= now() - interval '2 days')
                                                  or funded_at <= now() - interval '5 days'))
                                         or (status = 'en_disputa' and ship_cancel is not null and resolved_tx is null)) then
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

notify pgrst, 'reload schema';
