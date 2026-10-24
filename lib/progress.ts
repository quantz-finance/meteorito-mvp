/** Pasos del dinero. Envío: Pagado, Enviado, Entregado, Liberado. Cara a cara no hay envío: Pagado, Entregado con PIN, Liberado. */
export type MoneyMode = 'envio' | 'cara_a_cara' | string | null | undefined;
export const isF2F = (mode: MoneyMode) => mode === 'cara_a_cara';
export const moneyStepKeys = (mode?: MoneyMode) => (isF2F(mode) ? ['pagado', 'entregado_pin', 'liberado'] : ['pagado', 'enviado', 'entregado', 'liberado']);

/** Cuántos pasos del dinero están completos según el status del pedido (y el tipo de entrega). */
export function moneyProgress(status: string, shipped?: boolean, mode?: MoneyMode): number {
  if (isF2F(mode)) switch (status) { // cara a cara: en 'fondeado' el paso actual es "Entregado con PIN", nunca "Enviado"
    case 'fondeado': case 'en_disputa': return 1;
    case 'entregado': return 2;
    case 'liberado': case 'resuelto': return 3;
    default: return 0;
  }
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
