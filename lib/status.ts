// Textos de estado final (puro, testeable). 'resuelto' puede ser reembolso, pago al vendedor o reparto:
// nunca decir "Pago liberado" si el dinero volvió al comprador.
export interface ResolvableOrder { status: string; resolution?: { buyerPct?: number | null } | null }
export function resolvedLabel(o: ResolvableOrder): string {
  if (o.status === 'liberado') return 'Pago liberado';
  if (o.status === 'entregado') return 'Entregado';
  if (o.status !== 'resuelto') return '';
  const pct = o.resolution?.buyerPct;
  if (typeof pct !== 'number') return 'Disputa resuelta';
  if (pct >= 100) return 'Reembolsado';
  if (pct <= 0) return 'Disputa resuelta: pago al vendedor';
  return `Disputa resuelta: ${Math.round(pct)} % reembolsado`;
}
