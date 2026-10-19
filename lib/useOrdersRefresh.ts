import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { needsPolling, POLL_MS } from '@/lib/refresh';

/**
 * Refresca en silencio (sin spinner) mientras la pantalla está enfocada y haya pedidos no finales:
 * polling cada POLL_MS y refetch inmediato al volver el foco a la app/pestaña.
 */
export function useOrdersRefresh(refresh: () => void | Promise<void>, orders: { status: string }[] | null) {
  const ref = useRef(refresh);
  useEffect(() => { ref.current = refresh; });
  const active = needsPolling(orders);

  useFocusEffect(useCallback(() => {
    if (!active) return;
    const tick = () => { if (Platform.OS !== 'web' || typeof document === 'undefined' || !document.hidden) void ref.current(); };
    const id = setInterval(tick, POLL_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void ref.current(); });
    const onVis = () => { if (typeof document !== 'undefined' && !document.hidden) void ref.current(); };
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVis);
      window.addEventListener('focus', onVis);
    }
    return () => {
      clearInterval(id); sub.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); }
    };
  }, [active]));
}
