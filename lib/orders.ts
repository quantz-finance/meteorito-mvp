import type { MeteoritoAuth } from './types';
import { supabase } from './supabase';
import type { CheckResult } from './categories';
import { DEMO_ENABLED, demoGetPublicOrder, demoGetSellerOrders } from './demo';

export const PUBLIC_BASE_URL = 'https://pago.meteorito.app';
export const orderLink = (slug: string) => `${PUBLIC_BASE_URL}/p/${slug}`;
export const CRC_USDC_RATE = Number(process.env.EXPO_PUBLIC_CRC_USDC_RATE ?? 510); // debe igualar CRC_USDC_RATE del server
export const TW_FEE = 0.003; // Trustless Work cobra 0.3%

export const formatCRC = (n: number) => '₡' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const formatUSD = (crc: number) => `≈ ${(crc / CRC_USDC_RATE).toFixed(2)} USDC (testnet)`;
export const formatUSDC = (n: number) => `${n.toFixed(2)} USDC`;

export const STATUS_LABEL: Record<string, string> = {
  creado: 'Disponible', escrow_creado: 'Esperando pago', fondeado: 'Pagado · fondos apartados', enviado: 'Enviado', entregado: 'Recibido', liberado: 'Pago liberado', en_disputa: 'En disputa', resuelto: 'Resuelto', cancelado: 'Cancelado',
};

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

export interface NewOrder {
  seller_address: string; seller_email: string | null; category: string; brand: string; model: string;
  condition: string; price_crc: number; description: string; identifier: string; photos: string[]; checks: CheckResult[];
}

export async function createOrder(auth: MeteoritoAuth, o: Omit<NewOrder, 'seller_address' | 'seller_email'>): Promise<string> {
  const { api, proof } = await import('./api');
  const r = await api<{ slug: string }>(auth, '/api/orders/create', { ...o, proof: await proof(auth, 'create', 'new') });
  return r.slug;
}

export interface PublicOrder {
  slug: string; category: string; brand: string; model: string; condition: string; price_crc: number;
  description: string | null; photos: string[]; status: string; identifier_masked: string | null;
  amount_usdc?: number | null; contract_id?: string | null; funded_tx?: string | null; released_tx?: string | null; auto_release_at?: string | null;
  checks_summary: CheckResult[]; created_at: string;
  /** Opcionales: solo se muestran si el backend los expone (todavía no en public_orders). */
  seller_name?: string | null; seller_phone_verified?: boolean | null;
  /** true solo si Meteorito verificó el IMEI (no la declaración del vendedor). */
  imei_verified?: boolean | null; imei_last4?: string | null;
}
export async function getPublicOrder(slug: string): Promise<PublicOrder | null> {
  if (DEMO_ENABLED) return demoGetPublicOrder(slug) as PublicOrder | null;
  const { data, error } = await supabase().from('public_orders').select('*').eq('slug', slug).maybeSingle();
  if (error) throw new Error(error.message);
  return data as PublicOrder | null;
}

export interface SellerOrder { slug: string; category: string; brand: string; model: string; price_crc: number; status: string; identifier_masked: string | null; created_at: string }
export async function getSellerOrders(addr: string): Promise<SellerOrder[]> {
  if (DEMO_ENABLED) return demoGetSellerOrders(addr);
  const { data, error } = await supabase().rpc('seller_orders', { p_seller_address: addr });
  if (error) throw new Error(error.message);
  return (data ?? []) as SellerOrder[];
}

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
