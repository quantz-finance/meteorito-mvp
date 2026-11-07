-- 053 · Corrige los CHECK de 051: Postgres limita las repeticiones acotadas a 255.
-- 052 sigue reservada/congelada. No modifica PII ni ejecuta backfills.
-- api/_lib/pii.ts emite pii:v1:<kid>:base64url(nonce12 || tag16 || ciphertext).
-- El lector admite kid de 1–32 caracteres y payload de 38–700 caracteres.
-- Separar el máximo de longitud conserva ese contrato sin el inválido {38,700}.

alter table public.buyer_contacts drop constraint if exists buyer_contacts_phone_e164_enc_fmt;
alter table public.buyer_contacts add constraint buyer_contacts_phone_e164_enc_fmt
  check (phone_e164_enc is null or (
    phone_e164_enc ~ '^pii:v1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{38,}$'
    and char_length(split_part(phone_e164_enc, ':', 4)) <= 700
  ));

alter table public.buyer_contacts drop constraint if exists buyer_contacts_email_enc_fmt;
alter table public.buyer_contacts add constraint buyer_contacts_email_enc_fmt
  check (email_enc is null or (
    email_enc ~ '^pii:v1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{38,}$'
    and char_length(split_part(email_enc, ':', 4)) <= 700
  ));

alter table public.seller_profiles drop constraint if exists seller_profiles_contact_phone_enc_fmt;
alter table public.seller_profiles add constraint seller_profiles_contact_phone_enc_fmt
  check (contact_phone_enc is null or (
    contact_phone_enc ~ '^pii:v1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{38,}$'
    and char_length(split_part(contact_phone_enc, ':', 4)) <= 700
  ));

notify pgrst, 'reload schema';
