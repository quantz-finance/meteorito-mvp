// Web (Safari / PWA): SDK web de Cavos, cargado BAJO DEMANDA (lib/cavosBridge.tsx = chunk aparte).
// La app pinta sin esperarlo: sin rastro de sesión ni login pedido, el SDK solo se precarga en idle (o no, en links de pago).
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { DEMO_ENABLED, useDemoAuth } from './demo';
import { authStore, hasCavosTrace, useAuthLoadState, useAuthStore } from './authStore';
import type { MeteoritoAuth } from './types';

const CavosBridge = lazy(() => import('./cavosBridge'));

// Rutas públicas (link de pago, legales): ahí el SDK NO se carga hasta que haga falta (login explícito o sesión previa).
const isPublicPath = () => /^\/(p|legal)(\/|$)/.test(window.location.pathname);

export function CavosRoot({ children }: { children: ReactNode }) {
  // El SDK usa window/localStorage: no se monta durante el render estático.
  const [mounted, setMounted] = useState(false);
  const { load } = useAuthLoadState();
  useEffect(() => {
    setMounted(true);
    if (DEMO_ENABLED) return;
    const trace = hasCavosTrace();
    authStore.setHint(trace);
    if (trace) { authStore.requestLoad(); return; }
    if (isPublicPath()) return; // comprador con link: cero SDK de wallet
    const w = window as any;
    const id = w.requestIdleCallback ? w.requestIdleCallback(() => authStore.requestLoad(), { timeout: 2500 }) : setTimeout(() => authStore.requestLoad(), 1500);
    return () => { w.cancelIdleCallback ? w.cancelIdleCallback(id) : clearTimeout(id); };
  }, []);
  if (!mounted) return null;
  if (DEMO_ENABLED || !load) return <>{children}</>; // demo: sin proveedor Cavos
  // La app NO espera al SDK ni se re-monta cuando llega: Cavos vive en un chunk hermano y publica la sesión en authStore.
  return <>{children}<Suspense fallback={null}><CavosBridge /></Suspense></>;
}

/** Modo demo (build con EXPO_PUBLIC_DEMO_MODE): sesión simulada, sin Cavos. DEMO_ENABLED es constante en el build, el orden de hooks no cambia. */
export function useAuth(): MeteoritoAuth {
  return DEMO_ENABLED ? useDemoAuth() : useAuthStore();
}
