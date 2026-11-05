// Web (Safari / PWA): SDK web de Cavos, cargado BAJO DEMANDA (lib/cavosBridge.tsx = chunk aparte).
// La app pinta sin esperarlo: sin rastro de sesión ni login pedido, el SDK solo se precarga en idle (o no, en links de pago).
import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { DEMO_ENABLED, useDemoAuth } from './demo';
import { authStore, hasCavosTrace, useAuthAttempt, useAuthFlag, useAuthStore } from './authStore';
import { loginErrorCode, setLoginTracker, trackLoginError } from './loginGuard';
import { track } from './analytics';
import type { MeteoritoAuth } from './types';

setLoginTracker(track); // eventos login_* también si el chunk del SDK no llega a cargar
const Nothing: ComponentType = () => null;
/** Chunk del SDK con tope y sin romper la app: si no baja (CDN lento, sin red, deploy nuevo), la pantalla de entrar
 *  muestra "Reintentar" en vez de quedarse cargando o caer en la pantalla de error. Un intento nuevo por "Reintentar". */
export function loadBridge(importer: () => Promise<{ default: ComponentType }> = () => import('./cavosBridge')): Promise<{ default: ComponentType }> {
  return importer().catch((e) => {
    console.warn('[cavos] no cargó el SDK:', loginErrorCode(e));
    trackLoginError('sdk_load', e);
    authStore.setLoadFailed();
    return { default: Nothing };
  });
}

// Rutas públicas (link de pago, legales): ahí el SDK NO se carga hasta que haga falta (login explícito o sesión previa).
const isPublicPath = () => /^\/(p|i|legal)(\/|$)/.test(window.location.pathname);

export function CavosRoot({ children }: { children: ReactNode }) {
  // El SDK usa window/localStorage: no se monta durante el render estático.
  const [mounted, setMounted] = useState(false);
  const load = useAuthFlag('load');
  const attempt = useAuthAttempt();
  const CavosBridge = useMemo(() => lazy(() => loadBridge()), [attempt]);
  useEffect(() => {
    setMounted(true);
    if (DEMO_ENABLED) return;
    const trace = hasCavosTrace();
    authStore.setHint(trace);
    if (trace) { authStore.requestLoad(); return; }
    if (isPublicPath()) return; // comprador con link: cero SDK de wallet
    // Precarga del SDK solo cuando la página ya terminó de cargar y pasó un respiro: así no le quita ancho de banda a imágenes/fuentes del primer pantallazo.
    const w = window as any;
    let id: any; let idle: any;
    const schedule = () => { id = setTimeout(() => { idle = w.requestIdleCallback ? w.requestIdleCallback(() => authStore.requestLoad(), { timeout: 4000 }) : (authStore.requestLoad(), null); }, 3500); };
    if (document.readyState === 'complete') schedule(); else window.addEventListener('load', schedule, { once: true });
    return () => { window.removeEventListener('load', schedule); clearTimeout(id); if (idle != null && w.cancelIdleCallback) w.cancelIdleCallback(idle); };
  }, []);
  if (!mounted) return null;
  if (DEMO_ENABLED || !load) return <>{children}</>; // demo: sin proveedor Cavos
  // La app NO espera al SDK ni se re-monta cuando llega: Cavos vive en un chunk hermano y publica la sesión en authStore.
  return <>{children}<Suspense fallback={null}><CavosBridge key={attempt} /></Suspense></>;
}

/** Modo demo (build con EXPO_PUBLIC_DEMO_MODE): sesión simulada, sin Cavos. DEMO_ENABLED es constante en el build, el orden de hooks no cambia. */
export function useAuth(): MeteoritoAuth {
  return DEMO_ENABLED ? useDemoAuth() : useAuthStore();
}
