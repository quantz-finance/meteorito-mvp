import { supabase } from './supabase';
import type { CheckResult } from './categories';

export const PUBLIC_BASE_URL = 'https://meteorito-mvp.vercel.app';
export const orderLink = (slug: string) => `${PUBLIC_BASE_URL}/p/${slug}`;
export const USD_RATE_CRC = Number(process.env.EXPO_PUBLIC_CRC_PER_USD ?? 505); // solo referencia

export const formatCRC = (n: number) => '₡' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const formatUSD = (crc: number) => `≈ US$${(crc / USD_RATE_CRC).toFixed(0)}`;

export const STATUS_LABEL: Record<string, string> = {
  creado: 'Creado', pagado: 'Pagado', entregado: 'Entregado', liberado: 'Liberado', disputa: 'En disputa', cancelado: 'Cancelado',
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

export async function createOrder(o: NewOrder): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = randomSlug();
    // Sin .select(): anon no puede leer la tabla orders.
    const { error } = await supabase().from('orders').insert({ ...o, slug, status: 'creado' });
    if (!error) return slug;
    if (error.code !== '23505') throw new Error(error.message);
  }
  throw new Error('No se pudo generar un link único, probá de nuevo');
}

export async function uploadPhoto(uri: string, sellerAddress: string, mime = 'image/jpeg'): Promise<string> {
  const raw = await (await fetch(uri)).blob();
  // Storage rechaza application/octet-stream: forzar el MIME (en nativo/algunos navegadores el blob viene sin type).
  const type = raw.type && raw.type.startsWith('image/') ? raw.type : mime;
  const blob = raw.type === type ? raw : new Blob([await raw.arrayBuffer()], { type });
  const ext = (type.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg');
  const path = `${sellerAddress}/${Date.now()}-${randomSlug(8)}.${ext}`;
  const { error } = await supabase().storage.from('listings').upload(path, blob, { contentType: type, upsert: false });
  if (error) throw new Error(error.message);
  return supabase().storage.from('listings').getPublicUrl(path).data.publicUrl;
}

export interface PublicOrder {
  slug: string; category: string; brand: string; model: string; condition: string; price_crc: number;
  description: string | null; photos: string[]; status: string; identifier_masked: string | null;
  checks_summary: CheckResult[]; created_at: string;
}
export async function getPublicOrder(slug: string): Promise<PublicOrder | null> {
  const { data, error } = await supabase().from('public_orders').select('*').eq('slug', slug).maybeSingle();
  if (error) throw new Error(error.message);
  return data as PublicOrder | null;
}

export interface SellerOrder { slug: string; category: string; brand: string; model: string; price_crc: number; status: string; identifier_masked: string | null; created_at: string }
export async function getSellerOrders(addr: string): Promise<SellerOrder[]> {
  const { data, error } = await supabase().rpc('seller_orders', { p_seller_address: addr });
  if (error) throw new Error(error.message);
  return (data ?? []) as SellerOrder[];
}
