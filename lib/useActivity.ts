// Última conexión de los vendedores en pantalla: se pide aparte, sin caché, y se refresca al volver a la app y cada
// minuto. Si el vendedor la apaga, desaparece en la siguiente lectura (no queda en ninguna caché del feed o el perfil).
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import type { Activity } from './activity';
import { getActivity } from './store';

export function useActivity(slugs: string[]): Record<string, Activity> {
  const key = [...new Set(slugs.filter(Boolean))].sort().join(',');
  const [acts, setActs] = useState<Record<string, Activity>>({});
  useEffect(() => {
    if (!key) { setActs({}); return; }
    let live = true;
    const load = () => { getActivity(key.split(',')).then((a) => { if (live) setActs(a); }); };
    load();
    const id = setInterval(load, 60_000);
    const onVis = () => { if (typeof document !== 'undefined' && document.visibilityState === 'visible') load(); };
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => { live = false; clearInterval(id); if (Platform.OS === 'web' && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis); };
  }, [key]);
  return acts;
}
