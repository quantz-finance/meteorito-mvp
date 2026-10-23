-- 011: cuenta IBAN para cobrar (registro, sin pagos reales todavía) + suscripciones Web Push.
-- 100% aditiva: solo CREATE ... IF NOT EXISTS, índices y RLS. No toca tablas, vistas ni datos existentes.
-- Escrituras y lecturas SOLO por la API (service role). anon/authenticated sin acceso; las vistas públicas
-- de la tienda (010) no exponen nada de esto.

-- Cuenta para cobrar del vendedor (sub de Cavos). Una por vendedor.
create table if not exists public.seller_payout (
  sub          text primary key,                                          -- sub de Cavos del vendedor
  iban         text not null check (iban ~ '^CR[0-9]{20}$'),              -- IBAN de Costa Rica normalizado (22 caracteres)
  holder_name  text not null check (char_length(holder_name) between 3 and 80),
  sinpe_phone  text check (sinpe_phone is null or sinpe_phone ~ '^[0-9]{8}$'), -- SINPE Móvil alterno (opcional)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.seller_payout enable row level security;
revoke all on public.seller_payout from anon, authenticated;

-- Suscripciones Web Push. user_id = sub de Cavos (vendedor o comprador con cuenta) o 'guest:<hash>' (comprador invitado,
-- mismo valor que orders.buyer_user_id). Un mismo navegador puede quedar ligado a ambas identidades.
create table if not exists public.push_subscriptions (
  endpoint     text not null,
  user_id      text not null,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_ok_at   timestamptz,
  primary key (endpoint, user_id)
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
