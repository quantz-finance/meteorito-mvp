// Envío simple: el código de entrega (PIN) del comprador se muestra solo cuando el vendedor ya tocó "Ya lo envié".
// Antes no sirve (el servidor solo acepta el PIN con el pedido 'enviado') y darlo antes invita a liberar sin recibir.
// Cara a cara no hay envío: el código se ve apenas se paga ('fondeado') y el vendedor lo ingresa al entregar.
export const deliveryCodeVisible = (status: string | null | undefined, mode?: string | null) =>
  status === 'enviado' || (mode === 'cara_a_cara' && status === 'fondeado');
export const PAID_WAITING = 'Pagado. Esperando que el vendedor lo envíe.';
export const F2F_CODE_HINT = 'Dáselo al vendedor cuando revises el producto.';
export const F2F_PAID = 'Pagado. Revisa el producto y dale tu código al vendedor.';
