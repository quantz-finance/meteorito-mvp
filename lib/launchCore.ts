// Lógica pura del botón circular "Generar link" (Vender). Sin react-native: se prueba en Node (t88).
export type LaunchState = 'idle' | 'ready' | 'busy';

/** idle = falta algo (se ve apagado, pero se puede tocar: muestra qué falta); ready = listo para lanzar; busy = generando. */
export const launchState = (ready: boolean, busy: boolean): LaunchState => (busy ? 'busy' : ready ? 'ready' : 'idle');

/** Tamaños del círculo y sus órbitas. short = iPhone SE y similares (alto < 740): todo cabe sin scroll. */
export function launchSize(short: boolean) {
  const core = short ? 96 : 124;
  return { core, orbit: core + (short ? 26 : 34), outer: core + (short ? 44 : 58), stage: core + (short ? 6 : 14) };
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
