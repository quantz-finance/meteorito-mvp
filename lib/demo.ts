// MODO DEMO (apagado por defecto). Sirve para grabar videos sin login humano ni backend real.
// - Se activa SOLO con EXPO_PUBLIC_DEMO_MODE=1 en el build/arranque (valor inlineado por Expo).
// - Aunque la variable esté puesta, se desactiva sola en los dominios de producción.
// - No hace ninguna llamada de red: el estado vive en memoria (+ sessionStorage de la pestaña) y todo es simulado.
// Documentación: docs/demo.md
import { useSyncExternalStore } from 'react';
import type { MeteoritoAuth } from './types';

/** Dominios donde el modo demo NUNCA se activa, aunque la variable esté definida. */
export const DEMO_BLOCKED_HOSTS = ['pago.meteorito.app', 'meteorito.app', 'www.meteorito.app'];

/** Función pura (testeable): ¿el valor de la variable activa el modo demo en este host? */
export function demoEnabled(flag: string | undefined, host?: string | null): boolean {
  if (!/^(1|true)$/i.test((flag ?? '').trim())) return false;
  if (host && DEMO_BLOCKED_HOSTS.includes(host.toLowerCase())) return false;
  return true;
}
// Expo inlinea EXPO_PUBLIC_* solo con acceso estático process.env.X.
export const DEMO_ENABLED = demoEnabled(process.env.EXPO_PUBLIC_DEMO_MODE, typeof window !== 'undefined' ? window.location?.hostname : null);

export type DemoRole = 'seller' | 'buyer';
type Status = 'creado' | 'escrow_creado' | 'fondeado' | 'enviado' | 'entregado' | 'liberado' | 'en_disputa' | 'resuelto' | 'cancelado';

export interface DemoOrder {
  slug: string; category: string; brand: string; model: string; condition: string; price_crc: number;
  description: string | null; photos: string[]; status: string; identifier_masked: string | null;
  amount_usdc: number | null; contract_id: string | null; funded_tx: string | null; released_tx: string | null; auto_release_at: string | null;
  checks_summary: { id: string; label: string; blocksRelease: boolean; ok: boolean }[]; created_at: string;
  seller_address: string; pin: string | null; pinShown: boolean; shipped_tx: string | null; evidence: unknown; dispute: unknown;
}
interface DemoState { role: DemoRole; badge: boolean; seq: number; orders: Record<string, DemoOrder> }

export const DEMO_PIN = '482915';
const RATE = Number(process.env.EXPO_PUBLIC_CRC_USDC_RATE ?? 510);
const STORE_KEY = 'meteorito:demo:v1';
const START_BALANCE_USDC = 120;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** Hash determinista (FNV-1a, 32 bits) -> bytes pseudoaleatorios estables para datos de ejemplo. */
function stream(seed: string, n: number): number[] {
  let h = 2166136261; const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = seed + ':' + i;
    for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619) >>> 0; }
    out.push(h >>> 8 & 0xff);
  }
  return out;
}
export const demoTxHash = (seed: string) => stream('tx:' + seed, 32).map((b) => b.toString(16).padStart(2, '0')).join('');
/** Dirección de ejemplo con formato Stellar (G + 55 de base32). NO es una cuenta real: un enlace a stellar.expert mostrará "no encontrado". */
const demoAddress = (prefix: string, seed: string) => ('G' + prefix + stream('addr:' + seed, 55).map((b) => B32[b % 32]).join('')).slice(0, 56);
export const DEMO_SELLER = { address: demoAddress('DEMOSELLER', 'seller'), email: 'valeria.vendedora@demo.meteorito.app' };
export const DEMO_BUYER = { address: demoAddress('DEMOBUYER', 'buyer'), email: 'diego.comprador@demo.meteorito.app' };
export const demoContractId = (seed: string) => 'C' + stream('ct:' + seed, 55).map((b) => B32[b % 32]).join('');

let state: DemoState | null = null;
const listeners = new Set<() => void>();
const fresh = (): DemoState => ({ role: 'seller', badge: true, seq: 0, orders: {} });
const hasWindow = () => typeof window !== 'undefined';

function persist() { try { if (hasWindow()) window.sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* cuota: se sigue en memoria */ } }
function emit() { persist(); snapshot = { ...S() }; listeners.forEach((l) => l()); }
let snapshot: DemoState | null = null;

function init(): DemoState {
  if (state) return state;
  let st: DemoState = fresh();
  if (hasWindow()) {
    try { const raw = window.sessionStorage.getItem(STORE_KEY); if (raw) st = { ...fresh(), ...JSON.parse(raw) }; } catch { /* ignorar */ }
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get('demo_reset') === '1') st = fresh();
      const role = q.get('role'); if (role === 'seller' || role === 'buyer') st.role = role;
      const badge = q.get('badge'); if (badge === '0' || badge === 'false') st.badge = false; else if (badge === '1' || badge === 'true') st.badge = true;
    } catch { /* ignorar */ }
  }
  state = st; snapshot = { ...st };
  return st;
}
const S = () => init();

export const getDemoRole = (): DemoRole => S().role;
export function setDemoRole(role: DemoRole) { S().role = role; emit(); }
export function resetDemo() { init(); state = fresh(); emit(); }
export const demoBadgeVisible = () => S().badge;
export function setDemoBadge(v: boolean) { S().badge = v; emit(); }

export function useDemoState(): { role: DemoRole; badge: boolean } {
  const snap = useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => { init(); return snapshot!; }, () => { init(); return snapshot!; });
  return snap;
}

const ident = (role: DemoRole) => (role === 'seller' ? DEMO_SELLER : DEMO_BUYER);

export function useDemoAuth(): MeteoritoAuth {
  const { role } = useDemoState();
  const who = ident(role);
  return {
    configured: true, isAuthenticated: true, isLoading: false, email: who.email, address: who.address, error: null,
    openLogin: () => {}, logout: () => {},
    getAuthToken: () => 'demo-token',
    signMessage: async () => ({ publicKey: who.address, signature: 'ZGVtbw==' }),
    signXdr: async () => 'AAAA-demo-xdr',
    wallet: { state: 'ready', recoveryProtected: true, hasPasskey: true, approveDevice: async () => {}, enrollPasskey: async () => {} },
  };
}

const err = (status: number, code: string, msg: string) => Object.assign(new Error(msg), { status, code });
const mask = (id: string) => (id ? '••••' + id.slice(-4) : null);
const pub = (o: DemoOrder) => {
  const { seller_address, pin, pinShown, shipped_tx, evidence, dispute, ...rest } = o; void seller_address; void pin; void pinShown; void shipped_tx; void evidence; void dispute;
  return rest;
};

/** Reemplazo de los endpoints /api/*: misma forma de respuesta, sin red. */
export async function demoApi(path: string, body: any = {}): Promise<any> {
  const st = S(); const p = path.split('?')[0];
  const need = (role: DemoRole) => { if (st.role !== role) throw err(403, 'demo_wrong_role', role === 'buyer' ? 'Esta acción es del comprador. Cambiá a la vista comprador.' : 'Esta acción es del vendedor. Cambiá a la vista vendedor.'); };
  const get = (slug: string) => { const o = st.orders[slug]; if (!o) throw err(404, 'not_found', 'Pedido no encontrado'); return o; };
  const now = () => new Date().toISOString();

  if (p === '/api/orders/create') {
    need('seller');
    const slug = 'demo' + String(++st.seq).padStart(2, '0');
    const price = Number(body.price_crc);
    if (!Number.isInteger(price) || price < 1000) throw err(400, 'bad_price', 'precio inválido');
    st.orders[slug] = {
      slug, category: body.category, brand: String(body.brand ?? ''), model: String(body.model ?? ''), condition: String(body.condition ?? ''), price_crc: price,
      description: body.description ? String(body.description) : null, photos: Array.isArray(body.photos) ? body.photos.slice(0, 4) : [], status: 'creado',
      identifier_masked: body.identifier ? mask(String(body.identifier)) : null, amount_usdc: null, contract_id: null, funded_tx: null, released_tx: null, auto_release_at: null,
      checks_summary: Array.isArray(body.checks) ? body.checks.slice(0, 20) : [], created_at: now(),
      seller_address: DEMO_SELLER.address, pin: null, pinShown: false, shipped_tx: null, evidence: null, dispute: null,
    };
    emit(); return { slug };
  }
  if (p === '/api/escrow/pay') {
    need('buyer'); const o = get(String(body.slug));
    if (body.step === 'start') {
      if (o.status !== 'creado' && o.status !== 'escrow_creado') throw err(409, 'bad_state', 'Este pedido ya no está disponible.');
      o.status = 'escrow_creado'; o.amount_usdc = Math.round((o.price_crc / RATE) * 100) / 100; o.contract_id = demoContractId(o.slug);
      emit(); return { contractId: o.contract_id, amountUsdc: o.amount_usdc, priceCrc: o.price_crc, sinpe: { simulated: true, reference: `MET-${o.slug.toUpperCase()}` } };
    }
    if (body.step === 'confirm_sinpe') {
      if (o.status !== 'escrow_creado') throw err(409, 'bad_state', 'Primero inicia el pago.');
      o.status = 'fondeado'; o.funded_tx = demoTxHash('fund:' + o.slug); o.pin = DEMO_PIN; o.pinShown = true;
      emit(); return { funded: true, fundedTx: o.funded_tx, pin: DEMO_PIN }; // el PIN se devuelve una sola vez
    }
    throw err(400, 'bad_step', 'paso inválido');
  }
  if (p === '/api/escrow/ship') {
    need('seller'); const o = get(String(body.slug));
    if (o.status !== 'fondeado') throw err(409, 'bad_state', 'El pago todavía no está protegido.');
    o.status = 'enviado'; o.shipped_tx = demoTxHash('ship:' + o.slug); o.evidence = body.evidence ?? null; emit();
    return { shippedTx: o.shipped_tx, evidenceHash: demoTxHash('ev:' + o.slug) };
  }
  if (p === '/api/escrow/confirm') {
    const o = get(String(body.slug));
    if (o.status !== 'enviado') throw err(409, 'bad_state', 'Este pedido no está enviado.');
    if (body.reason === 'pin') { need('seller'); if (String(body.pin) !== o.pin) throw err(400, 'bad_pin', 'PIN incorrecto'); }
    else { need('buyer'); }
    o.status = 'liberado'; o.released_tx = demoTxHash('release:' + o.slug); emit(); return { released: true, releasedTx: o.released_tx };
  }
  if (p === '/api/escrow/dispute') {
    need('buyer'); const o = get(String(body.slug));
    if (!['fondeado', 'enviado', 'entregado'].includes(o.status) || o.released_tx) throw err(409, 'bad_state', 'Ya no se puede reportar un problema.');
    o.status = 'en_disputa'; o.dispute = { reason: body.reason, description: body.description ?? null, at: now() }; emit(); return { disputed: true };
  }
  throw err(404, 'demo_no_endpoint', `Modo demo: ${p} no está simulado`);
}

export const demoGetPublicOrder = (slug: string) => { const o = S().orders[slug]; return o ? pub(o) : null; };
export const demoGetSellerOrders = (addr: string) =>
  Object.values(S().orders).filter((o) => o.seller_address === addr).sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((o) => ({ slug: o.slug, category: o.category, brand: o.brand, model: o.model, price_crc: o.price_crc, status: o.status, identifier_masked: o.identifier_masked, created_at: o.created_at }));
export function demoBalances(addr: string) {
  const earned = Object.values(S().orders).filter((o) => o.seller_address === addr && o.status === 'liberado').reduce((a, o) => a + (o.amount_usdc ?? 0) * 0.997, 0);
  const usdc = (addr === DEMO_SELLER.address ? START_BALANCE_USDC + earned : 80).toFixed(7);
  return { funded: true, xlm: '9.5000000', usdc };
}
/** Pedido de ejemplo ya en un estado dado (para grabar solo un tramo del flujo). Devuelve el slug. */
export async function demoSeed(upTo: 'creado' | 'fondeado' | 'enviado' = 'enviado'): Promise<string> {
  const prev = S().role; const set = (r: DemoRole) => { S().role = r; };
  set('seller');
  const { slug } = await demoApi('/api/orders/create', { category: 'celular', brand: 'Samsung', model: 'Galaxy S23', condition: 'Muy bueno', price_crc: 185000, description: 'Con cargador original y funda. Batería al 91%.', identifier: '350000000000123', photos: [], checks: [] });
  if (upTo !== 'creado') { set('buyer'); await demoApi('/api/escrow/pay', { slug, step: 'start' }); await demoApi('/api/escrow/pay', { slug, step: 'confirm_sinpe' }); }
  if (upTo === 'enviado') { set('seller'); await demoApi('/api/escrow/ship', { slug, evidence: { note: 'Entrega en persona, Escazú', at: new Date().toISOString() } }); }
  set(prev); emit(); return slug;
}

if (DEMO_ENABLED && hasWindow()) {
  // Utilidad para los guiones de grabación (Playwright). Solo existe con el modo demo activo.
  (window as any).__meteoritoDemo = { setRole: setDemoRole, getRole: getDemoRole, reset: resetDemo, seed: demoSeed, setBadge: setDemoBadge, DEMO_PIN };
}

/** Slug del pedido más reciente (para saltar de vista vendedor a vista comprador). */
export const demoLastSlug = (): string | null => { const k = Object.keys(S().orders); return k.length ? k[k.length - 1] : null; };
