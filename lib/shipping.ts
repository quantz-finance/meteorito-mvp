// Envío simple: el código de entrega (PIN) del comprador se muestra solo cuando el vendedor ya tocó "Ya lo envié".
// Antes no sirve (el servidor solo acepta el PIN con el pedido 'enviado') y darlo antes invita a liberar sin recibir.
export const deliveryCodeVisible = (status: string | null | undefined) => status === 'enviado';
export const PAID_WAITING = 'Pagado. Esperando que el vendedor lo envíe.';
