-- 038: vendedor SIN cuenta Cavos acepta la invitación del comprador (opción A del plan, SOLO TESTNET).
--   Identidad no-Cavos (seller_guests), código por correo (seller_otp_challenges: solo el HMAC del código),
--   sesión HttpOnly por pedido (seller_guest_sessions: solo el hash del token), aceptación inmutable con hash del acuerdo
--   y snapshot del cobro (seller_acceptances), y el RPC seller_guest_accept que hace TODO en una transacción:
--   código + lock de la invitación + pedido + aceptación + invitación aceptada + sesión. Una invitación = un pedido.
-- Pedidos de vendedor sin cuenta: orders.seller_auth_kind = 'guest', seller_user_id = 'seller_guest:<uuid>' (nunca un sub
--   de Cavos), seller_address = dirección del serviceProvider backend (rol operativo, NO una wallet del vendedor),
--   payout_method = 'iban' y payout_address = wallet platform (cola IBAN SIMULADA, sin IBAN real).
-- Idempotente. Solo service_role: RLS encendido y sin grants para anon/authenticated. No toca 050/051/052 ni backfills.

create extension if not exists pgcrypto;

-- ---------- Identidad del vendedor sin cuenta ----------
create table if not exists public.seller_guests (
  id          uuid primary key default gen_random_uuid(),
  channel     text not null default 'email' check (channel in ('email')),
  contact_hmac text not null unique check (contact_hmac ~ '^[a-f0-9]{64}$'),   -- HMAC del correo normalizado (búsqueda)
  contact_enc text check (contact_enc is null or contact_enc ~ '^pii:v1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{38,700}$'), -- correo cifrado (pii.ts)
  created_at  timestamptz not null default now()
);

-- ---------- Códigos de un uso (nunca en claro) ----------
create table if not exists public.seller_otp_challenges (
  id             uuid primary key default gen_random_uuid(),
  invite_code    text not null references public.invitations (code),
  guest_id       uuid not null references public.seller_guests (id),
  purpose        text not null default 'accept' check (purpose in ('accept', 'recover')),
  otp_hash       text not null check (otp_hash ~ '^[a-f0-9]{64}$'),
  agreement_hash text check (agreement_hash is null or agreement_hash ~ '^sha256:[a-f0-9]{64}$'),
  delivery_mode  text check (delivery_mode is null or delivery_mode in ('envio', 'cara_a_cara')),
  attempts       integer not null default 0 check (attempts between 0 and 50),
  expires_at     timestamptz not null,
  consumed_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists seller_otp_invite_idx on public.seller_otp_challenges (invite_code, created_at desc);
create index if not exists seller_otp_guest_idx on public.seller_otp_challenges (guest_id, created_at desc);

-- ---------- Aceptación inmutable ----------
create table if not exists public.seller_acceptances (
  id              uuid primary key default gen_random_uuid(),
  invite_code     text not null unique references public.invitations (code),
  order_id        uuid not null unique references public.orders (id),
  guest_id        uuid not null references public.seller_guests (id),
  challenge_id    uuid not null unique references public.seller_otp_challenges (id),
  terms_version   integer not null,
  agreement_hash  text not null check (agreement_hash ~ '^sha256:[a-f0-9]{64}$'),
  payout_snapshot jsonb not null,
  accepted_at     timestamptz not null default now()
);
create or replace function public.seller_acceptances_immutable() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'seller_acceptances es inmutable';
end $$;
drop trigger if exists seller_acceptances_immutable on public.seller_acceptances;
create trigger seller_acceptances_immutable before update or delete on public.seller_acceptances
  for each row execute function public.seller_acceptances_immutable();

-- ---------- Sesión del vendedor (una por pedido; solo el hash del token) ----------
create table if not exists public.seller_guest_sessions (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  guest_id    uuid not null references public.seller_guests (id),
  order_id    uuid not null references public.orders (id),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists seller_guest_sessions_order_idx on public.seller_guest_sessions (order_id) where revoked_at is null;

-- ---------- Pedido ligado al vendedor sin cuenta ----------
alter table public.orders add column if not exists seller_auth_kind text not null default 'cavos';
alter table public.orders add column if not exists seller_guest_id uuid references public.seller_guests (id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_seller_auth_kind_chk') then
    alter table public.orders add constraint orders_seller_auth_kind_chk check (
      (seller_auth_kind = 'cavos' and seller_guest_id is null)
      or (seller_auth_kind = 'guest' and seller_guest_id is not null and seller_user_id = 'seller_guest:' || seller_guest_id::text
          and payout_method = 'iban' and payout_address is not null));
  end if;
end $$;
-- Quién es el vendedor no cambia nunca (ni de cuenta a invitado ni al revés).
create or replace function public.orders_seller_guest_immutable() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.seller_auth_kind is distinct from old.seller_auth_kind or new.seller_guest_id is distinct from old.seller_guest_id
     or (old.seller_auth_kind = 'guest' and (new.payout_method is distinct from old.payout_method or new.payout_address is distinct from old.payout_address)) then
    raise exception 'vendedor y destino de cobro de un pedido sin cuenta son inmutables';
  end if;
  return new;
end $$;
drop trigger if exists orders_seller_guest_immutable on public.orders;
create trigger orders_seller_guest_immutable before update on public.orders
  for each row execute function public.orders_seller_guest_immutable();

alter table public.seller_guests enable row level security;
alter table public.seller_otp_challenges enable row level security;
alter table public.seller_acceptances enable row level security;
alter table public.seller_guest_sessions enable row level security;
revoke all on public.seller_guests, public.seller_otp_challenges, public.seller_acceptances, public.seller_guest_sessions from anon, authenticated;

-- ---------- Aceptación atómica ----------
-- Devuelve jsonb {ok:true, slug, order_id} o {ok:false, error, attempts_left?}. Un código equivocado SUMA el intento y
-- devuelve error (no lanza) para que el intento quede guardado. El servidor calcula los hashes (OTP con secreto del servidor,
-- token de sesión) y el acuerdo; aquí se vuelven a comprobar contra lo guardado bajo lock.
create or replace function public.seller_guest_accept(
  p_challenge_id uuid, p_otp_hash text, p_agreement_hash text, p_order jsonb, p_payout jsonb,
  p_terms_version integer, p_session_hash text, p_session_expires timestamptz, p_max_attempts integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ch  public.seller_otp_challenges%rowtype;
  inv public.invitations%rowtype;
  v_slug text; v_order uuid; i int; a text := 'abcdefghijklmnopqrstuvwxyz0123456789';
begin
  select * into ch from seller_otp_challenges where id = p_challenge_id for update;
  if not found or ch.purpose <> 'accept' then return jsonb_build_object('ok', false, 'error', 'challenge_invalid'); end if;
  if ch.consumed_at is not null then return jsonb_build_object('ok', false, 'error', 'challenge_used'); end if;
  if ch.expires_at <= now() then return jsonb_build_object('ok', false, 'error', 'challenge_expired'); end if;
  if ch.attempts >= p_max_attempts then return jsonb_build_object('ok', false, 'error', 'too_many_attempts'); end if;
  if ch.otp_hash <> p_otp_hash then
    update seller_otp_challenges set attempts = attempts + 1 where id = ch.id;
    return jsonb_build_object('ok', false, 'error', 'bad_code', 'attempts_left', greatest(0, p_max_attempts - ch.attempts - 1));
  end if;
  -- El acuerdo que se aceptó tiene que ser exactamente el que se pidió con este código.
  if ch.agreement_hash is distinct from p_agreement_hash or ch.delivery_mode is distinct from (p_order->>'delivery_mode') then
    update seller_otp_challenges set consumed_at = now() where id = ch.id;
    return jsonb_build_object('ok', false, 'error', 'agreement_changed');
  end if;
  select * into inv from invitations where code = ch.invite_code for update;
  if not found or inv.status <> 'abierta' then
    update seller_otp_challenges set consumed_at = now() where id = ch.id;
    return jsonb_build_object('ok', false, 'error', 'invite_not_open');
  end if;
  if inv.price_crc <> (p_order->>'price_crc')::bigint then
    update seller_otp_challenges set consumed_at = now() where id = ch.id;
    return jsonb_build_object('ok', false, 'error', 'agreement_changed');
  end if;
  for n in 1..8 loop
    v_slug := '';
    for i in 1..6 loop v_slug := v_slug || substr(a, 1 + floor(random() * 36)::int, 1); end loop;
    exit when not exists (select 1 from orders where slug = v_slug);
  end loop;
  insert into orders (slug, seller_address, seller_user_id, seller_auth_kind, seller_guest_id, category, brand, model, condition,
                      price_crc, photos, checks, status, kind, delivery_mode, protection_minutes, rules_version, payout_method, payout_address)
  values (v_slug, p_order->>'seller_address', 'seller_guest:' || ch.guest_id::text, 'guest', ch.guest_id, inv.category, inv.brand, inv.model, '',
          inv.price_crc, coalesce(inv.photos, '{}'), '[]'::jsonb, 'creado', 'single', p_order->>'delivery_mode', (p_order->>'protection_minutes')::int,
          p_terms_version, 'iban', p_payout->>'receiver')
  returning id into v_order;
  insert into seller_acceptances (invite_code, order_id, guest_id, challenge_id, terms_version, agreement_hash, payout_snapshot)
  values (inv.code, v_order, ch.guest_id, ch.id, p_terms_version, p_agreement_hash, p_payout);
  update invitations set status = 'aceptada', order_slug = v_slug, seller_user_id = 'seller_guest:' || ch.guest_id::text, accepted_at = now()
   where code = inv.code and status = 'abierta';
  update seller_otp_challenges set consumed_at = now() where id = ch.id;
  insert into seller_guest_sessions (token_hash, guest_id, order_id, expires_at) values (p_session_hash, ch.guest_id, v_order, p_session_expires);
  insert into order_events (order_id, kind, detail) values (v_order, 'seller_guest_accepted',
    jsonb_build_object('agreement_hash', p_agreement_hash, 'terms_version', p_terms_version, 'payout', p_payout->>'method', 'challenge', ch.id));
  return jsonb_build_object('ok', true, 'slug', v_slug, 'order_id', v_order);
end $$;

-- Recuperar la sesión: código 'recover' del MISMO vendedor del pedido. Revoca las sesiones anteriores y crea una nueva.
create or replace function public.seller_guest_recover(
  p_challenge_id uuid, p_otp_hash text, p_session_hash text, p_session_expires timestamptz, p_max_attempts integer default 5)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ch public.seller_otp_challenges%rowtype; acc public.seller_acceptances%rowtype;
begin
  select * into ch from seller_otp_challenges where id = p_challenge_id for update;
  if not found or ch.purpose <> 'recover' then return jsonb_build_object('ok', false, 'error', 'challenge_invalid'); end if;
  if ch.consumed_at is not null then return jsonb_build_object('ok', false, 'error', 'challenge_used'); end if;
  if ch.expires_at <= now() then return jsonb_build_object('ok', false, 'error', 'challenge_expired'); end if;
  if ch.attempts >= p_max_attempts then return jsonb_build_object('ok', false, 'error', 'too_many_attempts'); end if;
  if ch.otp_hash <> p_otp_hash then
    update seller_otp_challenges set attempts = attempts + 1 where id = ch.id;
    return jsonb_build_object('ok', false, 'error', 'bad_code', 'attempts_left', greatest(0, p_max_attempts - ch.attempts - 1));
  end if;
  select * into acc from seller_acceptances where invite_code = ch.invite_code;
  if not found or acc.guest_id <> ch.guest_id then
    update seller_otp_challenges set consumed_at = now() where id = ch.id;
    return jsonb_build_object('ok', false, 'error', 'challenge_invalid');
  end if;
  update seller_otp_challenges set consumed_at = now() where id = ch.id;
  update seller_guest_sessions set revoked_at = now() where order_id = acc.order_id and revoked_at is null;
  insert into seller_guest_sessions (token_hash, guest_id, order_id, expires_at) values (p_session_hash, acc.guest_id, acc.order_id, p_session_expires);
  insert into order_events (order_id, kind, detail) values (acc.order_id, 'seller_guest_session_recovered', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'slug', (select slug from orders where id = acc.order_id));
end $$;

revoke all on function public.seller_guest_accept(uuid, text, text, jsonb, jsonb, integer, text, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.seller_guest_recover(uuid, text, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.seller_guest_accept(uuid, text, text, jsonb, jsonb, integer, text, timestamptz, integer) to service_role;
grant execute on function public.seller_guest_recover(uuid, text, text, timestamptz, integer) to service_role;

notify pgrst, 'reload schema';
