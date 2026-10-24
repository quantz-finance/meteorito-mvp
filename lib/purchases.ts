// Mis compras (comprador): qué compró ESTE dispositivo o esta cuenta y en qué va cada compra. Puro (sin red ni React
// Native): lo usan la pantalla /mis-compras, el PayBox al pagar y los tests.
// Fuentes en el dispositivo (solo slugs públicos + lo que se muestra en la fila; nada de la llave ni del PIN):
//  - meteorito:purchases:v1           registro que se guarda al iniciar y al completar el pago (este cambio).
//  - meteorito:guest:pin:<slug>       PIN guardado al pagar (compras anteriores a este registro: recuperación retroactiva).
//  - meteorito.listing-orders         pedido propio de cada producto permanente (/p/<producto> -> /p/<pedido>).
// La lista del servidor (/api/store action 'buyer_orders') sale de la llave de invitado y/o la sesión Cavos.
import { formatCRC, STATUS_LABEL } from './labels';
import { resolvedLabel } from './status';

export const PURCHASES_KEY = 'meteorito:purchases:v1';
const PIN_PREFIX = 'meteorito:guest:pin:';
const LISTING_KEY = 'meteorito.listing-orders';
const MAX = 50;
const SLUG = /^[A-Za-z0-9_-]{3,64}$/;

export const MY_PURCHASES_TITLE = 'Mis compras';
export const MY_PURCHASES_EMPTY = 'Aquí van a aparecer las compras que hagas en este dispositivo o con tu cuenta.';
export const MY_PURCHASES_ACTIVE = 'Activas';
export const MY_PURCHASES_CLOSED = 'Cerradas';
export const MY_PURCHASES_NONE_ACTIVE = 'No tienes compras activas.';

export interface PurchaseRow {
  slug: string; title: string; price_crc: number; photo: string | null; status: string | null;
  delivery_mode?: 'envio' | 'cara_a_cara' | null; resolution?: { buyerPct?: number | null } | null;
  /** Último momento conocido (pago, inicio o creación): ordena lo más reciente primero. */
  at: string | null;
}
type Store = Pick<Storage, 'getItem' | 'setItem'> & { length?: number; key?: (i: number) => string | null };

function storage(): Store | null { try { return (globalThis as any).localStorage ?? null; } catch { return null; } }
const num = (n: unknown) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const cleanRow = (r: any): PurchaseRow | null => (r && typeof r.slug === 'string' && SLUG.test(r.slug) ? {
  slug: r.slug, title: typeof r.title === 'string' && r.title.trim() ? r.title.trim().slice(0, 120) : 'Artículo', price_crc: num(r.price_crc),
  photo: typeof r.photo === 'string' && /^(https:\/\/|\/(?!\/))/.test(r.photo) ? r.photo : null, status: typeof r.status === 'string' ? r.status : null,
  delivery_mode: r.delivery_mode === 'cara_a_cara' || r.delivery_mode === 'envio' ? r.delivery_mode : null,
  resolution: r.resolution && typeof r.resolution === 'object' ? { buyerPct: typeof r.resolution.buyerPct === 'number' ? r.resolution.buyerPct : null } : null,
  at: typeof r.at === 'string' ? r.at : null,
} : null);

/** Registro local de compras de este dispositivo. */
export function readLocalPurchases(s: Store | null = storage()): PurchaseRow[] {
  try { const a = JSON.parse(s?.getItem(PURCHASES_KEY) ?? '[]'); return Array.isArray(a) ? a.map(cleanRow).filter(Boolean) as PurchaseRow[] : []; } catch { return []; }
}
/** Guarda (o actualiza) una compra de este dispositivo: lo justo para la fila y para volver a /p/<slug>. */
export function rememberPurchase(p: { slug: string; title?: string | null; price_crc?: number | null; photo?: string | null; status?: string | null; delivery_mode?: string | null; at?: string | null }, s: Store | null = storage()) {
  const row = cleanRow({ ...p, at: p.at ?? new Date().toISOString() });
  if (!row || !s) return;
  try {
    const prev = readLocalPurchases(s); const old = prev.find((x) => x.slug === row.slug);
    const merged = old ? { ...old, ...Object.fromEntries(Object.entries(row).filter(([k, v]) => v != null && !(k === 'title' && v === 'Artículo'))) } as PurchaseRow : row;
    s.setItem(PURCHASES_KEY, JSON.stringify([merged, ...prev.filter((x) => x.slug !== row.slug)].slice(0, MAX)));
  } catch { /* storage lleno o bloqueado */ }
}

/** Todos los pedidos que este dispositivo sabe que son suyos: registro nuevo + PIN guardado + pedido propio de productos. */
export function localPurchaseSlugs(s: Store | null = storage()): string[] {
  const out = new Set(readLocalPurchases(s).map((r) => r.slug));
  try {
    const n = Number(s?.length ?? 0);
    for (let i = 0; i < n; i++) { const k = s?.key?.(i) ?? ''; if (k.startsWith(PIN_PREFIX) && SLUG.test(k.slice(PIN_PREFIX.length))) out.add(k.slice(PIN_PREFIX.length)); }
  } catch { /* */ }
  try { const m = JSON.parse(s?.getItem(LISTING_KEY) ?? '{}') ?? {}; for (const v of Object.values(m)) if (typeof v === 'string' && SLUG.test(v)) out.add(v); } catch { /* */ }
  return [...out];
}
export const hasLocalPurchases = (s: Store | null = storage()) => localPurchaseSlugs(s).length > 0;

/** Junta filas (servidor, vista pública, registro local): por slug, gana el dato más fresco; el local completa foto y título. */
export function mergePurchases(...lists: (PurchaseRow | null | undefined)[][]): PurchaseRow[] {
  const by = new Map<string, PurchaseRow>();
  for (const list of lists) for (const r of list) {
    if (!r) continue; const old = by.get(r.slug);
    by.set(r.slug, old ? { ...r, ...Object.fromEntries(Object.entries(old).filter(([, v]) => v != null)), title: old.title !== 'Artículo' ? old.title : r.title } as PurchaseRow : r);
  }
  return [...by.values()];
}

/** Activa = todavía hay algo por pasar (pago sin terminar, pagado, enviado, esperando tu código, en disputa). */
const ACTIVE = ['escrow_creado', 'fondeado', 'enviado', 'en_disputa'];
const CLOSED = ['entregado', 'liberado', 'resuelto', 'cancelado'];
export const isActivePurchase = (r: Pick<PurchaseRow, 'status'>) => !!r.status && ACTIVE.includes(r.status);
/** Sin estado conocido o 'creado' (empezó a pagar y no siguió, o el link ya no existe): no es una compra. */
export const isPurchase = (r: Pick<PurchaseRow, 'status'>) => !!r.status && (ACTIVE.includes(r.status) || CLOSED.includes(r.status));

export function purchaseStatus(r: Pick<PurchaseRow, 'status' | 'resolution'>): string {
  if (r.status === 'resuelto' || r.status === 'liberado' || r.status === 'entregado') return resolvedLabel({ status: r.status, resolution: r.resolution });
  if (r.status === 'fondeado') return 'Pagado';
  return (r.status && STATUS_LABEL[r.status]) || 'Sin datos';
}
/** Siguiente paso, en una línea, desde el lado del comprador. */
export function purchaseNext(r: Pick<PurchaseRow, 'status' | 'delivery_mode'>): string {
  const f2f = r.delivery_mode === 'cara_a_cara';
  switch (r.status) {
    case 'escrow_creado': return 'Termina el pago para apartar el dinero.';
    case 'fondeado': return f2f ? 'Revisa el producto y dale tu código al vendedor.' : 'Esperando que el vendedor lo envíe.';
    case 'enviado': return 'Cuando lo recibas, dale tu código al vendedor.';
    case 'en_disputa': return 'Lo estamos revisando. El pago está en pausa.';
    case 'entregado': return 'Recibido. El pago se está liberando.';
    case 'liberado': return 'Compra terminada.';
    case 'resuelto': return 'Disputa cerrada.';
    case 'cancelado': return 'Esta compra se canceló.';
    default: return '';
  }
}
export const purchaseA11y = (r: PurchaseRow) => `${r.title}, ${formatCRC(r.price_crc)}, ${purchaseStatus(r)}. ${purchaseNext(r)}`.trim();

/** Activas primero (lo más reciente arriba) y cerradas aparte. Se descartan las que no son compras. */
export function splitPurchases(rows: PurchaseRow[]): { active: PurchaseRow[]; closed: PurchaseRow[] } {
  const t = (r: PurchaseRow) => Date.parse(r.at ?? '') || 0;
  const list = rows.filter(isPurchase).sort((a, b) => t(b) - t(a));
  return { active: list.filter(isActivePurchase), closed: list.filter((r) => !isActivePurchase(r)) };
}

/** Fila desde la vista pública o el API del comprador (mismas columnas). */
export function rowFromOrder(o: any): PurchaseRow | null {
  return cleanRow({
    slug: o?.slug, title: `${o?.brand ?? ''} ${o?.model ?? o?.title ?? ''}`.replace(/\s+/g, ' ').trim(), price_crc: o?.price_crc,
    photo: o?.photo ?? o?.photos?.[0] ?? null, status: o?.status, delivery_mode: o?.delivery_mode, resolution: o?.resolution,
    at: o?.funded_at ?? o?.created_at ?? null,
  });
}
