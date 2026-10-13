// Ventana de liberación automática (la define el servidor: AUTO_RELEASE_MINUTES, expuesta en /api/health).
import { useEffect, useState } from 'react';

export const DEFAULT_AUTO_RELEASE_MINUTES = 1440;

/** 1440 -> "24 h", 90 -> "1 h 30 min", 10 -> "10 min". */
export function formatWindow(min: number): string {
  const m = Number.isFinite(min) && min > 0 ? Math.round(min) : DEFAULT_AUTO_RELEASE_MINUTES;
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** Tiempo restante hasta una fecha ISO: "3 h 12 min", "menos de 1 min". */
export function timeLeft(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso) - now;
  if (!(ms > 60_000)) return 'menos de 1 min';
  return formatWindow(Math.floor(ms / 60_000));
}

let cached: number | null = null;
let inflight: Promise<number> | null = null;
function load(): Promise<number> {
  inflight ??= fetch('/api/health').then((r) => r.json()).then((j) => {
    const v = Number(j?.config?.autoReleaseMinutes); cached = v > 0 ? v : DEFAULT_AUTO_RELEASE_MINUTES; return cached;
  }).catch(() => DEFAULT_AUTO_RELEASE_MINUTES);
  return inflight;
}

/** Texto de la ventana ("24 h"). Muestra el default hasta que responde el servidor. */
export function useAutoReleaseWindow(): string {
  const [m, setM] = useState(cached ?? DEFAULT_AUTO_RELEASE_MINUTES);
  useEffect(() => { if (cached == null) load().then(setM); }, []);
  return formatWindow(m);
}
