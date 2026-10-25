// Dónde cobra el vendedor (migración 029): 'wallet' = USDC directo a SU wallet Stellar (receiver del escrow) o
// 'iban' = el escrow libera a la wallet 'platform' y el equipo transfiere a la Cuenta IBAN a mano (cola payout_queue,
// panel /admin/pagos). Sin elección (o sin 029) = como siempre: la cuenta Stellar del vendedor en Meteorito (Cavos).
// El receiver de Trustless Work se fija al desplegar el escrow: cambiar la preferencia después NO cambia pedidos ya pagados.
// Todo degrada sin 029: sin columnas/tabla, receiverFor devuelve 'cavos' y la cola no se usa.
import { StrKey } from '@stellar/stellar-sdk';
import { db, logEvent } from './db';
import { env } from './env';
import { HttpError } from './auth';
import { isMissingTable } from './push';
import { missingColumn } from './listings';
import { walletState, type WalletState } from './wallet';

export type PayoutMethod = 'wallet' | 'iban';
export type PayoutRoute = 'cavos' | PayoutMethod;
export const isMissing = (e: any) => isMissingTable(e) || missingColumn(e);
export const normalizeStellar = (v: unknown) => String(v ?? '').trim().toUpperCase();
export const isStellarAddress = (v: unknown) => StrKey.isValidEd25519PublicKey(normalizeStellar(v));
export const PAYOUT_ERR = {
  unavailable: () => Object.assign(new HttpError(503, 'Todavía no puedes elegir dónde cobrar. Intenta más tarde.'), { code: 'payout_unavailable' }),
  address: () => Object.assign(new HttpError(400, 'Revisa la dirección: empieza con G y tiene 56 caracteres.'), { code: 'bad_stellar_address' }),
  noAccount: () => Object.assign(new HttpError(400, 'Esa wallet todavía no existe en Stellar. Actívala (con un poco de XLM) y vuelve a intentar.'), { code: 'wallet_no_account' }),
  platform: () => Object.assign(new HttpError(400, 'Usa la dirección de tu propia wallet.'), { code: 'bad_stellar_address' }),
};

/** Fila de seller_payout con la preferencia; null si no hay fila o no existe 029 (sin payout_method). */
export async function payoutPref(sellerSub: string | null | undefined): Promise<{ payout_method: PayoutMethod | null; stellar_address: string | null; iban: string | null; holder_name: string | null } | null> {
  if (!sellerSub) return null;
  const { data, error } = await db().from('seller_payout').select('*').eq('sub', sellerSub).maybeSingle();
  if (error || !data || !('payout_method' in data)) return null;
  return data as any;
}

/** ¿Existe 029 (columna payout_method)? Con la fila a mano se sabe sin consultar. Caché corta en memoria. */
let ready: { v: boolean; at: number } | null = null;
export const __resetPayoutChoiceCache = () => { ready = null; };
export async function payoutChoiceReady(row: Record<string, unknown> | null | undefined): Promise<boolean> {
  if (row && 'payout_method' in row) return true;
  if (ready && Date.now() - ready.at < 60_000) return ready.v;
  const { error } = await db().from('seller_payout').select('payout_method').limit(1);
  const v = !error ? true : isMissing(error) ? false : (ready?.v ?? false);
  ready = { v, at: Date.now() };
  return v;
}

/** Estado de una wallet para recibir USDC: ready | no_trustline | no_account. */
export async function checkWallet(address: unknown): Promise<WalletState> {
  if (!isStellarAddress(address)) throw PAYOUT_ERR.address();
  return walletState(normalizeStellar(address));
}

/** A quién libera el escrow de este pedido. Si la elección no está lista (sin trustline, sin cuenta), cae a 'cavos'. */
export async function receiverFor(order: any): Promise<{ address: string; route: PayoutRoute; note?: string }> {
  const fallback = { address: order.seller_address as string, route: 'cavos' as const };
  let pref; try { pref = await payoutPref(order.seller_user_id); } catch { return fallback; }
  if (pref?.payout_method === 'wallet' && isStellarAddress(pref.stellar_address)) {
    const addr = normalizeStellar(pref.stellar_address);
    const st = await walletState(addr).catch(() => 'error' as const);
    if (st === 'ready') return { address: addr, route: 'wallet' };
    return { ...fallback, note: `wallet ${st}` };
  }
  if (pref?.payout_method === 'iban' && pref.iban && pref.holder_name) {
    const platform = env.platformPublic();
    const st = await walletState(platform).catch(() => 'error' as const);
    if (st === 'ready') return { address: platform, route: 'iban' };
    return { ...fallback, note: `platform ${st}` };
  }
  return fallback;
}

/** Guarda en el pedido a quién libera (029). Best-effort: sin columnas queda solo en order_events. */
export async function savePayoutRoute(orderId: string, r: { address: string; route: PayoutRoute; note?: string }) {
  await logEvent(orderId, 'payout_route', { route: r.route, address: r.address, ...(r.note ? { note: r.note } : {}) });
  if (r.route === 'cavos') return;
  const { error } = await db().from('orders').update({ payout_method: r.route, payout_address: r.address }).eq('id', orderId);
  if (error && !isMissing(error)) console.warn('[payout] no se guardó la ruta en el pedido', error.code ?? error.message);
}
/** Dirección que recibe la parte del vendedor (release o disputa). */
export const sellerPayee = (order: any) => (order.payout_address as string | null) || (order.seller_address as string);

/** Monto neto que recibe el vendedor (TW cobra su fee al liberar). */
export const netUsdc = (gross: number) => Math.floor(gross * (1 - env.twFee()) * 1e7) / 1e7;

/** Cola manual: la parte del vendedor llegó a 'platform'; falta transferir a su Cuenta IBAN. Idempotente por pedido. */
export async function enqueueIbanPayout(order: any, p: { amountUsdc: number; amountCrc: number | null; tx: string | null }) {
  if (order.payout_method !== 'iban') return { queued: false };
  const pref = await payoutPref(order.seller_user_id).catch(() => null);
  if (!pref?.iban || !pref.holder_name) { await logEvent(order.id, 'payout_queue_failed', { reason: 'sin cuenta IBAN' }); return { queued: false }; }
  const row = { order_id: order.id, slug: order.slug, seller_sub: order.seller_user_id, amount_usdc: p.amountUsdc, amount_crc: p.amountCrc,
    iban: pref.iban, holder_name: pref.holder_name, state: 'pendiente', released_tx: p.tx, created_at: new Date().toISOString() };
  const { error } = await db().from('payout_queue').upsert(row, { onConflict: 'order_id', ignoreDuplicates: true });
  if (error) { console.warn('[payout] cola IBAN falló', error.code ?? error.message); await logEvent(order.id, 'payout_queue_failed', { reason: String(error.message ?? error.code).slice(0, 200) }); return { queued: false }; }
  await logEvent(order.id, 'payout_queued', { amount_usdc: p.amountUsdc, amount_crc: p.amountCrc, tx: p.tx });
  return { queued: true };
}

/* ---------- Admin ---------- */
export interface AdminPayoutRow { slug: string; state: 'pendiente' | 'pagado'; amount_usdc: number; amount_crc: number | null; iban: string; holder_name: string; released_tx: string | null; created_at: string; paid_at: string | null; paid_by: string | null; note: string | null; product: string | null }
export async function adminPayouts(): Promise<{ available: boolean; payouts: AdminPayoutRow[]; counts: { pendiente: number; pagado: number } }> {
  const { data, error } = await db().from('payout_queue').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) { if (isMissing(error)) return { available: false, payouts: [], counts: { pendiente: 0, pagado: 0 } }; throw error; }
  const rows = (data ?? []) as any[];
  const ids = rows.map((r) => r.order_id);
  const prod: Record<string, string> = {};
  if (ids.length) {
    const { data: os } = await db().from('orders').select('id, brand, model').in('id', ids);
    for (const o of os ?? []) prod[o.id] = `${o.brand ?? ''} ${o.model ?? ''}`.trim();
  }
  const payouts = rows.map((r) => ({ slug: r.slug, state: r.state, amount_usdc: Number(r.amount_usdc), amount_crc: r.amount_crc == null ? null : Number(r.amount_crc), iban: r.iban, holder_name: r.holder_name,
    released_tx: r.released_tx ?? null, created_at: r.created_at, paid_at: r.paid_at ?? null, paid_by: r.paid_by ?? null, note: r.note ?? null, product: prod[r.order_id] || null }));
  return { available: true, payouts, counts: { pendiente: payouts.filter((p) => p.state === 'pendiente').length, pagado: payouts.filter((p) => p.state === 'pagado').length } };
}
export async function markPayoutPaid(slug: unknown, by: { sub: string; email: string | null }, note: unknown) {
  const clean = String(note ?? '').trim().slice(0, 500);
  if (clean.length < 3) throw Object.assign(new HttpError(400, 'Escribe una nota (por ejemplo, el número de transferencia).'), { code: 'note_required' });
  const { data, error } = await db().from('payout_queue').select('*').eq('slug', String(slug ?? '')).maybeSingle();
  if (error) { if (isMissing(error)) throw PAYOUT_ERR.unavailable(); throw error; }
  if (!data) throw Object.assign(new HttpError(404, 'No encontramos ese pago pendiente.'), { code: 'not_found' });
  if (data.state === 'pagado') return { done: true, already: true, paid_at: data.paid_at };
  const at = new Date().toISOString();
  const { error: e2 } = await db().from('payout_queue').update({ state: 'pagado', paid_at: at, paid_by: by.email ?? by.sub, note: clean }).eq('order_id', data.order_id).eq('state', 'pendiente');
  if (e2) throw e2;
  await logEvent(data.order_id, 'payout_paid', { by: by.email ?? by.sub, note: clean });
  return { done: true, already: false, paid_at: at };
}
