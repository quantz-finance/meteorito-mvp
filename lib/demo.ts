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

import { cleanHolder, crIbanError, normalizeIban, normalizeSinpe } from '../api/_lib/payout'; // pura y chica (~1 KB)
import { canShowContact, normalizeContactPhone } from '../api/_lib/contact'; // pura
import { checkFacebookUrl, FB_IMPORT_FAILED, FB_URL_INVALID } from '../api/_lib/fbparse'; // pura
import { checkListingUrl, IMPORT_FAILED, listingSource } from '../api/_lib/importers/providers'; // pura
import { daysLabel, EXTENSION_DAYS, MAX_TOTAL_FROM_PAYMENT_MIN, pendingExtension, protectionOf, validateAgreement } from '../api/_lib/agreement'; // pura
export type DemoRole = 'seller' | 'buyer';
type Status = 'creado' | 'escrow_creado' | 'fondeado' | 'enviado' | 'entregado' | 'liberado' | 'en_disputa' | 'resuelto' | 'cancelado';

export interface DemoOrder {
  slug: string; category: string; brand: string; model: string; condition: string; price_crc: number;
  description: string | null; photos: string[]; status: string; identifier_masked: string | null;
  amount_usdc: number | null; contract_id: string | null; funded_tx: string | null; released_tx: string | null; auto_release_at: string | null;
  delivery_mode?: 'envio' | 'cara_a_cara'; protection_minutes?: number; release_ext?: { by: 'buyer' | 'seller'; days: number; at: string } | null; release_ext_minutes?: number;
  funded_at?: string | null; shipped_at?: string | null; delivered_at?: string | null; released_at?: string | null; disputed_at?: string | null;
  checks_summary: { id: string; label: string; blocksRelease: boolean; ok: boolean }[]; created_at: string;
  seller_address: string; pin: string | null; pinShown: boolean; shipped_tx: string | null; evidence: unknown; dispute: unknown;
  // Igual que producción (012/013): producto permanente vs pedido de un comprador, comprador invitado, PIN, resolución.
  kind?: 'single' | 'listing'; listing_slug?: string | null; listing_status?: 'activa' | 'pausada' | 'archivada'; stock?: number | null;
  buyer?: string | null; pin_attempts?: number; resolution?: { buyerPct: number } | null; invite_code?: string | null;
}
export interface DemoInvite { code: string; category: string; brand: string; model: string; title?: string; photos: string[]; price_crc: number; note: string | null; source_url?: string | null; status: 'abierta' | 'aceptada' | 'cancelada'; order_slug: string | null; created_at: string; buyer: string }
interface DemoState { role: DemoRole; badge: boolean; seq: number; orders: Record<string, DemoOrder>; buyer?: string; invites?: Record<string, DemoInvite>; clock?: number; store?: { slug: string; name: string; avatar?: string | null; phone?: string | null }; ratings?: Record<string, number>; payout?: { iban_last4: string; holder_name: string; sinpe_last4: string | null; updated_at: string | null } | null }

export const DEMO_PIN = '482915';
/** Igual que producción (/api/health -> autoReleaseMinutes): 7 días después de "Ya lo envié" (el reloj del demo se adelanta con advance()). */
export const DEMO_AUTO_RELEASE_MINUTES = 10080;
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
      const buyer = q.get('buyer'); if (buyer && /^[A-Za-z0-9]{1,8}$/.test(buyer)) st.buyer = buyer;
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

/** Identidad del comprador invitado en este navegador (= guest:<hash de su llave> en producción). */
const me = () => 'guest:' + (S().buyer ?? 'A');
const nowMs = () => Date.now() + (S().clock ?? 0); // reloj simulable (liberación automática)
const iso = (ms = nowMs()) => new Date(ms).toISOString();
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
  const { seller_address, pin, pinShown, shipped_tx, evidence, dispute, buyer, pin_attempts, invite_code, stock, ...rest } = o;
  void seller_address; void pin; void pinShown; void shipped_tx; void evidence; void dispute; void buyer; void pin_attempts; void invite_code; void stock;
  return rest;
};

/** Tokens de captura del demo (igual que el API: un uso, 5 min, propósito y pedido). Solo en memoria. */
const demoCaps = new Map<string, { id: string; purpose: string; ref: string; exp: number; used: boolean }>();
const DEMO_CAPTURE_TTL = 5 * 60_000;
/** JPEG mínimo (1x1) para los pedidos sembrados como enviados. */
const DEMO_SHIP_PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

/** Reemplazo de los endpoints /api/*: misma forma de respuesta, sin red. */
export async function demoApi(path: string, body: any = {}): Promise<any> {
  const st = S(); const p = path.split('?')[0];
  const need = (role: DemoRole) => { if (st.role !== role) throw err(403, 'demo_wrong_role', role === 'buyer' ? 'Esta acción es del comprador. Cambia a la vista comprador.' : 'Esta acción es del vendedor. Cambia a la vista vendedor.'); };
  const get = (slug: string) => { const o = st.orders[slug]; if (!o) throw err(404, 'not_found', 'Pedido no encontrado'); return o; };
  const now = () => new Date().toISOString();

  const newSlug = () => 'demo' + String(++st.seq).padStart(2, '0');
  if (p === '/api/photos/upload-url') { // cámara de la app: token de captura y firma de subida (la foto queda local)
    if (body.action === 'capture_token') {
      const purpose = String(body.purpose);
      if (!['ship', 'listing', 'dispute'].includes(purpose)) throw err(400, 'capture_bad_purpose', 'propósito inválido');
      const ref = purpose === 'listing' ? 'new' : String(body.ref);
      if (purpose === 'ship') { need('seller'); const o = get(ref); if (o.status !== 'fondeado') throw err(409, 'bad_state', 'Los fondos todavía no están en custodia.'); }
      if (purpose === 'dispute') { need('buyer'); const o = get(ref); if (o.buyer && o.buyer !== me()) throw err(403, 'not_buyer', 'no eres el comprador de este pedido'); }
      const id = Array.from({ length: 4 }, () => Math.random().toString(16).slice(2, 10).padEnd(8, '0')).join('').slice(0, 32).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
      const token = `demo.${purpose}.${id}`; const exp = Date.now() + DEMO_CAPTURE_TTL;
      demoCaps.set(token, { id, purpose, ref, exp, used: false });
      return { token, id, purpose, ref, code: purpose === 'listing' ? 'P-' + id.slice(0, 6).toUpperCase() : ref.toUpperCase(), exp: new Date(exp).toISOString(), now: now() };
    }
    if (body.purpose != null) {
      const c = demoCaps.get(String(body.capture_token ?? ''));
      if (!body.capture_token) throw err(401, 'capture_token_required', 'Toma la foto con la cámara de Meteorito.');
      if (!c) throw err(403, 'capture_token_invalid', 'La foto no es válida. Tómala de nuevo con la cámara.');
      if (c.purpose !== body.purpose) throw err(403, 'capture_wrong_purpose', 'Esa foto es para otra cosa. Tómala de nuevo con la cámara.');
      if (Date.now() > c.exp) throw err(410, 'capture_token_expired', 'Pasaron más de 5 minutos. Toma la foto de nuevo.');
      if (c.used) throw err(409, 'capture_token_used', 'Esa foto ya se usó. Toma otra con la cámara.');
      c.used = true;
      return { path: 'demo', token: 'demo', publicUrl: null, capture: { token_id: c.id, purpose: c.purpose } };
    }
    throw err(403, 'camera_required', 'Toma la foto con la cámara de Meteorito.');
  }
  if (p === '/api/invites') {
    st.invites ??= {};
    if (body.op === 'create') {
      const price = Number(body.price_crc); const title = String(body.title ?? '').trim();
      if (!Number.isInteger(price) || price < 1000 || price > 50_000_000) throw err(400, 'bad_price', 'precio inválido');
      if (title.length < 3) throw err(400, 'bad_title', 'Escribe el nombre de lo que quieres comprar.');
      const code = 'inv' + String(++st.seq).padStart(5, '0');
      let source_url: string | null = null;
      if (body.source_url) { const chk = checkFacebookUrl(String(body.source_url)); if (!chk.ok) throw err(400, 'fb_url_invalid', 'El link del anuncio no es de Facebook Marketplace.'); source_url = chk.url; }
      st.invites[code] = { code, category: 'otro', brand: '', model: title, title, photos: Array.isArray(body.photos) ? body.photos.slice(0, 4) : [], price_crc: price, note: body.note ? String(body.note) : null, source_url, status: 'abierta', order_slug: null, created_at: now(), buyer: me() };
      emit(); return { code };
    }
    if (body.op === 'cancel') {
      const inv = st.invites[String(body.code)]; if (!inv) throw err(404, 'not_found', 'invitación no existe');
      if (inv.buyer !== me()) throw err(403, 'forbidden', 'no eres quien creó esta invitación');
      if (inv.status !== 'abierta') throw err(409, 'invite_not_open', `la invitación ya está ${inv.status}`);
      inv.status = 'cancelada'; emit(); return { ok: true };
    }
    throw err(400, 'bad_op', 'op inválida');
  }
  if (p === '/api/orders/create') {
    need('seller');
    const price = Number(body.price_crc);
    if (!Number.isInteger(price) || price < 1000) throw err(400, 'bad_price', 'precio inválido');
    let inv: DemoInvite | null = null;
    if (body.invite) {
      inv = st.invites?.[String(body.invite)] ?? null;
      if (!inv) throw err(404, 'invite_not_found', 'La invitación no existe.');
      if (inv.buyer === me()) throw err(400, 'self_invite', 'No puedes aceptar tu propia invitación.');
      if (inv.status !== 'abierta') throw err(409, 'invite_not_open', 'Esta invitación ya no está abierta.');
      if (inv.price_crc !== price) throw err(409, 'invite_price_mismatch', 'El precio tiene que ser el acordado en la invitación.');
    }
    const agreement = validateAgreement({ delivery_mode: body.delivery_mode, protection_minutes: body.protection_minutes });
    if ('error' in agreement) throw err(400, 'bad_agreement', agreement.error);
    const slug = newSlug();
    // Igual que el API: link en un paso con `title` (se guarda en model) o, por compatibilidad, marca + modelo.
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title && !String(body.brand ?? '').trim() && !String(body.model ?? '').trim()) throw err(400, 'bad_title', 'Escribe el título de lo que vendes.');
    st.orders[slug] = {
      slug, category: body.category || 'otro', brand: title ? '' : String(body.brand ?? ''), model: title || String(body.model ?? ''), condition: String(body.condition ?? ''), price_crc: price,
      description: body.description ? String(body.description) : null, photos: Array.isArray(body.photos) ? body.photos.slice(0, 4) : [], status: 'creado',
      identifier_masked: body.identifier ? mask(String(body.identifier)) : null, amount_usdc: null, contract_id: null, funded_tx: null, released_tx: null, auto_release_at: null,
      checks_summary: Array.isArray(body.checks) ? body.checks.slice(0, 20) : [], created_at: now(), ...listingSource(body.source_url, body.source_provider),
      seller_address: DEMO_SELLER.address, pin: null, pinShown: false, shipped_tx: null, evidence: null, dispute: null,
      delivery_mode: agreement.delivery_mode, protection_minutes: agreement.protection_minutes, release_ext: null, release_ext_minutes: 0,
      // Como producción: link nuevo = producto permanente; de invitación (o single:true) = un solo uso, reservado.
      kind: inv || body.single === true ? 'single' : 'listing', listing_status: 'activa', listing_slug: null, buyer: null, pin_attempts: 0, resolution: null, invite_code: inv?.code ?? null,
    };
    if (inv) { inv.status = 'aceptada'; inv.order_slug = slug; }
    emit(); return { slug, kind: st.orders[slug].kind };
  }
  if (p === '/api/escrow/pay') {
    need('buyer'); let o = get(String(body.slug));
    if (body.step === 'start') {
      if (o.invite_code) { const inv = st.invites?.[o.invite_code]; if (inv && inv.buyer !== me()) throw err(403, 'invite_reserved', 'Este link de pago está reservado para quien inició la compra. Abre el link desde el mismo navegador donde creaste la invitación.'); }
      if (o.kind === 'listing') {
        if (o.listing_status !== 'activa') throw err(409, 'listing_paused', 'El vendedor pausó este producto por ahora.');
        if (o.stock === 0) throw err(409, 'listing_sold_out', 'Este producto se agotó.');
        const parent = o;
        const mine = Object.values(st.orders).find((c) => c.listing_slug === parent.slug && c.buyer === me() && (c.status === 'creado' || c.status === 'escrow_creado'));
        if (mine) o = mine;
        else { const cs = newSlug(); o = st.orders[cs] = { ...parent, slug: cs, kind: 'single', listing_slug: parent.slug, status: 'creado', buyer: me(), created_at: now(), contract_id: null, amount_usdc: null, pin: null, pinShown: false, pin_attempts: 0, resolution: null }; }
      }
      if (o.buyer && o.buyer !== me()) throw err(403, 'taken', 'este pedido ya tiene comprador');
      if (o.status !== 'creado' && o.status !== 'escrow_creado') throw err(409, 'bad_state', 'Este pedido ya no está disponible.');
      o.buyer = me();
      o.status = 'escrow_creado'; o.amount_usdc = Math.round((o.price_crc / RATE) * 100) / 100; o.contract_id = demoContractId(o.slug);
      emit(); return { slug: o.slug, contractId: o.contract_id, amountUsdc: o.amount_usdc, priceCrc: o.price_crc, sinpe: { simulated: true, reference: `MET-${o.slug.toUpperCase()}` } };
    }
    if (body.step === 'confirm_sinpe') {
      if (o.buyer && o.buyer !== me()) throw err(403, 'not_buyer', 'no eres el comprador de este pedido');
      if (o.status !== 'escrow_creado') throw err(409, 'bad_state', 'Primero inicia el pago.');
      o.status = 'fondeado'; o.funded_tx = demoTxHash('fund:' + o.slug); o.funded_at = now(); o.pin = DEMO_PIN; o.pinShown = true;
      // Cara a cara: el plazo acordado corre desde el pago (como fundedAgreement en el API).
      if (o.delivery_mode === 'cara_a_cara') o.auto_release_at = iso(nowMs() + protectionOf(o) * 60_000);
      emit(); return { funded: true, fundedTx: o.funded_tx, pin: DEMO_PIN }; // el PIN se devuelve una sola vez
    }
    if (body.step === 'shipment') { // como el API: solo el comprador ve la foto del envío y la nota
      if (o.buyer && o.buyer !== me()) throw err(403, 'not_buyer', 'no eres el comprador de este pedido');
      if (!o.shipped_at) return { shipped: false };
      const ev = (o.evidence ?? {}) as { at?: string; photo?: string; note?: string };
      return { shipped: true, at: ev.at ?? o.shipped_at, photo: ev.photo ?? null, note: ev.note ?? null };
    }
    throw err(400, 'bad_step', 'paso inválido');
  }
  if (p === '/api/escrow/ship') {
    need('seller'); const o = get(String(body.slug));
    if (o.status !== 'fondeado') throw err(409, 'bad_state', 'Los fondos todavía no están en custodia.');
    if (o.delivery_mode === 'cara_a_cara') throw err(409, 'face_to_face', 'La entrega es cara a cara: no hay envío. Pide el código al comprador.');
    // Igual que el API: foto OBLIGATORIA de la cámara (token 'ship' de este pedido, ya usado al subir); en demo la foto es una data URL local.
    const raw = body.evidence ?? {};
    if (!raw.photo) throw err(400, 'ship_photo_required', 'Toma la foto del paquete o del comprobante con la cámara para marcarlo como enviado.');
    const cap = demoCaps.get(String(raw.capture_token ?? ''));
    if (!cap || cap.purpose !== 'ship' || cap.ref !== o.slug || !cap.used || !/^data:image\/jpeg;base64,/.test(String(raw.photo))) throw err(400, 'bad_ship_photo', 'Toma la foto del paquete o del comprobante con la cámara de Meteorito.');
    const ev: { at: string; photo: string; captured_at: string; token_id: string; purpose: 'ship'; note?: string } = { at: now(), photo: String(raw.photo), captured_at: String(raw.captured_at ?? now()), token_id: cap.id, purpose: 'ship' };
    if (typeof raw.note === 'string' && raw.note.trim()) ev.note = raw.note.trim().slice(0, 200);
    o.status = 'enviado'; o.shipped_tx = demoTxHash('ship:' + o.slug); o.shipped_at = now(); o.auto_release_at = iso(nowMs() + (o.protection_minutes ? protectionOf(o) : DEMO_AUTO_RELEASE_MINUTES) * 60_000 + (o.release_ext_minutes ?? 0) * 60_000); // plazo acordado desde "Ya lo envié"
    o.evidence = ev; emit();
    return { shippedTx: o.shipped_tx, evidenceHash: demoTxHash('ev:' + o.slug) };
  }
  if (p === '/api/escrow/confirm') {
    const o = get(String(body.slug));
    if (body.reason === 'extend' || body.reason === 'extend_answer') { // extensión de mutuo acuerdo (como el API)
      const role = getDemoRole() === 'seller' ? 'seller' : 'buyer';
      if (role === 'buyer' && o.buyer && o.buyer !== me()) throw err(403, 'not_party', 'Solo el comprador y el vendedor pueden cambiar el plazo.');
      if (!(o.status === 'enviado' || (o.status === 'fondeado' && o.delivery_mode === 'cara_a_cara')) || o.disputed_at) throw err(409, 'ext_not_running', 'El plazo no se puede cambiar en este momento.');
      const due = Date.parse(o.auto_release_at ?? '') || nowMs(), paid = Date.parse(o.funded_at ?? '') || nowMs();
      const fits = (d: number) => due + d * 86_400_000 <= paid + MAX_TOTAL_FROM_PAYMENT_MIN * 60_000;
      const pending = pendingExtension(o, nowMs());
      if (body.reason === 'extend') {
        const days = Number(body.days);
        if (!(EXTENSION_DAYS as readonly number[]).includes(days)) throw err(400, 'bad_days', 'Elige 1, 3 o 7 días.');
        if (pending) throw err(409, 'ext_pending', 'Ya hay una solicitud esperando respuesta.');
        if (!fits(days)) throw err(409, 'ext_cap', `Con ${daysLabel(days)} más pasarías los 30 días desde el pago.`);
        o.release_ext = { by: role, days, at: now() }; emit(); return { pending: o.release_ext };
      }
      if (!pending) throw err(409, 'ext_none', 'No hay ninguna solicitud pendiente.');
      if (pending.by === role) throw err(403, 'ext_own', 'La otra parte tiene que responder tu solicitud.');
      const accept = body.accept === true;
      if (accept && !fits(pending.days)) throw err(409, 'ext_cap', `Con ${daysLabel(pending.days)} más pasarías los 30 días desde el pago.`);
      if (accept) { o.release_ext_minutes = (o.release_ext_minutes ?? 0) + pending.days * 1440; o.auto_release_at = iso(due + pending.days * 86_400_000); }
      o.release_ext = null; emit(); return { accepted: accept, autoReleaseAt: o.auto_release_at };
    }
    const f2fPaid = o.status === 'fondeado' && o.delivery_mode === 'cara_a_cara'; // cara a cara: se libera desde 'fondeado'
    if (o.status !== 'enviado' && !f2fPaid) throw err(409, 'bad_state', 'Este pedido no está enviado.');
    if (body.reason === 'pin') {
      need('seller');
      if ((o.pin_attempts ?? 0) >= 3) throw err(429, 'pin_locked', 'demasiados intentos de PIN');
      if (String(body.pin) !== o.pin) { o.pin_attempts = (o.pin_attempts ?? 0) + 1; emit(); throw err(401, 'bad_pin', 'PIN incorrecto'); }
    } else { need('buyer'); if (o.buyer && o.buyer !== me()) throw err(403, 'not_buyer', 'no eres el comprador'); }
    o.delivered_at = now(); o.status = 'liberado'; o.released_tx = demoTxHash('release:' + o.slug); o.released_at = now(); emit(); return { released: true, releasedTx: o.released_tx };
  }
  if (p === '/api/escrow/dispute') {
    need('buyer'); const o = get(String(body.slug));
    if (o.buyer && o.buyer !== me()) throw err(403, 'not_buyer', 'Solo el comprador puede reportar un problema.');
    if (!['fondeado', 'enviado', 'entregado'].includes(o.status) || o.released_tx) throw err(409, 'bad_state', 'Ya no se puede reportar un problema.');
    const ev = Array.isArray(body.evidence) ? body.evidence : []; const caps = Array.isArray(body.captures) ? body.captures : [];
    if (ev.some((_: unknown, i: number) => { const c = demoCaps.get(String(caps[i] ?? '')); return !c || c.purpose !== 'dispute' || c.ref !== o.slug || !c.used; })) throw err(400, 'camera_required', 'Toma la foto con la cámara de Meteorito.');
    o.status = 'en_disputa'; o.disputed_at = now(); o.dispute = { reason: body.reason, description: body.description ?? null, evidence: Array.isArray(body.evidence) ? body.evidence.slice(0, 4) : [], at: now() }; emit(); return { disputed: true };
  }
  if (p === '/api/store') {
    if (body.action === 'rate') {
      need('buyer'); const o = get(String(body.slug));
      if (o.buyer && o.buyer !== me()) throw err(403, 'not_buyer', 'Solo el comprador puede calificar.');
      const stars = Number(body.stars);
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw err(400, 'bad_stars', 'Elige de 1 a 5 estrellas.');
      if (!['entregado', 'liberado'].includes(o.status)) throw err(409, 'not_ratable', 'Puedes calificar cuando el pedido esté entregado.');
      st.ratings ??= {}; if (st.ratings[o.slug]) throw err(409, 'already_rated', 'Ya calificaste este pedido.');
      st.ratings[o.slug] = stars; emit(); return { rated: true, stars };
    }
    if (body.action === 'push_subscribe' || body.action === 'push_unsubscribe') return { ok: true };
    if (body.action === 'seller_contact') { // igual que el API real: solo el comprador de ESTE pedido y solo pagado
      need('buyer'); const o = get(String(body.slug));
      if (!o.buyer || o.buyer !== me()) throw err(403, 'not_buyer', 'Solo quien compró puede ver el contacto del vendedor.');
      if (!canShowContact(o.status)) throw err(409, 'not_paid', 'Verás el contacto del vendedor cuando pagues.');
      return { contact_phone: st.store?.phone ?? null };
    }
    if (body.action === 'import_listing') { // "Importar de un link": misma forma que el API real; sin red (foto propia del demo)
      const chk = checkListingUrl(body.url);
      if (!chk.ok) throw err(400, 'import_url_invalid', chk.error);
      await new Promise((r) => setTimeout(r, 900)); // deja ver el skeleton
      const p = chk.provider; const name = p.id === 'web' ? new URL(chk.url).hostname.replace(/^www\./, '') : p.name;
      if (p.status === 'blocked' || /no-existe|\/item\/1\/|login/.test(chk.url)) return { result: 'failed', provider: p.id, provider_name: name, source_url: chk.url, title: null, price_crc: null, price_source: null, converted: false, description: null, photos: [], missing: ['title', 'price', 'photos'], message: IMPORT_FAILED, code: 'unreadable' };
      const usd = p.id === 'web' && /\.us$/.test(name); const mxn = p.id === 'web' && /\.mx$/.test(name); // tiendas genéricas: precio en otra moneda -> sugerido en colones
      return { result: 'success', provider: p.id, provider_name: name, source_url: chk.url, title: 'Bicicleta de montaña aro 29',
        price_crc: mxn ? 197400 : usd ? 151500 : 185000, price_source: mxn ? { amount: 7238.99, currency: 'MXN' } : usd ? { amount: 300, currency: 'USD' } : { amount: 185000, currency: 'CRC' }, converted: mxn || usd,
        description: 'Bicicleta en muy buen estado, frenos de disco, 21 velocidades. Entrega en San José.', photos: ['/demo-fb-import.jpg'], photo_urls: ['/demo-fb-import.jpg'], missing: [] };
    }
    if (body.action === 'import_facebook') { // misma forma que el API real (vendedor o comprador invitado); sin red (foto propia del demo)
      if (!checkFacebookUrl(body.url).ok) throw err(400, 'fb_url_invalid', FB_URL_INVALID);
      await new Promise((r) => setTimeout(r, 400));
      if (/\/item\/1\/|login/.test(String(body.url))) return { result: 'failed', title: null, price_crc: null, price_source: null, converted: false, description: null, photos: [], missing: ['title', 'price', 'photos'], message: FB_IMPORT_FAILED };
      return { result: 'success', title: 'Bicicleta de montaña aro 29', price_crc: 185000, price_source: { amount: 185000, currency: 'CRC' }, converted: false,
        description: 'Bicicleta en muy buen estado, frenos de disco, 21 velocidades. Entrega en San José.', photos: ['/demo-fb-import.jpg'], photo_urls: ['/demo-fb-import.jpg'], source_url: String(body.url), missing: [] };
    }
    need('seller');
    if (body.action === 'payout_get') return { payout: st.payout ?? null };
    if (body.action === 'payout_set') {
      const e = crIbanError(body.iban); if (e) throw err(400, 'bad_iban', e);
      const holder = cleanHolder(body.holder_name); if (holder.length < 3) throw err(400, 'bad_holder', 'Escribe el nombre del titular como aparece en el banco.');
      const sp = normalizeSinpe(body.sinpe_phone); if (sp === 'invalid') throw err(400, 'bad_sinpe', 'El SINPE Móvil son 8 dígitos (ej. 8888 1234).');
      st.payout = { iban_last4: normalizeIban(body.iban).slice(-4), holder_name: holder, sinpe_last4: sp ? sp.slice(-4) : null, updated_at: now() }; emit();
      return { payout: st.payout };
    }
    st.store ??= { slug: 'valeria', name: 'Valeria' };
    if (body.action === 'orders') return { orders: demoGetSellerOrders(DEMO_SELLER.address) };
    if (body.action === 'listing_set') {
      if (!['activa', 'pausada', 'archivada'].includes(body.status)) throw err(400, 'bad_status', 'Estado inválido.');
      const o = st.orders[String(body.slug)];
      if (!o || o.kind !== 'listing') throw err(404, 'not_listing', 'Este link es de un solo uso: no se puede pausar.');
      o.listing_status = body.status; emit(); return demoGetStore(st.store.slug, true);
    }
    if (body.action === 'me') return demoGetStore(st.store.slug, true);
    if (body.action === 'update') {
      if (body.store_slug != null) { const s2 = String(body.store_slug).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''); if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(s2)) throw err(400, 'bad_store_slug', 'Usa de 3 a 30 letras o números (sin espacios).'); st.store.slug = s2; }
      if (body.display_name != null && String(body.display_name).trim()) st.store.name = String(body.display_name).trim().slice(0, 40);
      if (body.avatar_url !== undefined) { // demo: la foto queda local (data URL); el API real solo acepta su carpeta en Storage
        if (body.avatar_url !== null && !/^data:image\/(jpeg|png|webp);base64,/.test(String(body.avatar_url))) throw err(400, 'bad_avatar', 'No pudimos usar esa foto. Elige otra imagen e intenta de nuevo.');
        st.store.avatar = body.avatar_url;
      }
      if (body.contact_phone !== undefined) {
        const ph = normalizeContactPhone(body.contact_phone);
        if (ph === 'invalid') throw err(400, 'bad_phone', 'Escribe un número de Costa Rica: 8 dígitos (ej. 8888 1234).');
        st.store.phone = ph;
      }
      emit();
    }
    return demoGetStore(st.store.slug, true);
  }
  throw err(404, 'demo_no_endpoint', `Modo demo: ${p} no está simulado`);
}

/** Usuario de la tienda del demo (para el feed y el perfil simulados). */
export const demoStoreSlug = () => S().store?.slug ?? 'valeria';
/** Tienda pública simulada (misma forma que GET /api/store). */
export function demoGetStore(slug: string, owner = false) {
  const st = S(); const store = st.store ?? { slug: 'valeria', name: 'Valeria' };
  if (slug !== store.slug) return null;
  const r = Object.values(st.ratings ?? {});
  return {
    store_slug: store.slug, display_name: store.name, avatar_url: store.avatar ?? null, ...(owner ? { contact_phone: store.phone ?? null } : {}),
    rating_avg: r.length ? Math.round((r.reduce((a, b) => a + b, 0) / r.length) * 100) / 100 : null, rating_count: r.length,
    // Igual que public_store_items: productos activos sin comprador (Mi tienda también ve los pausados).
    items: Object.values(st.orders).filter((o) => o.status === 'creado' && !o.listing_slug && !o.invite_code
        && (o.listing_status ?? 'activa') !== 'archivada' && (owner || (o.listing_status ?? 'activa') === 'activa')).reverse()
      .map((o) => ({ slug: o.slug, title: `${o.brand} ${o.model}`.trim() || 'Artículo', price_crc: o.price_crc, photo: o.photos[0] ?? null, ...(owner ? { listing_status: (o.listing_status === 'pausada' ? 'pausada' : 'activa') as 'activa' | 'pausada' } : {}) })),
  };
}
export const demoGetPublicOrder = (slug: string) => { const o = S().orders[slug]; return o ? pub(o) : null; };
export const demoGetSellerOrders = (addr: string) =>
  Object.values(S().orders).filter((o) => o.seller_address === addr && !(o.listing_slug && o.status === 'creado')).sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((o) => ({ slug: o.slug, category: o.category, brand: o.brand, model: o.model, price_crc: o.price_crc, status: o.status, identifier_masked: o.identifier_masked, created_at: o.created_at, kind: o.kind, listing_slug: o.listing_slug ?? null, listing_status: o.listing_status, delivery_mode: o.delivery_mode ?? 'envio' }));
/** Invitación pública simulada (misma forma que GET /api/invites). */
export function demoGetInvite(code: string) {
  const inv = S().invites?.[code]; if (!inv) return null;
  const { buyer, ...rest } = inv; return { ...rest, mine: buyer === me() };
}
/** Cron simulado (api/escrow/cron.ts): libera 'enviado' vencidos, salvo PIN bloqueado (423 pin_locked en producción). */
export function demoRunCron(): string[] {
  const st = S(); const out: string[] = [];
  for (const o of Object.values(st.orders)) {
    const running = o.status === 'enviado' || (o.status === 'fondeado' && o.delivery_mode === 'cara_a_cara');
    if (!running || !o.auto_release_at || new Date(o.auto_release_at).getTime() > nowMs()) continue;
    if ((o.pin_attempts ?? 0) >= 3) continue;
    const p = pendingExtension(o, nowMs()); if (p && Date.parse(p.at) + 24 * 3600_000 > nowMs()) continue; // extensión pendiente: congela (máx. 24 h)
    o.status = 'liberado'; o.released_tx = demoTxHash('release:' + o.slug); o.released_at = iso(); out.push(o.slug);
  }
  emit(); return out;
}
/** Resolución de disputa (la hace el equipo en producción): % devuelto al comprador. */
export function demoResolve(slug: string, buyerPct: number) {
  const o = S().orders[slug]; if (!o || o.status !== 'en_disputa') throw err(409, 'bad_state', 'no está en disputa');
  o.status = 'resuelto'; o.resolution = { buyerPct }; o.released_at = iso(); emit();
}
export function demoBalances(addr: string) {
  const earned = Object.values(S().orders).filter((o) => o.seller_address === addr && o.status === 'liberado').reduce((a, o) => a + (o.amount_usdc ?? 0) * 0.997, 0);
  const usdc = (addr === DEMO_SELLER.address ? START_BALANCE_USDC + earned : 80).toFixed(7);
  return { funded: true, xlm: '9.5000000', usdc };
}
/** Pedido de ejemplo ya en un estado dado (para grabar solo un tramo del flujo). Devuelve el slug. */
export async function demoSeed(upTo: 'creado' | 'fondeado' | 'enviado' = 'enviado', opts: { title?: string; price_crc?: number; photos?: string[]; single?: boolean; delivery_mode?: 'envio' | 'cara_a_cara'; protection_minutes?: number } = {}): Promise<string> {
  const prev = S().role; const set = (r: DemoRole) => { S().role = r; };
  set('seller');
  // Igual que la pantalla única de vender: solo título, precio y fotos. Devuelve el producto (creado) o el pedido del comprador.
  let { slug } = await demoApi('/api/orders/create', { title: opts.title ?? 'Samsung Galaxy S23', price_crc: opts.price_crc ?? 185000, photos: opts.photos ?? [], ...(opts.single ? { single: true } : {}),
    ...(opts.delivery_mode ? { delivery_mode: opts.delivery_mode } : {}), ...(opts.protection_minutes ? { protection_minutes: opts.protection_minutes } : {}) });
  if (upTo !== 'creado') { set('buyer'); slug = (await demoApi('/api/escrow/pay', { slug, step: 'start' })).slug; await demoApi('/api/escrow/pay', { slug, step: 'confirm_sinpe' }); }
  if (upTo === 'enviado' && opts.delivery_mode !== 'cara_a_cara') { // mismo camino que la cámara: token 'ship', firma (lo marca usado) y "Ya lo envié" con la foto
    set('seller');
    const tk = await demoApi('/api/photos/upload-url', { action: 'capture_token', purpose: 'ship', ref: slug });
    await demoApi('/api/photos/upload-url', { purpose: 'ship', capture_token: tk.token, mime: 'image/jpeg', size: 1 });
    await demoApi('/api/escrow/ship', { slug, evidence: { photo: DEMO_SHIP_PHOTO, capture_token: tk.token, captured_at: tk.now } });
  }
  set(prev); emit(); return slug;
}

if (DEMO_ENABLED && hasWindow()) {
  // Utilidad para los guiones de grabación (Playwright). Solo existe con el modo demo activo.
  (window as any).__meteoritoDemo = {
    setRole: setDemoRole, getRole: getDemoRole, reset: resetDemo, seed: demoSeed, setBadge: setDemoBadge, DEMO_PIN,
    setBuyer: (b: string) => { S().buyer = b; emit(); }, advance: (ms: number) => { S().clock = (S().clock ?? 0) + ms; emit(); },
    cron: demoRunCron, resolve: demoResolve, state: () => S(),
  };
}

/** Slug del pedido más reciente (para saltar de vista vendedor a vista comprador). */
export const demoLastSlug = (): string | null => { const k = Object.keys(S().orders); return k.length ? k[k.length - 1] : null; };
