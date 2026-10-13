-- 008: auditoría de re-link sub -> wallet (api/_lib/relink.ts). Solo service_role (API).
-- RLS activado sin políticas: anon/authenticated no leen ni escriben. Append-only desde la API.
create table if not exists public.wallet_relinks (
  id          bigserial primary key,
  sub         text not null,
  old_wallet  text not null check (old_wallet ~ '^G[A-Z2-7]{55}$'),
  new_wallet  text not null check (new_wallet ~ '^G[A-Z2-7]{55}$'),
  created_at  timestamptz not null default now()
);
create index if not exists wallet_relinks_sub_idx on public.wallet_relinks (sub, created_at desc);
alter table public.wallet_relinks enable row level security;
revoke all on public.wallet_relinks from anon, authenticated;
