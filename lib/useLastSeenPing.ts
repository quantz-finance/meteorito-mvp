// Última conexión: con sesión, avisa actividad al abrir la app, al volver a ella y cada minuto mientras está visible,
// como máximo una vez cada 5 min (freno aquí, por cuenta, y otro en el servidor con un UPDATE condicional).
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { shouldPing } from './activity';
import { pingSeen } from './store';
import type { MeteoritoAuth } from './types';

const KEY = (who: string) => `meteorito:seen:${who}`;
function lastOf(who: string): number | null {
  try { const v = Number(globalThis.localStorage?.getItem(KEY(who))); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; }
}

export function useLastSeenPing(auth: MeteoritoAuth, authed: boolean) {
  useEffect(() => {
    if (!authed || !auth.address) return;
    const who = auth.address;
    const tick = () => {
      if (Platform.OS === 'web' && typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (!shouldPing(lastOf(who), now)) return;
      try { globalThis.localStorage?.setItem(KEY(who), String(now)); } catch { /* sin almacenamiento: el servidor frena igual */ }
      void pingSeen(auth);
    };
    tick();
    const id = setInterval(tick, 60_000);
    const onVis = () => tick();
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); if (Platform.OS === 'web' && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis); };
  }, [authed, auth.address]);
}
