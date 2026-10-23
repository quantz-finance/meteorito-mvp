// Mensaje listo para pegar en Messenger / WhatsApp cuando el comprador invita al vendedor. Puro (sin red), en tuteo.
const crc = (n: number) => '₡' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export function inviteShareMessage(inv: { title: string; price_crc: number; source_url?: string | null }, link: string): string {
  const what = inv.source_url ? `Hola, vi tu anuncio de ${inv.title} en Facebook Marketplace y te lo quiero comprar por ${crc(inv.price_crc)}.`
    : `Hola, quiero comprarte ${inv.title} por ${crc(inv.price_crc)}.`;
  return `${what} Te pago con Meteorito: el dinero queda en custodia y te llega cuando me entregues. Acepta la compra aquí: ${link}`;
}
