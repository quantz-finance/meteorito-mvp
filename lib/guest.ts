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
/** ¿Este dispositivo es el del comprador de este pedido? (guardó el PIN al pagar) */
export const isBuyerDevice = (slug: string) => loadPin(slug) !== null;
