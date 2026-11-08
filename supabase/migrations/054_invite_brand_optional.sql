-- 054: la invitación del comprador usa solo "nombre del producto" (title -> model) y deja brand = ''.
-- El check de 009 exigía brand con 1..60 caracteres, así que crear la propuesta fallaba con 23514 en prod.
-- orders ya acepta brand vacío; igualamos invitations. No borra ni modifica filas.
alter table public.invitations drop constraint if exists invitations_brand_check;
alter table public.invitations add constraint invitations_brand_check check (char_length(brand) <= 60);
