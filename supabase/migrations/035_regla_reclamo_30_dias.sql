-- Regla v3 "Período de reclamo de 30 días" (lib/rules.ts LEGAL_RULES, api/_lib/claims.ts). Solo pedidos con
-- rules_version >= 3 (033): nada retroactivo.
--  - Después de liberado el pago, quien compra tiene 30 días (desde orders.released_at) para reportar un problema.
--  - Se le avisa a quien vende, que puede responder ANTES de que el reporte cuente en su historial (counts_at = aviso + 48 h).
--  - No congela fondos ni promete devolución: es un registro. El equipo puede marcarlo como resuelto.
--  - El historial público de quien vende muestra SOLO el conteo por estado (abierto / respondido / resuelto), nunca el
--    texto de quien compra (ni la respuesta): api/_lib/feed.ts salesOutcome -> claims.
-- Sin esta migración: la app no ofrece reportar (claim_get -> available:false) y el perfil no muestra el conteo.
create table if not exists public.order_claims (
  order_id         uuid primary key references public.orders(id),
  slug             text not null check (char_length(slug) between 1 and 40),
  seller_user_id   text not null check (char_length(seller_user_id) between 1 and 200),
  buyer_sub        text not null check (char_length(buyer_sub) between 1 and 200),
  reason           text not null check (reason in ('no_llego', 'no_funciona', 'no_es_lo_descrito', 'otro')),
  description      text not null check (char_length(description) between 1 and 2000),
  status           text not null default 'abierto' check (status in ('abierto', 'respondido', 'resuelto')),
  opened_at        timestamptz not null default now(),
  seller_notified_at timestamptz,
  counts_at        timestamptz not null,
  seller_response  text check (seller_response is null or char_length(seller_response) between 1 and 1000),
  responded_at     timestamptz,
  resolved_at      timestamptz,
  resolved_by      text,
  resolution_note  text check (resolution_note is null or char_length(resolution_note) <= 1000)
);
create index if not exists order_claims_seller_idx on public.order_claims (seller_user_id);
create index if not exists order_claims_open_idx on public.order_claims (opened_at) where status <> 'resuelto';

-- Solo el servidor (service role) lee y escribe: el texto de quien compra nunca se publica.
alter table public.order_claims enable row level security;
revoke all on public.order_claims from anon, authenticated;

notify pgrst, 'reload schema';
