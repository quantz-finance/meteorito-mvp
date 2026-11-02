// Comprador invitado: llave secreta aleatoria por navegador (ver api/_lib/guest.ts y docs/guest-checkout.md),
// código de entrega (PIN) y permisos de acceso por pedido.
// Se guardan cifrados en la bóveda (lib/secretVault.ts: IndexedDB + AES-GCM con llave no extraíble), nunca en texto
// plano en localStorage. Migración: lo que dejó la versión anterior en localStorage se pasa a la bóveda una vez y se
// borra de localStorage (solo después de quedar guardado), así nadie pierde el acceso a su compra.
import { useEffect, useState } from 'react';
import { subscribeVault, vaultBackend, vaultDelete, vaultGet, vaultHydrated, vaultKeys, vaultReady, vaultSet, vaultVersion } from './secretVault';
import { rememberPurchase } from './purchases';

export const LEGACY_KEY = 'meteorito:guest:v1';
export const LEGACY_PIN_PREFIX = 'meteorito:guest:pin:';
export const LEGACY_GRANT_PREFIX = 'meteorito:guest:access:';
/** Marca NO secreta: "este navegador tiene llave de invitado" (para no pedir Mis compras al servidor sin motivo). */
export const HAS_KEY_FLAG = 'meteorito:guest:has-key';
const V_KEY = 'guest:key';
const V_PIN = (slug: string) => `guest:pin:${slug}`;
const V_GRANT = (slug: string) => `guest:access:${slug}`;
const HEX64 = /^[a-f0-9]{64}$/;
const SLUG = /^[A-Za-z0-9_-]{3,64}$/;

type LS = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
const ls = (): LS | null => { try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; } };

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Pasa lo que la versión anterior guardó en texto plano a la bóveda y lo borra de localStorage. Idempotente. */
export async function migrateLegacy(s: LS | null = ls()): Promise<number> {
  await vaultReady();
  if (!s) return 0;
  const durable = vaultBackend() === 'idb'; // solo se borra de localStorage si la bóveda persiste entre sesiones
  let moved = 0;
  const names: string[] = [];
  try { for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k) names.push(k); } } catch { return 0; }
  for (const k of names) {
    let v: string | null = null; try { v = s.getItem(k); } catch { continue; }
    if (v === null) continue;
    let target: string | null = null; let preferVault = false; let slug: string | null = null;
    if (k === LEGACY_KEY) { if (!HEX64.test(v)) continue; target = V_KEY; preferVault = true; }
    else if (k.startsWith(LEGACY_PIN_PREFIX)) { slug = k.slice(LEGACY_PIN_PREFIX.length); if (!SLUG.test(slug) || !/^\d{4,8}$/.test(v)) continue; target = V_PIN(slug); }
    else if (k.startsWith(LEGACY_GRANT_PREFIX)) { slug = k.slice(LEGACY_GRANT_PREFIX.length); if (!SLUG.test(slug) || v.length > 2048) continue; target = V_GRANT(slug); }
    else continue;
    // La llave que ya está en la bóveda manda (una pestaña vieja podría haber generado otra al no ver la de localStorage).
    // PIN y permisos: el de localStorage es el más nuevo (solo se escribe al pagar, regenerar o abrir un link).
    const ok = preferVault && vaultGet(target) ? true : await vaultSet(target, v);
    if (k.startsWith(LEGACY_PIN_PREFIX) && slug) rememberPurchase({ slug, status: null }); // sigue en Mis compras
    if (ok && durable) { try { s.removeItem(k); } catch { /* */ } moved++; }
  }
  if (vaultGet(V_KEY)) { try { s.setItem(HAS_KEY_FLAG, '1'); } catch { /* */ } }
  return moved;
}

let migrated: Promise<number> | null = null;
/** Bóveda cargada + migración hecha (una vez por carga). */
export function guestReady(): Promise<void> {
  return (migrated ??= migrateLegacy()).then(() => undefined, () => undefined);
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') void guestReady(); // arranca al cargar (no en el render estático)

/** Legado sin migrar (bóveda no persistente): se sigue leyendo para no perder el acceso. */
const legacy = (k: string): string | null => { try { return ls()?.getItem(k) ?? null; } catch { return null; } };

/** Llave de invitado de este navegador (la crea la primera vez). */
export async function guestKey(): Promise<string> {
  await guestReady();
  const v = vaultGet(V_KEY) ?? legacy(LEGACY_KEY);
  if (v && HEX64.test(v)) return v;
  const k = randomHex(32);
  await vaultSet(V_KEY, k);
  try { ls()?.setItem(HAS_KEY_FLAG, '1'); } catch { /* */ }
  return k;
}
export function savePin(slug: string, pin: string) { void vaultSet(V_PIN(slug), pin); try { ls()?.removeItem(LEGACY_PIN_PREFIX + slug); } catch { /* */ } }
export function loadPin(slug: string): string | null { return vaultGet(V_PIN(slug)) ?? legacy(LEGACY_PIN_PREFIX + slug); }
// Permiso de acceso (link del correo/WhatsApp abierto en ESTE dispositivo): vale solo para ese pedido. Viaja en X-Order-Access.
export function saveGrant(slug: string, grant: string) { void vaultSet(V_GRANT(slug), grant); }
export function loadGrant(slug: string): string | null { return vaultGet(V_GRANT(slug)) ?? legacy(LEGACY_GRANT_PREFIX + slug); }
/** Pedidos con código de entrega guardado en este dispositivo (Mis compras). */
export const pinSlugs = (): string[] => vaultKeys('guest:pin:').map((k) => k.slice('guest:pin:'.length));
/** ¿Este dispositivo es el del comprador de este pedido? (guardó el PIN al pagar, o abrió un link de acceso) */
export const isBuyerDevice = (slug: string) => loadPin(slug) !== null || loadGrant(slug) !== null;
/** ¿Este navegador ya tiene llave de invitado? (sin crearla) */
export function hasGuestKey(): boolean {
  if (vaultGet(V_KEY)) return true;
  return legacy(HAS_KEY_FLAG) === '1' || HEX64.test(legacy(LEGACY_KEY) ?? '');
}
/** Re-render cuando la bóveda termina de cargar o cambia (lecturas síncronas de PIN / permisos). */
export function useGuestVault(): number {
  const [v, setV] = useState(vaultVersion());
  useEffect(() => { const off = subscribeVault(() => setV(vaultVersion())); if (vaultHydrated()) setV(vaultVersion()); void guestReady(); return off; }, []);
  return v;
}
