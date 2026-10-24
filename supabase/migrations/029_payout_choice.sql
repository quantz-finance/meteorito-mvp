-- 029: el vendedor elige dónde cobrar (USDC a su wallet Stellar o Cuenta IBAN) + cola manual de pagos IBAN para admin.
-- Idempotente: se puede correr más de una vez. NO la aplica el deploy: se corre a mano en el SQL Editor de Supabase
--   (después de 011 y 027; no depende de 028). La app funciona SIN esta migración (degrada): el escrow libera como hoy a
--   la cuenta Stellar del vendedor en Meteorito y no se muestra la opción de cobro.
-- Privacidad: solo el servicio (service role) lee y escribe. RLS encendido y sin grants para anon/authenticated.

-- ---------- Preferencia de cobro del vendedor (seller_payout, de 011) ----------
alter table public.seller_payout add column if not exists payout_method text;
alter table public.seller_payout add column if not exists stellar_address text;
-- Con 'wallet' ya no hace falta IBAN ni titular.
alter table public.seller_payout alter column iban drop not null;
alter table public.seller_payout alter column holder_name drop not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'seller_payout_method_chk') then
    alter table public.seller_payout add constraint seller_payout_method_chk check (payout_method is null or payout_method in ('wallet', 'iban'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'seller_payout_stellar_chk') then
    alter table public.seller_payout add constraint seller_payout_stellar_chk check (stellar_address is null or stellar_address ~ '^G[A-Z2-7]{55}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'seller_payout_complete_chk') then
    alter table public.seller_payout add constraint seller_payout_complete_chk check (
      (payout_method = 'wallet' and stellar_address is not null)
      or (coalesce(payout_method, 'iban') = 'iban' and iban is not null and holder_name is not null));
  end if;
end $$;

-- ---------- A quién libera cada escrow (se fija al desplegar; el receiver de Trustless Work no cambia) ----------
alter table public.orders add column if not exists payout_method text;
alter table public.orders add column if not exists payout_address text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_payout_method_chk') then
    alter table public.orders add constraint orders_payout_method_chk check (payout_method is null or payout_method in ('cavos', 'wallet', 'iban'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_payout_address_chk') then
    alter table public.orders add constraint orders_payout_address_chk check (payout_address is null or payout_address ~ '^G[A-Z2-7]{55}$');
  end if;
end $$;

-- ---------- Cola manual: escrow liberado a la wallet de la plataforma, falta transferir a la Cuenta IBAN ----------
create table if not exists public.payout_queue (
  order_id     uuid primary key references public.orders(id),
  slug         text not null check (slug ~ '^[a-z0-9]{6}$'),
  seller_sub   text not null check (char_length(seller_sub) between 1 and 200),
  amount_usdc  numeric not null check (amount_usdc >= 0),
  amount_crc   numeric check (amount_crc is null or amount_crc >= 0),
  iban         text not null check (iban ~ '^CR[0-9]{20}$'),
  holder_name  text not null check (char_length(holder_name) between 3 and 80),
  state        text not null default 'pendiente' check (state in ('pendiente', 'pagado')),
  released_tx  text,
  note         text check (note is null or char_length(note) <= 500),
  created_at   timestamptz not null default now(),
  paid_at      timestamptz,
  paid_by      text
);
create index if not exists payout_queue_pending_idx on public.payout_queue (created_at) where state = 'pendiente';
alter table public.payout_queue enable row level security;
revoke all on public.payout_queue from anon, authenticated;

notify pgrst, 'reload schema';
