// Tour guiado (estilo Joyride, overlay propio: sin dependencias, funciona igual en react-native-web y en nativo).
// Puro (sin react-native): lo leen components/Tour.tsx, lib/rules.ts (TOUR) y los tests de node (scripts/ci/t97-tour.test.ts).
//  - Arranca solo UNA vez: la primera vez que alguien abre la app en una pestaña (Vender, Home o Comprar). Nunca en un
//    link de pago, tienda, invitación o legales (quien llega a pagar no se topa con el tour).
//  - "Visto" en localStorage (web); sin localStorage (nativo, modo privado) queda en memoria: nunca rompe ni lanza.
//  - "Ver recorrido" (Mi cuenta y Cómo funciona) lo vuelve a abrir cuando quieras.
//  - Cada paso puede apuntar a un elemento (data-tour / testID). Si no está en pantalla (sin pedidos, sin productos,
//    invitado sin barra de pestañas, nativo), el paso se muestra igual, centrado y sin resaltar nada.
// Copy corto, en tuteo y sin palabras prohibidas por la regla legal (scripts/ci/t97-tour.test.ts).

export interface TourStep {
  id: 'hola' | 'link' | 'custodia' | 'entrega' | 'reglas';
  title: string;
  text: string;
  /** Elementos a resaltar, en orden de preferencia: data-tour="…" o testID="…". El primero visible gana. */
  targets: string[];
}

export const TOUR_STEPS: TourStep[] = [
  { id: 'hola', title: 'Te damos la bienvenida',
    text: 'En 4 pasos ves cómo funciona Meteorito. Es una beta en testnet, sin dinero real.', targets: [] },
  { id: 'link', title: 'Crea un link de pago',
    text: 'En Vender pones el producto y el precio, y generas un link. Lo compartes y quien compra paga desde ahí.',
    targets: ['launch-space', 'tab-vender', 'comprar-link'] },
  { id: 'custodia', title: 'El pago queda en custodia',
    text: 'Cuando alguien paga, el dinero queda apartado en custodia. Solo se libera según las reglas: con el código de entrega, al vencer el plazo o al resolverse una disputa.',
    targets: [] },
  { id: 'entrega', title: 'Envío o entrega',
    text: 'Con envío, quien vende toca "Ya lo envié". Cara a cara, se entrega en persona. Quien compra da su código de entrega y el pago se libera. Si no hay código ni disputa, se libera solo al vencer el plazo acordado.',
    targets: ['tab-pedidos', 'comprar-compras'] },
  { id: 'reglas', title: 'Las reglas, siempre a mano',
    text: 'En Cómo funciona están todas las reglas. Desde ahí o desde Mi cuenta puedes ver este recorrido otra vez.',
    targets: ['rules-hint', 'rules-link', 'tour-button'] },
];

export const TOUR_COPY = {
  button: 'Ver recorrido',
  label: 'Recorrido guiado',
  next: 'Siguiente',
  back: 'Atrás',
  skip: 'Saltar',
  done: 'Listo',
  count: (i: number, n: number) => `${i} de ${n}`,
} as const;

export const TOUR_SEEN_KEY = 'meteorito:tour-visto:v1';
/** Navegador automatizado (e2e): el tour NO arranca solo (taparía los demás tests), salvo con este flag = '1'. */
export const TOUR_E2E_KEY = 'meteorito:e2e-tour';
/** Espera antes de abrir solo: la pantalla ya pintó y los elementos a resaltar existen. */
export const TOUR_AUTO_DELAY_MS = 900;

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
function storage(): Store | null {
  try {
    const s = (globalThis as { localStorage?: Store }).localStorage;
    return s && typeof s.getItem === 'function' ? s : null;
  } catch { return null; }
}
let memSeen = false; // sin localStorage: visto solo en esta sesión de la app

export function tourSeen(): boolean {
  if (memSeen) return true;
  try { return storage()?.getItem(TOUR_SEEN_KEY) === '1'; } catch { return false; }
}
export function markTourSeen() {
  memSeen = true;
  try { storage()?.setItem(TOUR_SEEN_KEY, '1'); } catch { /* sin storage: queda en memoria */ }
}
/** Solo tests. */
export function resetTourSeen() {
  memSeen = false;
  try { storage()?.removeItem(TOUR_SEEN_KEY); } catch { /* */ }
}

/** ¿Esta pantalla abre el tour sola? Solo las pestañas (Vender, Home, Comprar): nunca un link público (/p, /t, /i, legales…). */
export function isTourAutoRoute(segments: readonly string[]): boolean {
  return segments[0] === '(tabs)';
}

function automated(): boolean {
  try { return !!(globalThis as { navigator?: { webdriver?: boolean } }).navigator?.webdriver; } catch { return false; }
}
/** ¿Se puede abrir solo ahora? No si ya se vio, ni en un navegador automatizado sin el flag de e2e. */
export function tourAutoAllowed(): boolean {
  if (tourSeen()) return false;
  if (automated()) { try { return storage()?.getItem(TOUR_E2E_KEY) === '1'; } catch { return false; } }
  return true;
}

// --- Estado (un solo tour a la vez), con suscripción para useSyncExternalStore ---
export type TourSource = 'auto' | 'button';
export interface TourState { open: boolean; index: number; source: TourSource }
let state: TourState = { open: false, index: 0, source: 'auto' };
const listeners = new Set<() => void>();
const set = (s: TourState) => { state = s; listeners.forEach((f) => f()); };
export const getTourState = () => state;
export const subscribeTour = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

/** Abre el tour desde el primer paso y lo marca como visto (cerrarlo o recargar no lo vuelve a abrir solo). */
export function startTour(source: TourSource = 'button') {
  markTourSeen();
  set({ open: true, index: 0, source });
}
export function nextTourStep() {
  if (!state.open) return;
  if (state.index >= TOUR_STEPS.length - 1) { closeTour(); return; }
  set({ ...state, index: state.index + 1 });
}
export function prevTourStep() {
  if (state.open && state.index > 0) set({ ...state, index: state.index - 1 });
}
export function closeTour() {
  if (state.open) set({ ...state, open: false });
}
