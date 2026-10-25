// "Modo de la app" de ESTE dispositivo (cada persona decide qué ve; no afecta a nadie más). Tres opciones:
//  - 'testnet' (default para todos): solo usuarios, tiendas y publicaciones reales (la beta en testnet).
//  - 'ejemplos' ("Datos de ejemplo"): además los ejemplos (productos, tiendas /t/<ejemplo>, ventas y tiendas sugeridas).
//  - 'mainnet': "Próximamente", visible pero desactivado (no se puede elegir).
// El modo SOLO decide si se ven los ejemplos: no cambia la red, los escrows ni el flujo de pago. Con 'ejemplos' la app
// pide al API ?ejemplos=1 / { ejemplos: true } y el servidor decide por pedido (api/_lib/demoFlag.ts demoWanted).
// Se cambia en Mi cuenta (components/AppModePicker.tsx). En el build de demo arranca en 'ejemplos' (es una vitrina).
import { useSyncExternalStore } from 'react';
import { DEMO_ENABLED } from './demo';

export type AppMode = 'ejemplos' | 'testnet' | 'mainnet';
/** Modos que hoy se pueden elegir (Mainnet: próximamente). */
export const SELECTABLE_MODES: readonly AppMode[] = ['ejemplos', 'testnet'];
const KEY = 'meteorito:modo-app';
const listeners = new Set<() => void>();
let mem: AppMode | null = null; // sin localStorage (nativo o modo privado): solo en memoria

export function getAppMode(): AppMode {
  try { const v = globalThis.localStorage?.getItem(KEY); if (v === 'ejemplos' || v === 'testnet') return v; } catch { /* sin storage */ }
  return mem ?? (DEMO_ENABLED ? 'ejemplos' : 'testnet');
}
/** Cambia el modo. Mainnet (o cualquier otro valor) no se puede elegir: devuelve false y no cambia nada. */
export function setAppMode(m: AppMode): boolean {
  if (!SELECTABLE_MODES.includes(m)) return false;
  mem = m;
  try { globalThis.localStorage?.setItem(KEY, m); } catch { /* sin storage */ }
  listeners.forEach((f) => f());
  return true;
}
/** ¿Se piden los datos de ejemplo? (modo "Datos de ejemplo"). */
export const demoPrefOn = () => getAppMode() === 'ejemplos';
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const useAppMode = () => useSyncExternalStore(subscribe, getAppMode, (): AppMode => 'testnet');
