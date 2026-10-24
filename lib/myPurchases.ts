// Carga de "Mis compras": registro local + pedidos del servidor por la llave de invitado y/o la sesión (sin función
// nueva: /api/store action 'buyer_orders') + vista pública de los slugs que este dispositivo guardó (PIN o pedido propio
// de un producto permanente), para compras hechas antes de que existiera el registro.
import type { MeteoritoAuth } from './types';
import { guestApi } from './api';
import { hasGuestKey } from './guest';
import { getPublicOrder } from './orders';
import { localPurchaseSlugs, mergePurchases, readLocalPurchases, rememberPurchase, rowFromOrder, type PurchaseRow } from './purchases';

const MAX_PUBLIC_LOOKUPS = 20;

export async function loadMyPurchases(auth: Pick<MeteoritoAuth, 'getAuthToken' | 'isAuthenticated'>): Promise<{ rows: PurchaseRow[]; serverFailed: boolean }> {
  const local = readLocalPurchases();
  let server: PurchaseRow[] = []; let serverFailed = false;
  if (hasGuestKey() || auth.isAuthenticated) {
    try {
      const r = await guestApi<{ orders: any[] }>(auth, '/api/store', { action: 'buyer_orders' });
      server = (r.orders ?? []).map(rowFromOrder).filter(Boolean) as PurchaseRow[];
    } catch { serverFailed = true; }
  }
  const known = new Set(server.map((r) => r.slug));
  const missing = localPurchaseSlugs().filter((s) => !known.has(s)).slice(0, MAX_PUBLIC_LOOKUPS);
  const pub = (await Promise.all(missing.map((s) => getPublicOrder(s).then(rowFromOrder).catch(() => null)))).filter(Boolean) as PurchaseRow[];
  const rows = mergePurchases(server, pub, local);
  // Lo recuperado queda en el registro de este dispositivo (la próxima vez aparece aunque falle la red).
  for (const r of [...server, ...pub]) if (r.status && r.status !== 'creado') rememberPurchase(r);
  return { rows, serverFailed };
}
