-- 051 · Cifrado de PII en reposo, fase A (aditiva). Snowden punto 2.
-- NO la aplica el deploy ni este PR. La aplica Vitalik con Supabase apply_migration, y hay que avisarle antes.
-- Agrega columnas *_enc y acepta, durante la transición, texto en claro O ciphertext.
-- Formato (api/_lib/pii.ts): pii:v1:<kid>:<base64url(nonce12 ‖ tag16 ‖ ciphertext)>.
-- No borra columnas en claro, no reescribe filas y no toca vistas públicas (eso es la 052, otro PR).
-- Sin esta migración: guardar un contacto o un WhatsApp de vendedor responde 503 (no se escribe solo el claro).

alter table public.buyer_contacts add column if not exists phone_e164_enc text;
alter table public.buyer_contacts add column if not exists email_enc text;
alter table public.seller_profiles add column if not exists contact_phone_enc text;

alter table public.buyer_contacts drop constraint if exists buyer_contacts_phone_e164_enc_fmt;
alter table public.buyer_contacts add constraint buyer_contacts_phone_e164_enc_fmt
  check (phone_e164_enc is null or phone_e164_enc ~ '^pii:v1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{38,700}$');

alter table public.buyer_contacts drop constraint if exists buyer_contacts_email_enc_fmt;
alter table public.buyer_contacts add constraint buyer_contacts_email_enc_fmt
  check (email_enc is null or email_enc ~ '^pii:v1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{38,700}$');

alter table public.seller_profiles drop constraint if exists seller_profiles_contact_phone_enc_fmt;
alter table public.seller_profiles add constraint seller_profiles_contact_phone_enc_fmt
  check (contact_phone_enc is null or contact_phone_enc ~ '^pii:v1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{38,700}$');

-- Transición: el canal vale con el texto en claro (028) o ya solo con el ciphertext (hasta la 052).
alter table public.buyer_contacts drop constraint if exists buyer_contacts_channel_value;
alter table public.buyer_contacts add constraint buyer_contacts_channel_value check (
  (channel = 'whatsapp' and (phone_e164 is not null or phone_e164_enc is not null))
  or (channel = 'email' and (email is not null or email_enc is not null))
  or (channel = 'account' and account_sub is not null)
);
