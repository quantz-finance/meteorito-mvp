// Fechas y cuenta regresiva de los plazos de las reglas (lib/rules.ts LEGAL_RULES) para las dos partes. Sin APIs web.
import { useEffect, useState } from 'react';
import { timeLeft } from './autorelease';

/** "4 nov., 15:05" (hora local del teléfono). */
export const whenLabel = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('es-CR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '');
/** "2 días 3 h", "5 h 10 min"… (nunca negativo). */
export const leftLabel = (iso: string | null | undefined, now = Date.now()) => (iso ? timeLeft(iso, now) : '');
/** Reloj que avanza cada `ms` (cuenta regresiva en pantalla). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
