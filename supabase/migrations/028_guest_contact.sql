-- 028: avisos y recuperación del comprador SIN cuenta (WhatsApp, correo o cuenta Cavos).
-- Idempotente: se puede correr más de una vez. NO la aplica el deploy: se corre a mano en el SQL Editor de Supabase.
-- Sin esta migración la app sigue igual: el pago nunca depende de ella; la tarjeta "Recibe avisos de tu compra" no aparece
-- (o responde contact_unavailable), no se vincula la cuenta y no salen correos. Los links de acceso firmados SÍ funcionan
-- sin ella (son HMAC sin estado, api/_lib/buyerContact.ts).
-- Privacidad: solo el servicio (service role, /api/store acciones buyer_contact_* / buyer_access_* / buyer_link_account /
--   admin_contacts) lee y escribe. RLS encendido y sin grants para anon/authenticated. El teléfono y el correo NUNCA se
--   muestran al vendedor. Consentimiento: texto exacto y versión (api/_lib/contactText.ts CONTACT_CONSENT_VERSION).

create extension if not exists pgcrypto;

-- Contacto que el comprador eligió para ESTE pedido (uno por canal).
create table if not exists public.buyer_contacts (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.orders (id) on delete cascade,
  order_slug            text not null check (order_slug ~ '^[a-z0-9]{6}$'),
  buyer_user_id         text not null check (char_length(buyer_user_id) between 3 and 200),
  channel               text not null check (channel in ('whatsapp', 'email', 'account')),
  phone_e164            text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  email                 text check (email is null or char_length(email) <= 254),
  account_sub           text check (account_sub is null or char_length(account_sub) <= 200),
  consent_text          text not null check (char_length(consent_text) <= 400),
  consent_text_version  text not null check (char_length(consent_text_version) <= 60),
  consent_at            timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  revoked_at            timestamptz,
  constraint buyer_contacts_channel_value check (
    (channel = 'whatsapp' and phone_e164 is not null) or (channel = 'email' and email is not null) or (channel = 'account' and account_sub is not null))
);
create unique index if not exists buyer_contacts_order_channel_uidx on public.buyer_contacts (order_id, channel);
create index if not exists buyer_contacts_slug_idx on public.buyer_contacts (order_slug);

-- Cuenta Cavos <-> llave de invitado: los pedidos del invitado quedan en la cuenta (y siguen en el dispositivo).
create table if not exists public.buyer_links (
  guest_sub    text not null check (guest_sub like 'guest:%' and char_length(guest_sub) <= 200),
  account_sub  text not null check (char_length(account_sub) between 1 and 200 and account_sub not like 'guest:%'),
  linked_at    timestamptz not null default now(),
  primary key (guest_sub, account_sub)
);
create index if not exists buyer_links_account_idx on public.buyer_links (account_sub);

-- Bitácora de avisos: deduplica (un aviso por estado y canal) y limita la frecuencia.
create table if not exists public.buyer_notifications (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  channel     text not null check (channel in ('whatsapp', 'email', 'account')),
  kind        text not null check (char_length(kind) <= 40),
  dedupe_key  text not null check (char_length(dedupe_key) <= 80),
  status      text not null default 'sent' check (status in ('sent', 'failed', 'pending_manual', 'skipped')),
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create unique index if not exists buyer_notifications_dedupe_uidx on public.buyer_notifications (order_id, channel, dedupe_key);
create index if not exists buyer_notifications_recent_idx on public.buyer_notifications (order_id, channel, created_at desc);

alter table public.buyer_contacts enable row level security;
alter table public.buyer_links enable row level security;
alter table public.buyer_notifications enable row level security;
revoke all on public.buyer_contacts from anon, authenticated;
revoke all on public.buyer_links from anon, authenticated;
revoke all on public.buyer_notifications from anon, authenticated;

-- Retención (propuesta, pendiente de revisión legal): contactos y bitácora se borran 90 días después de cerrar el pedido.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'meteorito_buyer_contacts_retention';
    perform cron.schedule('meteorito_buyer_contacts_retention', '17 4 * * *', $job$
      delete from public.buyer_contacts c using public.orders o
       where c.order_id = o.id and o.status in ('liberado', 'resuelto', 'cancelado') and coalesce(o.released_at, o.resolved_at, o.created_at) < now() - interval '90 days';
      delete from public.buyer_notifications where created_at < now() - interval '120 days';
    $job$);
  end if;
end $$;
