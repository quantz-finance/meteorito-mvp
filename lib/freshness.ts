// "Actualizado hace Xs": formato puro (testeable) + hook que re-renderiza cada segundo.
import { useEffect, useState } from 'react';

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
