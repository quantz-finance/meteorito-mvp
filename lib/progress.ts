/** Cuántos pasos del dinero están completos según el status del pedido. */
export function moneyProgress(status: string, shipped?: boolean): number {
  switch (status) {
    case 'fondeado': return 1;
    case 'enviado': return 2;
    // Disputa: solo se abre con fondos apartados; "Enviado" cuenta únicamente si el vendedor lo marcó (shipped_tx).
    case 'en_disputa': return shipped ? 2 : 1;
    case 'entregado': return 3;
    case 'liberado': case 'resuelto': return 4;
    default: return 0;
  }
}
