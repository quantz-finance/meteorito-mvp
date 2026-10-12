-- Meteorito MVP: escrow Trustless Work (testnet) — 002
-- Roles (Snowden): approver = wallet backend; service provider = vendedor (o wallet 'service' en modo backend);
-- release signer = backend; receiver = vendedor; dispute resolver = wallet Meteorito aparte; platform = Meteorito (fee 0).
-- Solo el backend (service_role) escribe estas columnas.

alter table public.orders
  add column if not exists seller_user_id    text,
  add column if not exists buyer_user_id     text,
  add column if not exists buyer_address     text check (buyer_address is null or buyer_address ~ '^G[A-Z2-7]{55}$'),
  add column if not exists sp_mode           text check (sp_mode is null or sp_mode in ('seller','backend')),
  add column if not exists amount_usdc       numeric(18,7),
  add column if not exists fx_crc_per_usdc   numeric(12,4),
  add column if not exists contract_id       text unique check (contract_id is null or contract_id ~ '^C[A-Z2-7]{55}$'),
  add column if not exists deploy_tx         text,
  add column if not exists funded_tx         text,
  add column if not exists shipped_tx        text,
  add column if not exists approved_tx       text,
  add column if not exists released_tx       text,
  add column if not exists disputed_tx       text,
  add column if not exists ship_evidence     jsonb,
  add column if not exists ship_evidence_hash text,
  add column if not exists approval_reason   text check (approval_reason is null or approval_reason in ('buyer_confirm','pin','timeout')),
  add column if not exists delivery_pin_hash text,
  add column if not exists pin_attempts      int not null default 0,
  add column if not exists funded_at         timestamptz,
  add column if not exists shipped_at        timestamptz,
  add column if not exists auto_release_at   timestamptz,
  add column if not exists delivered_at      timestamptz,
  add column if not exists released_at       timestamptz;

-- Estados: creado -> escrow_creado -> fondeado -> enviado -> entregado (aprobado) -> liberado
--          fondeado|enviado|entregado -> en_disputa -> resuelto ; creado|escrow_creado -> cancelado
update public.orders set status = 'creado' where status not in
  ('creado','escrow_creado','fondeado','enviado','entregado','liberado','en_disputa','resuelto','cancelado');
alter table public.orders drop constraint if exists orders_status_chk;
alter table public.orders add constraint orders_status_chk check (status in
  ('creado','escrow_creado','fondeado','enviado','entregado','liberado','en_disputa','resuelto','cancelado'));

create or replace function public.orders_status_guard() returns trigger
language plpgsql as $$
begin
  if new.status = old.status then return new; end if;
  if (old.status, new.status) not in (
    ('creado','escrow_creado'), ('creado','cancelado'), ('escrow_creado','cancelado'),
    ('escrow_creado','fondeado'), ('fondeado','enviado'), ('enviado','entregado'), ('entregado','liberado'),
    ('fondeado','en_disputa'), ('enviado','en_disputa'), ('entregado','en_disputa'), ('en_disputa','resuelto')) then
    raise exception 'transición inválida % -> %', old.status, new.status;
  end if;
  if new.status = 'escrow_creado' and (new.contract_id is null or new.amount_usdc is null or new.buyer_user_id is null) then raise exception 'faltan datos de escrow'; end if;
  if new.status = 'fondeado'  and new.funded_tx  is null then raise exception 'falta funded_tx'; end if;
  if new.status = 'enviado'   and (new.shipped_tx is null or new.ship_evidence_hash is null) then raise exception 'falta evidencia de envío'; end if;
  if new.status = 'entregado' and (new.approved_tx is null or new.approval_reason is null) then raise exception 'falta aprobación y motivo'; end if;
  if new.status = 'liberado'  and new.released_tx is null then raise exception 'falta released_tx'; end if;
  return new;
end $$;
drop trigger if exists orders_status on public.orders;
create trigger orders_status before update on public.orders
  for each row execute function public.orders_status_guard();

-- Campos de escrow inmutables una vez fijados.
create or replace function public.orders_escrow_immutable() returns trigger
language plpgsql as $$
begin
  if (old.contract_id   is not null and new.contract_id   is distinct from old.contract_id)
  or (old.amount_usdc   is not null and new.amount_usdc   is distinct from old.amount_usdc)
  or (old.funded_tx     is not null and new.funded_tx     is distinct from old.funded_tx)
  or (old.buyer_address is not null and new.buyer_address is distinct from old.buyer_address)
  or (old.buyer_user_id is not null and new.buyer_user_id is distinct from old.buyer_user_id)
  or (old.seller_user_id is not null and new.seller_user_id is distinct from old.seller_user_id)
  or (old.shipped_tx    is not null and new.ship_evidence_hash is distinct from old.ship_evidence_hash)
  or (old.approval_reason is not null and new.approval_reason is distinct from old.approval_reason) then
    raise exception 'campos de escrow inmutables';
  end if;
  return new;
end $$;
drop trigger if exists orders_escrow_immutable on public.orders;
create trigger orders_escrow_immutable before update on public.orders
  for each row execute function public.orders_escrow_immutable();

-- Idempotencia del ramp mock: un fondeo por pedido (PK).
create table if not exists public.ramp_mock_payments (
  order_id    uuid primary key references public.orders(id),
  amount_usdc numeric(18,7) not null,
  tx_hash     text,
  state       text not null default 'pending' check (state in ('pending','sent','failed')),
  created_at  timestamptz not null default now()
);
alter table public.ramp_mock_payments enable row level security;
revoke all on public.ramp_mock_payments from anon, authenticated;

-- Bitácora (incluye motivo de aprobación buyer_confirm|pin|timeout).
create table if not exists public.order_events (
  id         bigserial primary key,
  order_id   uuid not null references public.orders(id),
  kind       text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events (order_id, created_at);
alter table public.order_events enable row level security;
revoke all on public.order_events from anon, authenticated;

-- Vista pública: agrega estado del escrow (sin PIN, comprador ni evidencia completa).
create or replace view public.public_orders
with (security_invoker = false) as
select slug, category, brand, model, condition, price_crc, description, photos, status,
       case when identifier is null or identifier = '' then null
            else '••••' || right(identifier, 4) end as identifier_masked,
       checks as checks_summary, created_at,
       amount_usdc, contract_id, funded_tx, shipped_tx, released_tx, approval_reason, auto_release_at
from public.orders;
grant select on public.public_orders to anon, authenticated;
