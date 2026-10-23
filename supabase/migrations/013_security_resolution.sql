-- Meteorito MVP — 013: cierra la RPC pública de pedidos del vendedor + expone el resultado de la disputa.
-- APLICAR SOLO DESPUÉS de promover el deploy que usa /api/store { action: 'orders' } (PR "bugs de Neo"): si se aplica
-- antes, Pedidos e Inicio de la versión vieja dejan de cargar.
-- Sin DROP ni cambios de datos: solo REVOKE (permisos) y CREATE OR REPLACE VIEW con una columna nueva al final.

-- 1) seller_orders / seller_orders_v2 aceptaban cualquier dirección (cualquiera podía listar pedidos ajenos).
--    La app ahora los lee por la API con la sesión del vendedor (service role).
revoke execute on function public.seller_orders(text) from anon;
revoke execute on function public.seller_orders(text) from authenticated;
revoke execute on function public.seller_orders_v2(text) from anon;
revoke execute on function public.seller_orders_v2(text) from authenticated;

-- 2) Resultado de la disputa en la página pública (para no mostrar "Pago liberado" en un reembolso).
--    Mismas columnas que 012 + resolution al final (porcentaje y montos de la resolución; sin datos personales).
create or replace view public.public_orders
with (security_invoker = false) as
select slug, category, brand, model, condition, price_crc, description, photos, status,
       case when identifier is null or identifier = '' then null
            else '••••' || right(identifier, 4) end as identifier_masked,
       checks as checks_summary, created_at,
       amount_usdc, contract_id, funded_tx, shipped_tx, released_tx, approval_reason, auto_release_at,
       disputed_at, dispute_tx, resolved_tx,
       kind, listing_slug, listing_status,
       resolution
from public.orders;
grant select on public.public_orders to anon, authenticated;
