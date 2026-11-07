-- 039: privacidad del vendedor sin cuenta (revisión de Harvey sobre #155). SOLO TESTNET, detrás de SELLER_GUEST_ENABLED.
--  1) Consentimiento del tratamiento del correo, SEPARADO de la aceptación comercial (seller_acceptances):
--     seller_guest_consents guarda versión del texto, versión del aviso de privacidad, hash del texto y fecha. Inmutable.
--     El servidor rechaza pedir un código sin consentimiento vigente (api/_lib/sellerGuest.ts).
--  2) Retención: 90 días después de que se cierra la venta (liberado/resuelto/cancelado, sin reclamo abierto) o, si nunca
--     aceptó, 90 días después del último código pedido, se DISOCIA el correo: contact_enc = null y contact_hmac = valor
--     aleatorio (ya no se puede buscar ni recuperar por ese correo); se borran sus sesiones y los códigos que no respaldan
--     una aceptación. seller_acceptances queda solo con hashes y datos no personales (no tiene correo).
--     seller_guest_purge(p_days, p_guest): la corre pg_cron cada día (meteorito_seller_guest_retention) y el admin
--     (api/invites op seller_guest_purge) para atender una solicitud de supresión antes de plazo.
--  3) Arregla el check de seller_guests.contact_enc de 038 (regex inválida en Postgres: {38,700} > 255).
-- Idempotente. Solo service_role. No toca 050/051/052 ni backfills.

alter table public.seller_guests add column if not exists erased_at timestamptz;

-- Arreglo de 038: '{38,700}' supera el máximo de repetición de las regex de Postgres (255) y CUALQUIER insert con correo
-- cifrado fallaba ("invalid repetition count(s)"). Mismo formato (api/_lib/pii.ts) con el largo aparte.
alter table public.seller_guests drop constraint if exists seller_guests_contact_enc_check;
alter table public.seller_guests drop constraint if exists seller_guests_contact_enc_chk;
alter table public.seller_guests add constraint seller_guests_contact_enc_chk check (contact_enc is null
  or (char_length(contact_enc) <= 740 and contact_enc ~ '^pii:v1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{38,}$'));

create table if not exists public.seller_guest_consents (
  id               uuid primary key default gen_random_uuid(),
  guest_id         uuid not null references public.seller_guests (id),
  invite_code      text not null references public.invitations (code),
  purpose          text not null check (purpose in ('accept', 'recover')),
  consent_version  text not null check (char_length(consent_version) between 1 and 40),
  notice_version   text not null check (char_length(notice_version) between 1 and 40),
  consent_text_sha256 text not null check (consent_text_sha256 ~ '^[a-f0-9]{64}$'),
  consented_at     timestamptz not null default now()
);
create index if not exists seller_guest_consents_guest_idx on public.seller_guest_consents (guest_id, consented_at desc);
alter table public.seller_otp_challenges add column if not exists consent_id uuid references public.seller_guest_consents (id);

create or replace function public.seller_guest_consents_immutable() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'seller_guest_consents es inmutable';
end $$;
drop trigger if exists seller_guest_consents_immutable on public.seller_guest_consents;
create trigger seller_guest_consents_immutable before update or delete on public.seller_guest_consents
  for each row execute function public.seller_guest_consents_immutable();

alter table public.seller_guest_consents enable row level security;
revoke all on public.seller_guest_consents from anon, authenticated;

-- Disocia el correo de los vendedores sin cuenta vencidos (o de uno, p_guest, a pedido; nunca con una venta abierta).
create or replace function public.seller_guest_purge(p_days integer default 90, p_guest uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[]; v_sessions int := 0; v_codes int := 0; v_blocked int := 0;
begin
  if p_days is null or p_days < 0 then raise exception 'p_days inválido'; end if;
  with cand as (
    select g.id from seller_guests g
     where g.erased_at is null and (p_guest is null or g.id = p_guest)
       -- ninguna venta suya abierta o cerrada hace menos de p_days, ni con reclamo sin resolver
       and not exists (
         select 1 from seller_acceptances a join orders o on o.id = a.order_id
          where a.guest_id = g.id and (
            o.status not in ('liberado', 'resuelto', 'cancelado')
            or exists (select 1 from order_claims c where c.order_id = o.id and c.status <> 'resuelto')
            or greatest(coalesce(o.released_at, o.created_at), coalesce(o.resolved_at, o.created_at),
                        coalesce((select max(e.created_at) from order_events e where e.order_id = o.id), o.created_at)) > now() - make_interval(days => p_days)))
       -- sin códigos recientes (vale también para quien nunca aceptó: cuenta desde el último código)
       and (p_guest is not null or (g.created_at < now() - make_interval(days => p_days)
            and not exists (select 1 from seller_otp_challenges ch where ch.guest_id = g.id and ch.created_at > now() - make_interval(days => p_days))))
  )
  select array_agg(id) into v_ids from cand;
  if p_guest is not null and (v_ids is null) then
    select count(*) into v_blocked from seller_guests where id = p_guest and erased_at is null;
  end if;
  if v_ids is null then return jsonb_build_object('ok', true, 'erased', 0, 'sessions', 0, 'codes', 0, 'blocked', v_blocked); end if;
  delete from seller_guest_sessions where guest_id = any (v_ids);
  get diagnostics v_sessions = row_count;
  delete from seller_otp_challenges ch where ch.guest_id = any (v_ids)
    and not exists (select 1 from seller_acceptances a where a.challenge_id = ch.id);
  get diagnostics v_codes = row_count;
  update seller_guests set contact_enc = null, erased_at = now(),
         contact_hmac = encode(sha256(convert_to(id::text || ':' || gen_random_uuid()::text || ':' || clock_timestamp()::text, 'UTF8')), 'hex')
   where id = any (v_ids);
  return jsonb_build_object('ok', true, 'erased', coalesce(array_length(v_ids, 1), 0), 'sessions', v_sessions, 'codes', v_codes, 'blocked', 0);
end $$;
revoke all on function public.seller_guest_purge(integer, uuid) from public, anon, authenticated;
grant execute on function public.seller_guest_purge(integer, uuid) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'meteorito_seller_guest_retention';
    perform cron.schedule('meteorito_seller_guest_retention', '27 4 * * *', $job$ select public.seller_guest_purge(90); $job$);
  end if;
end $$;

notify pgrst, 'reload schema';
