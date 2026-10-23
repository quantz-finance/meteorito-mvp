// Alto de pantalla ESTABLE (web/PWA iOS): el teclado no cambia el layout.
// react-native-web mide la ventana con visualViewport. En iPhone el teclado lo achica, así que useWindowDimensions()
// bajaba de 667 a ~350 px: la pantalla se comprimía y se movía. Aquí el alto solo baja si no hay un campo enfocado
// (es decir, sin teclado); al girar el teléfono (cambia el ancho) se toma el nuevo. Además fija --app-h en <html> para
// que #root no dependa del alto con teclado, y mantiene visible el campo activo.
import { useSyncExternalStore } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

import { editableFocused, nextStable, type Size } from './viewportCore';
export { editableFocused, nextStable, type Size };
const WEB = Platform.OS === 'web' && typeof window !== 'undefined' && typeof document !== 'undefined';

let stable: Size | null = null;
const subs = new Set<() => void>();
function measure(): Size {
  const d = document.documentElement;
  // Layout viewport (no el visual): clientHeight no cambia con el teclado en iOS.
  return { width: d.clientWidth || window.innerWidth, height: d.clientHeight || window.innerHeight };
}
function update() {
  const n = nextStable(stable, measure(), editableFocused());
  if (n === stable) return;
  stable = n;
  document.documentElement.style.setProperty('--app-h', `${n.height}px`);
  subs.forEach((f) => f());
}
function revealFocused() {
  if (!editableFocused()) return;
  const el = document.activeElement as HTMLElement;
  const vv = window.visualViewport;
  const r = el.getBoundingClientRect();
  const bottom = vv ? vv.height + vv.offsetTop : window.innerHeight;
  if (r.bottom > bottom - 12 || r.top < (vv?.offsetTop ?? 0)) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
let installed = false;
export function installViewport() {
  if (!WEB || installed) return;
  installed = true;
  update();
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', () => setTimeout(update, 250));
  document.addEventListener('focusout', () => setTimeout(update, 300)); // teclado cerrado: aceptar el alto real
  window.visualViewport?.addEventListener('resize', () => { update(); setTimeout(revealFocused, 60); });
  document.addEventListener('focusin', () => setTimeout(revealFocused, 350));
}
const subscribe = (f: () => void) => { installViewport(); subs.add(f); return () => { subs.delete(f); }; };
const get = () => stable ?? (stable = measure());
const getServer = () => ({ width: 375, height: 667 });

/** Como useWindowDimensions(), pero el alto no cambia al abrir el teclado (web). */
export function useStableWindow(): Size {
  if (!WEB) return useWindowDimensions(); // eslint-disable-line react-hooks/rules-of-hooks -- Platform es constante
  return useSyncExternalStore(subscribe, get, getServer); // eslint-disable-line react-hooks/rules-of-hooks
}
