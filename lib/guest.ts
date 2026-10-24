// Comprador invitado: llave secreta aleatoria por navegador (ver api/_lib/guest.ts y docs/guest-checkout.md).
// Se guarda en localStorage (si el navegador la borra, se pierde el acceso al pedido como comprador).
const KEY = 'meteorito:guest:v1';
const PIN = (slug: string) => `meteorito:guest:pin:${slug}`;
let mem: string | null = null;
const mempins = new Map<string, string>();

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
export function guestKey(): string {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v && /^[a-f0-9]{64}$/.test(v)) return v;
    const k = randomHex(32); window.localStorage.setItem(KEY, k); return k;
  } catch { return (mem ??= randomHex(32)); } // sin storage (nativo / modo privado estricto): vale mientras viva la pestaña
}
export function savePin(slug: string, pin: string) { mempins.set(slug, pin); try { window.localStorage.setItem(PIN(slug), pin); } catch { /* */ } }
export function loadPin(slug: string): string | null { try { return window.localStorage.getItem(PIN(slug)) ?? mempins.get(slug) ?? null; } catch { return mempins.get(slug) ?? null; } }
// Permiso de acceso (link del correo/WhatsApp abierto en ESTE dispositivo): vale solo para ese pedido. Viaja en X-Order-Access.
const GRANT = (slug: string) => `meteorito:guest:access:${slug}`;
const memgrants = new Map<string, string>();
export function saveGrant(slug: string, grant: string) { memgrants.set(slug, grant); try { window.localStorage.setItem(GRANT(slug), grant); } catch { /* */ } }
export function loadGrant(slug: string): string | null {
  try { return window.localStorage.getItem(GRANT(slug)) ?? memgrants.get(slug) ?? null; } catch { return memgrants.get(slug) ?? null; }
}
/** ¿Este dispositivo es el del comprador de este pedido? (guardó el PIN al pagar, o abrió un link de acceso) */
export const isBuyerDevice = (slug: string) => loadPin(slug) !== null || loadGrant(slug) !== null;
/** ¿Este navegador ya tiene llave de invitado? (sin crearla: solo para no pedir "Mis compras" al servidor sin motivo) */
export function hasGuestKey(): boolean { if (mem) return true; try { return /^[a-f0-9]{64}$/.test(window.localStorage.getItem(KEY) ?? ''); } catch { return false; } }
