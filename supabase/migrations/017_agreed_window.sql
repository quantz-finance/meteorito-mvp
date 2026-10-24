-- 017: acuerdo de entrega + plazo de liberación acordado + extensión de mutuo acuerdo.
--  - delivery_mode: 'envio' (default) o 'cara_a_cara'. Cara a cara no tiene paso de envío: el plazo corre desde el pago y
--    el vendedor ingresa el PIN desde 'fondeado'.
--  - protection_minutes: plazo que eligió el vendedor (24 h a 30 días). NULL = default del tipo (envío 7 días, cara a cara 24 h).
--  - release_ext: solicitud de extensión pendiente {by:'buyer'|'seller', days:1|3|7, at}. Congela el auto-release hasta la
--    respuesta o 24 h. release_ext_minutes: minutos ya extendidos (aceptados). Tope: 30 días desde el pago (lo valida la API).
-- 100% aditiva. La API tolera que no exista (crea links sin las columnas y usa los defaults). Los pedidos hijos de un
-- producto copian delivery_mode y protection_minutes (api/_lib/listings.ts).
alter table public.orders add column if not exists delivery_mode text not null default 'envio'
  check (delivery_mode in ('envio', 'cara_a_cara'));
alter table public.orders add column if not exists protection_minutes integer
  check (protection_minutes is null or protection_minutes between 1440 and 43200);
alter table public.orders add column if not exists release_ext jsonb;
alter table public.orders add column if not exists release_ext_minutes integer not null default 0
  check (release_ext_minutes between 0 and 41760);

-- Vista pública: mismas columnas que 013 + las del acuerdo al final (el comprador ve el acuerdo antes de pagar y la
-- solicitud de extensión pendiente).
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
       delivery_mode, protection_minutes, release_ext, release_ext_minutes
from public.orders;
grant select on public.public_orders to anon, authenticated;

-- Tick de pg_cron: también despierta el cron para cara a cara vencido (sigue en 'fondeado').
create or replace function public.meteorito_release_tick() returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare secret text; req_id bigint;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'meteorito_cron_secret';
  if secret is null then raise exception 'falta vault secret meteorito_cron_secret'; end if;
  if not exists (select 1 from orders where (status = 'enviado' and auto_release_at <= now())
                                         or (status = 'fondeado' and delivery_mode = 'cara_a_cara' and auto_release_at <= now())
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
