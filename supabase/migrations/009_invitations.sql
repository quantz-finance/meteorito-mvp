-- 009: invitaciones de compra (el COMPRADOR inicia; el vendedor confirma publicando el listing y le envía el link de pago).
-- Solo service_role (API /api/invites). RLS activado sin políticas: anon/authenticated no leen ni escriben.
create table if not exists public.invitations (
  code           text primary key check (code ~ '^[a-z0-9]{8}$'),
  buyer_user_id  text not null,                       -- 'guest:<hash>' (o sub de Cavos)
  category       text not null,
  brand          text not null check (char_length(brand) between 1 and 60),
  model          text not null check (char_length(model) between 1 and 80),
  price_crc      integer not null check (price_crc between 1000 and 50000000),
  note           text check (note is null or char_length(note) <= 500),
  status         text not null default 'abierta' check (status in ('abierta','aceptada','cancelada')),
  order_slug     text references public.orders (slug),
  seller_user_id text,
  created_at     timestamptz not null default now(),
  accepted_at    timestamptz
);
create unique index if not exists invitations_order_slug_idx on public.invitations (order_slug) where order_slug is not null;
create index if not exists invitations_buyer_idx on public.invitations (buyer_user_id, created_at desc);
alter table public.invitations enable row level security;
revoke all on public.invitations from anon, authenticated;
