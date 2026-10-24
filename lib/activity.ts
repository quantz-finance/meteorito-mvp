// Última conexión del vendedor: texto del rango que manda el API (nunca la hora exacta) y freno del aviso en el cliente.
import { COPY } from './copy';

export type Activity = { k: 'online' } | { k: 'min'; n: number } | { k: 'h'; n: number } | { k: 'yesterday' } | { k: 'days'; n: number };
/** = SEEN_THROTTLE_MS del API (api/_lib/activity.ts); t68 revisa que coincidan. */
export const SEEN_THROTTLE_MS = 5 * 60_000;

export function activityLabel(a: Activity | null | undefined): string | null {
  if (!a) return null;
  switch (a.k) {
    case 'online': return COPY.activity.online;
    case 'min': return COPY.activity.min(a.n);
    case 'h': return COPY.activity.hours(a.n);
    case 'yesterday': return COPY.activity.yesterday;
    case 'days': return COPY.activity.days(a.n);
    default: return null;
  }
}

/** ¿Avisar actividad ahora? Como máximo una vez cada 5 min por navegador y cuenta. */
export const shouldPing = (lastMs: number | null, now = Date.now()) => lastMs == null || !Number.isFinite(lastMs) || now - lastMs >= SEEN_THROTTLE_MS;
