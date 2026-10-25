// Lógica pura del botón circular "Generar link" (Vender). Sin react-native: se prueba en Node (t88).
export type LaunchState = 'idle' | 'ready' | 'busy';

/** idle = falta algo (se ve apagado, pero se puede tocar: muestra qué falta); ready = listo para lanzar; busy = generando. */
export const launchState = (ready: boolean, busy: boolean): LaunchState => (busy ? 'busy' : ready ? 'ready' : 'idle');

/** Círculo: entre 96 px (iPhone SE con avisos extra) y 150 px (pantallas altas). */
export const LAUNCH_MIN = 96, LAUNCH_MAX = 150;
/** Aire arriba y abajo del círculo dentro de su escenario (6 px en pantallas bajas como iPhone SE, 10 px en las altas). */
export const launchPad = (stageH: number) => (stageH < 160 ? 6 : 10);
/** Alto mínimo del escenario propio del círculo (si no cabe, la pantalla hace scroll; nunca queda encima de otra cosa). */
export const LAUNCH_STAGE_MIN = LAUNCH_MIN + 2 * launchPad(0);

export interface Orbit { /** semieje horizontal */ a: number; /** semieje vertical */ b: number; /** inclinación en grados */ tilt: number; /** vuelta en s */ period: number }

/**
 * Tamaño del círculo según el alto libre de su escenario (entre "Entrega y plazo" y los avisos) y su ancho.
 * Órbitas elípticas inclinadas (planas, como un anillo visto de lado): se abren hacia los costados y casi no suman alto,
 * así el círculo y sus órbitas caben en su propio espacio sin tapar nada.
 */
export function launchSize(stageH: number, stageW = 343) {
  // par: radio entero (bordes nítidos)
  const core = 2 * Math.floor(Math.max(LAUNCH_MIN, Math.min(LAUNCH_MAX, stageH - 2 * launchPad(stageH), stageW / 2.2)) / 2);
  const orbit = (ka: number, kb: number, tilt: number, period: number): Orbit => ({ a: Math.round(core * ka), b: Math.round(core * kb), tilt, period });
  return { core, inner: orbit(0.78, 0.27, -14, 9), outer: orbit(0.98, 0.33, 9, 14) };
}

/** Medio alto que ocupa una órbita inclinada (para verificar que no se sale del escenario). */
export function orbitHalfHeight(o: Orbit) {
  const t = (Math.abs(o.tilt) * Math.PI) / 180;
  return Math.hypot(o.a * Math.sin(t), o.b * Math.cos(t));
}

/** Chispas del impacto al lanzar: n puntos en círculo, desplazamiento en px (para --x/--y en CSS o Animated en nativo). */
export function burstPoints(n: number, radius: number) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const d = radius * (i % 2 ? 0.78 : 1);
    return { x: Math.round(Math.cos(a) * d), y: Math.round(Math.sin(a) * d) };
  });
}

/** Partículas que flotan alrededor del círculo: [left %, delay s, deriva X px]. Pocas: livianas en teléfonos lentos. */
export const FLOATERS: [number, number, number][] = [[8, 0, -6], [24, 1.6, 4], [46, 0.8, -3], [66, 2.4, 5], [84, 1.2, -4], [92, 3.0, 3]];
