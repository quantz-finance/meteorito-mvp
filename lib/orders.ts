import type { MeteoritoAuth } from './types';
import { restSelect } from './supabase';
import type { CheckResult } from './categories';
import { visibleSellerOrders } from './listings';
import { DEMO_ENABLED, demoGetPublicOrder, demoGetSellerOrders } from './demo';

export const PUBLIC_BASE_URL = 'https://pago.meteorito.app';
export const orderLink = (slug: string) => `${PUBLIC_BASE_URL}/p/${slug}`;
export const CRC_USDC_RATE = Number(process.env.EXPO_PUBLIC_CRC_USDC_RATE ?? 510); // debe igualar CRC_USDC_RATE del server
export const TW_FEE = 0.003; // Trustless Work cobra 0.3%

export { formatCRC, STATUS_LABEL } from './labels'; // puros (sin red ni RN): también los usan los tests
import { formatCRC } from './labels';
export const formatUSD = (crc: number) => `≈ ${(crc / CRC_USDC_RATE).toFixed(2)} USDC`;
export const formatUSDC = (n: number) => `${n.toFixed(2)} USDC`;


const ALPHA = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function randomSlug(len = 6): string {
  let out = '';
  while (out.length < len) {
    const bytes = new Uint8Array(len * 2);
    crypto.getRandomValues(bytes);
    for (const b of bytes) if (b < 252 && out.length < len) out += ALPHA[b % 36]; // 252 = 7*36, sin sesgo
  }
  return out;
}

/** Título visible del pedido. Los links en un paso guardan el título en `model` (brand vacío); los viejos, marca + modelo. */
export const orderTitle = (o: { brand?: string | null; model?: string | null } | null | undefined) =>
  `${o?.brand ?? ''} ${o?.model ?? ''}`.replace(/\s+/g, ' ').trim() || 'Artículo';

/** Link en un paso: solo título, precio y fotos son obligatorios; el resto es opcional (compatibilidad). */
export interface NewOrder {
  seller_address: string; seller_email: string | null; title?: string; category?: string; brand?: string; model?: string;
  condition?: string; price_crc: number; description?: string; identifier?: string; photos: string[]; checks?: CheckResult[];
  /** Código de la invitación de compra que este listing responde (el link queda reservado al comprador que invitó). */
  invite?: string;
  /** Acuerdo de entrega (migración 017; el servidor valida 24 h a 30 días). */
  delivery_mode?: 'envio' | 'cara_a_cara'; protection_minutes?: number;
  /** Link del anuncio importado: permite usar las fotos que el servidor guardó al importarlo y, con la migración 019,
   *  queda guardado con el proveedor (source_provider). */
  source_url?: string; source_provider?: string;
}

export async function createOrder(auth: MeteoritoAuth, o: Omit<NewOrder, 'seller_address' | 'seller_email'>): Promise<string> {
  const { api, proof } = await import('./api');
  const r = await api<{ slug: string }>(auth, '/api/orders/create', { ...o, proof: await proof(auth, 'create', 'new') });
  return r.slug;
}

export interface PublicOrder {
  slug: string; category: string; brand: string; model: string; condition: string; price_crc: number;
  description: string | null; photos: string[]; status: string; identifier_masked: string | null;
  amount_usdc?: number | null; contract_id?: string | null; funded_tx?: string | null; shipped_tx?: string | null; released_tx?: string | null; auto_release_at?: string | null;
  checks_summary: CheckResult[]; created_at: string;
  /** Migración 012: 'listing' = producto permanente (cada comprador tiene su pedido); listing_slug = producto del pedido. */
  kind?: 'single' | 'listing' | null; listing_slug?: string | null; listing_status?: 'activa' | 'pausada' | 'archivada' | null;
  /** Migración 013: resultado de la disputa (porcentaje devuelto al comprador). */
  resolution?: { buyerPct?: number | null } | null;
  /** Migración 017: acuerdo de entrega y extensión de mutuo acuerdo. Sin ella: envío, 7 días (defaults). */
  delivery_mode?: 'envio' | 'cara_a_cara' | null; protection_minutes?: number | null;
  release_ext?: { by: 'buyer' | 'seller'; days: number; at: string } | null; release_ext_minutes?: number | null;
  /** Opcionales: solo se muestran si el backend los expone (todavía no en public_orders). */
  seller_name?: string | null; seller_phone_verified?: boolean | null;
  /** true solo si Meteorito verificó el IMEI (no la declaración del vendedor). */
  imei_verified?: boolean | null; imei_last4?: string | null;
}
export async function getPublicOrder(slug: string): Promise<PublicOrder | null> {
  if (DEMO_ENABLED) return demoGetPublicOrder(slug) as PublicOrder | null;
  const rows = await restSelect<PublicOrder[]>(`public_orders?select=*&slug=eq.${encodeURIComponent(slug)}&limit=1`);
  return rows[0] ?? null;
}

export interface SellerOrder {
  slug: string; category: string; brand: string; model: string; price_crc: number; status: string; identifier_masked: string | null; created_at: string;
  /** Migración 012 (seller_orders_v2). Sin ella: undefined = link de un uso. */
  kind?: 'single' | 'listing'; listing_slug?: string | null; listing_status?: 'activa' | 'pausada' | 'archivada';
  /** Migración 017: tipo de entrega (cara a cara no tiene paso "Enviado"). */
  delivery_mode?: 'envio' | 'cara_a_cara' | null;
  /** Historial de ventas: cuándo se cerró y, si hubo disputa, qué porcentaje volvió al comprador. */
  released_at?: string | null; resolved_at?: string | null; resolution?: { buyerPct?: number | null } | null;
}
/** Pedidos del vendedor: por la API con su sesión (solo los suyos). La RPC pública seller_orders se revoca en la 013. */
export async function getSellerOrders(auth: MeteoritoAuth): Promise<SellerOrder[]> {
  if (DEMO_ENABLED) return demoGetSellerOrders(auth.address ?? '');
  const { api } = await import('./api');
  return visibleSellerOrders((await api<{ orders: SellerOrder[] }>(auth, '/api/store', { action: 'orders' })).orders ?? []);
}
export { visibleSellerOrders } from './listings';

/** "rolando.arguello" -> "Rolando". */
export function displayName(email: string | null | undefined): string | null {
  const raw = email?.split('@')[0]?.split(/[._+-]/)[0]?.trim();
  if (!raw) return null;
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

/** Acepta un link completo (…/p/slug) o el slug solo. */
export function parseSlug(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  const m = t.match(/\/p\/([A-Za-z0-9_-]+)/);
  const slug = m ? m[1] : t.replace(/^\/+|\/+$/g, '');
  return /^[A-Za-z0-9_-]{3,64}$/.test(slug) ? slug : null;
}
