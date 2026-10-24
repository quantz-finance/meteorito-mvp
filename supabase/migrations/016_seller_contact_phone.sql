-- 016: WhatsApp o teléfono de contacto del vendedor (opcional). Lo guarda el vendedor en Mi cuenta (perfil).
-- El comprador lo ve solo DESPUÉS de pagar (fondeado o posterior) y solo si demuestra ser el comprador del pedido
-- (POST /api/store { action:'seller_contact' } con su llave de invitado o sesión). Nunca sale en la tienda pública.
-- 100% aditiva: una columna nullable en seller_profiles. No toca las vistas públicas (public_stores no la expone).
-- Sin esta migración la API responde contact_phone: null y guardar el teléfono da 503 amable.
alter table public.seller_profiles add column if not exists contact_phone text
  check (contact_phone is null or contact_phone ~ '^\+506[2-8][0-9]{7}$');
