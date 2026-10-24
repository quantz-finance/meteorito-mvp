// Etiquetas puras (sin red ni React Native): precio en colones y estado del pedido. lib/orders las reexporta.
export const formatCRC = (n: number) => '₡' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export const STATUS_LABEL: Record<string, string> = {
  creado: 'Disponible', escrow_creado: 'Esperando pago', fondeado: 'Pagado · fondos apartados', enviado: 'Enviado', entregado: 'Recibido', liberado: 'Pago liberado', en_disputa: 'En disputa', resuelto: 'Resuelto', cancelado: 'Cancelado',
};
