-- 019: de dónde se importó un producto ("Importar de un link" en Vender): link del anuncio original y proveedor.
-- Referencia para el vendedor y soporte. 100% aditiva: dos columnas nullable. Sin esta migración la API crea el producto
-- igual, sin guardar el origen (PostgREST PGRST204 -> se reintenta sin las columnas).
alter table public.orders add column if not exists source_url text
  check (source_url is null or (char_length(source_url) <= 1000 and source_url ~ '^https://'));
alter table public.orders add column if not exists source_provider text
  check (source_provider is null or source_provider in ('facebook','mercadolibre','encuentra24','amazon','aliexpress','walmart','shopee','olx','falabella','temu','web'));
