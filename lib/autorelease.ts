// Ventana de liberación automática (la define el servidor: AUTO_RELEASE_MINUTES, expuesta en /api/health).
import { useEffect, useState } from 'react';
import { DEMO_AUTO_RELEASE_MINUTES, DEMO_ENABLED } from './demo';

export const DEFAULT_AUTO_RELEASE_MINUTES = 10080; // 7 días (igual que el servidor)

/** 10080 -> "7 días", 1440 -> "1 día", 9000 -> "6 días 6 h", 90 -> "1 h 30 min", 10 -> "10 min". */
export function formatWindow(min: number): string {
  const m = Number.isFinite(min) && min > 0 ? Math.round(min) : DEFAULT_AUTO_RELEASE_MINUTES;
  if (m >= 1440) {
    const d = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60);
    return `${d} ${d === 1 ? 'día' : 'días'}${hh ? ` ${hh} h` : ''}`;
  }
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
let inflight: Promise<number | null> | null = null;
function load(): Promise<number | null> {
  if (DEMO_ENABLED) return Promise.resolve(DEMO_AUTO_RELEASE_MINUTES); // demo: sin red, mismo valor que producción
  inflight ??= fetch('/api/health').then((r) => r.json()).then((j) => {
    const v = Number(j?.config?.autoReleaseMinutes); if (v > 0) cached = v; else inflight = null; return cached;
  }).catch(() => { inflight = null; return null; });
  return inflight;
}

/** Texto de la ventana real del servidor ("24 h", "10 min"). null hasta que responde /api/health (o si falla):
 *  la UI usa un texto genérico en vez de inventar un plazo. */
export function useAutoReleaseWindow(): string | null {
  const [m, setM] = useState<number | null>(cached);
  useEffect(() => { if (cached == null) load().then(setM); }, []);
  return m ? formatWindow(m) : null;
}
