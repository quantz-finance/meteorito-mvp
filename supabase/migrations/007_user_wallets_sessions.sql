-- 007: sub (Cavos) -> wallet ligada + nonces de un uso para renovar tokens Cavos vencidos (testnet).
-- Solo service_role (API). RLS activado sin políticas: anon/authenticated no leen ni escriben.

create table if not exists public.user_wallets (
  sub            text primary key,
  wallet_address text not null check (wallet_address ~ '^G[A-Z2-7]{55}$'),
  source         text not null default 'fresh_token',   -- 'fresh_token' | 'backfill_orders'
  created_at     timestamptz not null default now()
);
alter table public.user_wallets enable row level security;
revoke all on public.user_wallets from anon, authenticated;

create table if not exists public.session_nonces (
  nonce      text primary key,
  sub        text not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists session_nonces_sub_idx on public.session_nonces (sub, expires_at);
alter table public.session_nonces enable row level security;
revoke all on public.session_nonces from anon, authenticated;

-- Backfill: testers actuales (tokens ya vencidos, no pueden re-loguear sin perder la llave).
-- Primera dirección por sub (pedido más antiguo), como vendedor o comprador. No sobrescribe bindings existentes.
insert into public.user_wallets (sub, wallet_address, source, created_at)
select distinct on (sub) sub, addr, 'backfill_orders', first_at
from (
  select seller_user_id as sub, seller_address as addr, created_at as first_at from public.orders
   where seller_user_id is not null and seller_address ~ '^G[A-Z2-7]{55}$'
  union all
  select buyer_user_id, buyer_address, created_at from public.orders
   where buyer_user_id is not null and buyer_address ~ '^G[A-Z2-7]{55}$'
) x
order by sub, first_at asc
on conflict (sub) do nothing;

-- Limpieza de nonces viejos (cada hora; pg_cron ya está habilitado por 004).
select cron.unschedule(jobid) from cron.job where jobname = 'meteorito-session-nonces-gc';
select cron.schedule('meteorito-session-nonces-gc', '17 * * * *', $$delete from public.session_nonces where expires_at < now() - interval '1 day'$$);

-- Verificación:
--   select source, count(*) from public.user_wallets group by 1;
--   select sub, wallet_address from public.user_wallets where sub in (select buyer_user_id from public.orders where slug = 'zp6ebt');
--   -- subs con más de una dirección en pedidos (quedó la más antigua):
--   select sub, count(distinct addr) from (select seller_user_id sub, seller_address addr from orders union all select buyer_user_id, buyer_address from orders) t where sub is not null group by 1 having count(distinct addr) > 1;
