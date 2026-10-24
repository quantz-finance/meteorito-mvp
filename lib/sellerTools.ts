// Herramientas del vendedor (puro, testeable): plantilla de anuncio para pegar en Facebook, WhatsApp o Marketplace e
// historial de ventas con estado y resultado. Sin red: la app usa /api/store (action 'orders') y el demo, lo mismo.
import { agreementSummary, deliveryModeOf, protectionOf } from '../api/_lib/agreement';
import { formatCRC, STATUS_LABEL } from './labels';
import { COPY } from './copy';

export type AdFormat = 'whatsapp' | 'marketplace';
export const AD_FORMATS: { key: AdFormat; label: string }[] = [
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'marketplace', label: 'Facebook o Marketplace' },
];
export const AD_TITLE = COPY.adTemplate.title;
export const AD_HINT = 'Texto listo para pegar en tu publicación o chat, con tu link de pago.';
export const AD_COPY = COPY.adTemplate.copy;
export const AD_COPIED = COPY.adTemplate.copied;
/** Cómo funciona el pago (copy aprobado, lib/copy.ts). */
export const AD_CUSTODY = COPY.adTemplate.custody;

export interface AdInput { title: string; price_crc: number; link: string; description?: string | null; delivery_mode?: string | null; protection_minutes?: number | null }

export function adTemplate(o: AdInput, format: AdFormat): string {
  const title = o.title.trim() || 'Artículo';
  const mode = deliveryModeOf(o);
  const agreement = agreementSummary(mode, protectionOf({ delivery_mode: mode, protection_minutes: o.protection_minutes }));
  if (format === 'whatsapp') {
    return [`${title} por ${formatCRC(o.price_crc)}.`, agreement, AD_CUSTODY, COPY.adTemplate.payHere(o.link)].join('\n');
  }
  const desc = (o.description ?? '').trim().slice(0, 500);
  return [
    `${title} · ${formatCRC(o.price_crc)}`,
    ...(desc ? ['', desc] : []),
    '',
    'Cómo es la compra:',
    ...agreement.split(' · ').map((l) => `- ${l}`),
    `- ${AD_CUSTODY}`,
    '',
    COPY.adTemplate.payHere(o.link),
  ].join('\n');
}

// ---------- Historial de ventas ----------
export const HISTORY_TITLE = COPY.salesHistory.title;
export const HISTORY_EMPTY = 'Todavía no tienes ventas. Cuando alguien pague uno de tus links, aparece aquí.';
export type Outcome = 'cobrado' | 'parcial' | 'reembolsado' | 'cancelado' | 'en_curso';
export const OUTCOME_LABEL: Record<Outcome, string> = {
  cobrado: COPY.salesHistory.cobrado, parcial: COPY.salesHistory.parcial, reembolsado: COPY.salesHistory.reembolsado, cancelado: COPY.salesHistory.cancelado, en_curso: COPY.salesHistory.enCurso,
};
const CLOSED = ['liberado', 'resuelto', 'cancelado'];

export interface HistoryOrder {
  slug: string; brand?: string | null; model?: string | null; price_crc: number; status: string; created_at: string;
  kind?: string | null; listing_slug?: string | null; delivery_mode?: string | null;
  released_at?: string | null; resolved_at?: string | null; resolution?: { buyerPct?: number | null } | null;
}
export interface SaleRow { slug: string; title: string; price_crc: number; status: string; statusLabel: string; outcome: Outcome; outcomeLabel: string; collected: number; date: string; closed: boolean }

/** Lo que cobró el vendedor en un pedido cerrado (resuelto: la parte que no volvió al comprador). */
export function collectedOf(o: HistoryOrder): number {
  if (o.status === 'liberado') return o.price_crc;
  if (o.status !== 'resuelto') return 0;
  const pct = o.resolution?.buyerPct;
  if (typeof pct !== 'number') return 0;
  return Math.round(o.price_crc * Math.max(0, Math.min(100, 100 - pct)) / 100);
}
export function outcomeOf(o: HistoryOrder): Outcome {
  if (o.status === 'liberado') return 'cobrado';
  if (o.status === 'cancelado') return 'cancelado';
  if (o.status !== 'resuelto') return 'en_curso';
  const pct = o.resolution?.buyerPct;
  if (typeof pct !== 'number') return 'en_curso'; // resuelto sin detalle: no inventar el resultado
  return pct >= 100 ? 'reembolsado' : pct <= 0 ? 'cobrado' : 'parcial';
}
/** Ventas = pedidos con comprador (no los links sin pagar ni el producto permanente), más recientes primero. */
export function salesHistory(orders: HistoryOrder[]): SaleRow[] {
  return orders
    .filter((o) => o.status !== 'creado' && o.kind !== 'listing')
    .map((o) => {
      const outcome = outcomeOf(o);
      const collected = collectedOf(o);
      const resultLabel = outcome === 'parcial' ? `${OUTCOME_LABEL.parcial}: ${formatCRC(collected)}`
        : o.status === 'resuelto' && outcome === 'en_curso' ? COPY.salesHistory.disputaResuelta : OUTCOME_LABEL[outcome];
      return {
        slug: o.slug, title: `${o.brand ?? ''} ${o.model ?? ''}`.trim() || 'Artículo', price_crc: o.price_crc, status: o.status,
        statusLabel: STATUS_LABEL[o.status] ?? o.status, outcome, outcomeLabel: resultLabel, collected,
        date: o.released_at ?? o.resolved_at ?? o.created_at, closed: CLOSED.includes(o.status),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}
export interface HistoryTotals { collected: number; closed: number; open: number }
export function historyTotals(rows: SaleRow[]): HistoryTotals {
  return { collected: rows.reduce((n, r) => n + r.collected, 0), closed: rows.filter((r) => r.closed && r.outcome !== 'cancelado').length, open: rows.filter((r) => !r.closed).length };
}
export function totalsLine(t: HistoryTotals): string {
  return `Cobrado: ${formatCRC(t.collected)} · ${t.closed} ${t.closed === 1 ? 'venta cerrada' : 'ventas cerradas'} · ${t.open} en curso`;
}
/** "24 oct 2026" (fecha corta en español, zona local). */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const M = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}`;
}
