// La PWA se actualiza sola: busca versión nueva al abrir, al volver a primer plano y cada 5 min. El SW nuevo se activa
// solo (skipWaiting + clients.claim) y aquí se recarga en un momento seguro: nunca con un pago/firma/llamada al API en
// curso, una hoja (Sheet) abierta, el login de Cavos abierto o un formulario a medio llenar. Si no es seguro, espera.
import { useEffect } from 'react';

let holds = 0;
let pending = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const WEB = typeof window !== 'undefined' && typeof document !== 'undefined';
export const UPDATED_FLAG = 'meteorito:updated';

/** Bloquea la recarga mientras dure algo delicado. Devuelve la función para soltarlo (idempotente). */
export function holdUpdate(): () => void {
  holds++; let done = false;
  return () => { if (done) return; done = true; holds = Math.max(0, holds - 1); if (pending) schedule(400); };
}
export function useHoldUpdate(active: boolean) {
  useEffect(() => (active ? holdUpdate() : undefined), [active]);
}

/** ¿Hay algo a medio hacer en pantalla? (pura sobre el DOM; testeable con un DOM falso). */
export function pageBusy(doc: Pick<Document, 'activeElement' | 'querySelectorAll' | 'querySelector'> = document): boolean {
  const a = doc.activeElement as HTMLElement | null;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
  for (const el of Array.from(doc.querySelectorAll('input, textarea')) as HTMLInputElement[]) {
    if (el.type === 'hidden' || el.type === 'checkbox' || el.type === 'radio' || el.readOnly) continue;
    if ((el.value ?? '').trim()) return true;
  }
  return !!doc.querySelector('.cavos-overlay, .cavos-card'); // modal de login/firma de Cavos abierto (sus estilos globales no cuentan)
}
export const safeToReload = () => holds === 0 && !pageBusy();

function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (!pending) return;
    if (safeToReload()) { try { sessionStorage.setItem(UPDATED_FLAG, '1'); } catch { /* sin storage */ } location.reload(); }
    else schedule(3000);
  }, ms);
}

/** Registra el SW (solo en el build exportado: lo marca scripts/build/preload.mjs) y vigila versiones nuevas. */
export function startUpdater() {
  if (!WEB || !('serviceWorker' in navigator) || !document.querySelector('meta[name="postbuild"]')) return;
  const sw = navigator.serviceWorker;
  // La primera instalación también dispara controllerchange (clients.claim): esa no es una versión nueva, no recarga.
  let firstClaim = !sw.controller;
  sw.addEventListener('controllerchange', () => {
    if (firstClaim) { firstClaim = false; return; }
    if (!pending) { pending = true; schedule(600); }
  });
  const go = () => sw.register('/sw.js').then((reg) => {
    const check = () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); };
    document.addEventListener('visibilitychange', () => {
      check();
      if (pending && document.visibilityState === 'hidden') schedule(0); // en segundo plano es el mejor momento (si es seguro)
    });
    setInterval(check, 5 * 60 * 1000);
  }).catch(() => {});
  const idle = (window as any).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1500));
  if (document.readyState === 'complete') idle(go); else window.addEventListener('load', () => idle(go), { once: true });
}
/** ¿Esta carga viene de una actualización automática? (para el toast "Actualizado"). Lo consume. */
export function consumeUpdatedFlag(): boolean {
  try { const v = sessionStorage.getItem(UPDATED_FLAG); if (v) sessionStorage.removeItem(UPDATED_FLAG); return !!v; } catch { return false; }
}
