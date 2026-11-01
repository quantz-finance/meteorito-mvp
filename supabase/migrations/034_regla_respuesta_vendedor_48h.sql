-- Regla v2 "Respuesta del vendedor en 48 h" (lib/rules.ts LEGAL_RULES, api/_lib/replyRule.ts). Solo pedidos con
-- rules_version >= 2 (033): nada retroactivo.
--  - disputes.seller_notified_at: cuándo se le mandó a quien vende el aviso de la disputa (push + aviso en la app).
--    Las 48 h cuentan desde ahí.
--  - orders.dispute_reply_due_at: vencimiento de las 48 h (las dos partes ven la cuenta regresiva en /p/<slug>).
--  - orders.dispute_replied_at: quien vende respondió (foto, guía o texto en dispute_responses, 027) -> revisión humana.
-- Sin esta migración: el plazo se calcula desde la apertura de la disputa (disputes.opened_at) y la respuesta se lee de
-- dispute_responses (027); la app no muestra la cuenta regresiva a quien compra ("funciona sin 034").
alter table public.disputes add column if not exists seller_notified_at timestamptz;
alter table public.orders add column if not exists dispute_reply_due_at timestamptz;
alter table public.orders add column if not exists dispute_replied_at timestamptz;
create index if not exists orders_reply_rule_idx on public.orders (dispute_reply_due_at)
  where status = 'en_disputa' and rules_version >= 2 and dispute_replied_at is null;

-- Vista pública: columnas de 033 + plazo y respuesta de la disputa (sin el contenido de la respuesta).
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
       case when ship_cancel is null then null else jsonb_build_object('by', ship_cancel->>'by', 'at', ship_cancel->>'at') end as ship_cancel,
       dispute_reply_due_at, dispute_replied_at
from public.orders;
grant select on public.public_orders to anon, authenticated;

-- Tick de pg_cron: además despierta /api/escrow/cron cuando vencen las 48 h sin respuesta (reembolso automático).
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
                                         or (status = 'en_disputa' and ship_cancel is not null and resolved_tx is null)
                                         or (status = 'en_disputa' and rules_version >= 2 and ship_cancel is null and dispute_replied_at is null
                                             and resolved_tx is null and dispute_reply_due_at <= now())) then
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
