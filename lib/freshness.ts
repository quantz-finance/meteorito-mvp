// "Actualizado hace Xs": formato puro (testeable) + hook que re-renderiza cada segundo.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

export function agoLabel(updatedAt: number | null, now: number = Date.now()): string {
  if (!updatedAt) return 'Actualizando…';
  const s = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (s < 5) return 'Actualizado ahora';
  if (s < 60) return `Actualizado hace ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `Actualizado hace ${m} min`;
  return `Actualizado hace ${Math.floor(m / 60)} h`;
}
/** Tras 2 ciclos de polling sin respuesta, avisar que la conexión puede estar fallando. */
export const isStale = (updatedAt: number | null, pollMs: number, now: number = Date.now()) => !!updatedAt && now - updatedAt > pollMs * 3;

export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), everyMs); return () => clearInterval(id); }, [everyMs]);
  return now;
}

/** Hora del último refresco fuera del estado de la pantalla: al marcarla solo se re-renderiza el indicador <Freshness>. */
export interface Stamp { get(): number | null; set(v: number): void; subscribe(fn: () => void): () => void }
export function createStamp(): Stamp {
  let v: number | null = null; const subs = new Set<() => void>();
  return { get: () => v, set: (x) => { v = x; subs.forEach((f) => f()); }, subscribe: (f) => { subs.add(f); return () => { subs.delete(f); }; } };
}
export function useStamp(): Stamp {
  const r = useRef<Stamp | null>(null);
  if (!r.current) r.current = createStamp();
  return r.current;
}
export const useStampValue = (s: Stamp) => useSyncExternalStore(s.subscribe, s.get, s.get);
