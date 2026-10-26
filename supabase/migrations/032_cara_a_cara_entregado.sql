-- 032: cara a cara puede pasar de 'fondeado' a 'entregado' (PIN, "Recibí" o plazo desde el pago; no hay paso de envío).
-- Bug de prod (pedido 9781o4): approveAndRelease aprobaba on-chain y el guard rechazaba 'transición inválida fondeado -> entregado'.
-- Recrea orders_status_guard con TODAS las transiciones de 005 intactas + ('fondeado','entregado') SOLO si delivery_mode = 'cara_a_cara'
-- (columna de 017). Aditiva e idempotente: el código viejo sigue funcionando igual.
create or replace function public.orders_status_guard() returns trigger
language plpgsql as $$
begin
  if new.status = old.status then return new; end if;
  if (old.status, new.status) not in (
    ('creado','escrow_creado'), ('creado','cancelado'), ('escrow_creado','cancelado'),
    ('escrow_creado','fondeado'), ('fondeado','enviado'), ('enviado','entregado'), ('entregado','liberado'),
    ('fondeado','en_disputa'), ('enviado','en_disputa'), ('entregado','en_disputa'), ('en_disputa','resuelto'))
    and not ((old.status, new.status) = ('fondeado','entregado') and new.delivery_mode = 'cara_a_cara') then
    raise exception 'transición inválida % -> %', old.status, new.status;
  end if;
  if new.status = 'escrow_creado' and (new.contract_id is null or new.amount_usdc is null or new.buyer_user_id is null) then raise exception 'faltan datos de escrow'; end if;
  if new.status = 'fondeado'  and new.funded_tx  is null then raise exception 'falta funded_tx'; end if;
  if new.status = 'enviado'   and (new.shipped_tx is null or new.ship_evidence_hash is null) then raise exception 'falta evidencia de envío'; end if;
  if new.status = 'entregado' and (new.approved_tx is null or new.approval_reason is null) then raise exception 'falta aprobación y motivo'; end if;
  if new.status = 'liberado'  and new.released_tx is null then raise exception 'falta released_tx'; end if;
  if new.status = 'en_disputa' and (new.dispute_tx is null or new.released_tx is not null) then raise exception 'falta dispute_tx o ya liberado'; end if;
  if new.status = 'resuelto'  and (new.resolved_tx is null or new.resolution is null) then raise exception 'falta resolved_tx/resolution'; end if;
  return new;
end $$;
