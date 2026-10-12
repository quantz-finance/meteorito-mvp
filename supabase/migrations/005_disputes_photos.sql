-- 005: disputas (solo comprador, antes de liberar) + bucket de fotos cerrado (subida solo por URL firmada desde /api).

-- ---------- Disputas ----------
alter table public.orders
  add column if not exists dispute_tx   text,
  add column if not exists disputed_at  timestamptz,
  add column if not exists resolved_tx  text,
  add column if not exists resolved_at  timestamptz,
  add column if not exists resolution   jsonb;

create table if not exists public.disputes (
  order_id     uuid primary key references public.orders(id),   -- PK = idempotencia: una disputa por pedido
  reason       text not null check (reason in ('no_llego','no_funciona','no_es_lo_descrito','otro')),
  description  text check (description is null or length(description) <= 2000),
  evidence     jsonb not null default '[]'::jsonb,               -- URLs de fotos (listings/<sub>/...)
  opened_by    text not null,                                     -- Cavos sub del comprador
  opened_role  text not null default 'buyer' check (opened_role = 'buyer'),
  opened_at    timestamptz not null default now(),
  state        text not null default 'pending' check (state in ('pending','open','resolved','failed')),
  dispute_tx   text,
  resolution   jsonb,
  resolved_tx  text,
  resolved_at  timestamptz
);
alter table public.disputes enable row level security;
revoke all on public.disputes from anon, authenticated;

-- Guard de transiciones: igual que 002 + datos obligatorios de disputa/resolución.
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
  if new.status = 'en_disputa' and (new.dispute_tx is null or new.released_tx is not null) then raise exception 'falta dispute_tx o ya liberado'; end if;
  if new.status = 'resuelto'  and (new.resolved_tx is null or new.resolution is null) then raise exception 'falta resolved_tx/resolution'; end if;
  return new;
end $$;

-- Inmutables una vez fijados.
create or replace function public.orders_dispute_immutable() returns trigger
language plpgsql as $$
begin
  if (old.dispute_tx is not null and new.dispute_tx is distinct from old.dispute_tx)
  or (old.resolved_tx is not null and (new.resolved_tx is distinct from old.resolved_tx or new.resolution is distinct from old.resolution)) then
    raise exception 'campos de disputa inmutables';
  end if;
  return new;
end $$;
drop trigger if exists orders_dispute_immutable on public.orders;
create trigger orders_dispute_immutable before update on public.orders
  for each row execute function public.orders_dispute_immutable();

-- El cron SQL (004) solo llama /api/escrow/cron; el filtro de status vive allí y excluye en_disputa.

-- Vista pública: + disputed_at / resolved_tx (sin motivo ni evidencia).
create or replace view public.public_orders
with (security_invoker = false) as
select slug, category, brand, model, condition, price_crc, description, photos, status,
       case when identifier is null or identifier = '' then null
            else '••••' || right(identifier, 4) end as identifier_masked,
       checks as checks_summary, created_at,
       amount_usdc, contract_id, funded_tx, shipped_tx, released_tx, approval_reason, auto_release_at,
       disputed_at, dispute_tx, resolved_tx
from public.orders;
grant select on public.public_orders to anon, authenticated;

-- ---------- Fotos: bucket cerrado ----------
-- Lectura pública se mantiene. Ya no hay insert anon: /api/photos/upload-url entrega una URL firmada
-- (service role) para listings/<cavos sub>/<draft>/<0-3>.jpg.
drop policy if exists listings_anon_insert on storage.objects;
update storage.buckets
   set public = true,
       file_size_limit = 1048576,                                  -- 1 MB (el cliente comprime a <300 KB)
       allowed_mime_types = array['image/jpeg','image/png','image/webp']
 where id = 'listings';
