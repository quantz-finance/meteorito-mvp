// Mensaje listo para pegar en Messenger / WhatsApp cuando el comprador invita al vendedor. Puro (sin red), en tuteo.
import { checkListingUrl } from '../api/_lib/importers/providers';
const crc = (n: number) => '₡' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export function inviteShareMessage(inv: { title: string; price_crc: number; source_url?: string | null }, link: string): string {
  const where = inv.source_url ? sourceName(inv.source_url) : null;
  const what = where ? `Hola, vi tu anuncio de ${inv.title} en ${where === 'Facebook' ? 'Facebook Marketplace' : where} y te lo quiero comprar por ${crc(inv.price_crc)}.`
    : `Hola, quiero comprarte ${inv.title} por ${crc(inv.price_crc)}.`;
  return `${what} Te pago con Meteorito: el dinero queda en custodia y te llega cuando me entregues. Acepta la compra aquí: ${link}`;
}

/** El chip de categoría solo aporta si es una categoría real ("otro" o vacío no dicen nada al vendedor). */
export const showCategoryChip = (category: string | null | undefined) => !!category && category.trim().toLowerCase() !== 'otro';

/** Dónde está el anuncio de la invitación: "Facebook", "Mercado Libre", "Amazon"… o el dominio de la tienda. */
export function sourceName(url: string | null | undefined): string | null {
  const c = url ? checkListingUrl(url) : null;
  if (!c?.ok) return null;
  return c.provider.id === 'web' ? new URL(c.url).hostname.replace(/^www\./, '') : c.provider.name;
}
