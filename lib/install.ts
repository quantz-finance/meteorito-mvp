// "Descargar app" (solo web): guarda beforeinstallprompt apenas carga el JS (este módulo se importa al inicio de
// app/_layout.tsx), sabe si ya está instalada y abre la hoja de instalación. En iOS/Android nativo no hace nada.
// Lógica pura en lib/installCore.ts. UI en components/InstallApp.tsx.
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { track } from './analytics';
import { detectInstallEnv, installKind, isStandalone, wantsInstall, type InstallEnv, type InstallKind } from './installCore';

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }> };
type State = { supported: boolean; installed: boolean; hasPrompt: boolean; sheet: boolean; auto: boolean; env: InstallEnv };

const WEB = Platform.OS === 'web' && typeof window !== 'undefined';
const NO_ENV: InstallEnv = { ios: false, android: false, inApp: null, iosOtherBrowser: false };
let deferred: BIPEvent | null = null;
let autoDone = false;
let state: State = { supported: false, installed: false, hasPrompt: false, sheet: false, auto: false, env: NO_ENV };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };

function standaloneNow(): boolean {
  try {
    const mm = (q: string) => typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
    return isStandalone(mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)') || mm('(display-mode: minimal-ui)'), (navigator as any).standalone);
  } catch { return false; }
}

if (WEB) {
  const env = detectInstallEnv(navigator.userAgent || '', navigator.maxTouchPoints || 0);
  // El query se lee YA: el router redirige "/" -> "/comprar" y lo borra.
  state = { ...state, supported: true, installed: standaloneNow(), env, auto: wantsInstall(window.location.href) };
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // sin la mini barra del navegador: lo abre nuestro botón
    deferred = e as BIPEvent;
    set({ hasPrompt: true });
  });
  window.addEventListener('appinstalled', () => { deferred = null; set({ installed: true, hasPrompt: false, sheet: false }); track('install_completed'); });
  try { window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', (ev) => { if (ev.matches) set({ installed: true, sheet: false }); }); } catch {}
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const get = () => state;
export function useInstall(): State & { kind: InstallKind; visible: boolean } {
  const s = useSyncExternalStore(subscribe, get, get);
  return { ...s, kind: installKind(s.env, s.hasPrompt), visible: s.supported && !s.installed };
}

/** Abre el aviso nativo de instalación (necesita un toque de la persona). Devuelve el resultado. */
export async function promptInstall(from: string): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred;
  if (!e) { set({ sheet: true }); return 'unavailable'; }
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    track(outcome === 'accepted' ? 'install_accepted' : 'install_dismissed', { from });
    // El evento sirve una sola vez; si la persona lo cerró, el navegador manda otro más tarde.
    deferred = null;
    set({ hasPrompt: false, sheet: false, installed: outcome === 'accepted' ? true : state.installed });
    return outcome;
  } catch {
    deferred = null; set({ hasPrompt: false, sheet: true });
    return 'unavailable';
  }
}

/** Toque en "Descargar app": un toque instala donde se puede; si no, abre la guía. */
export function startInstall(from: string) {
  const kind = installKind(state.env, state.hasPrompt);
  track('install_click', { from, kind });
  if (kind === 'prompt') { void promptInstall(from); return; }
  set({ sheet: true });
}
export const openInstallSheet = () => set({ sheet: true });
export const closeInstallSheet = () => set({ sheet: false });
/** ?instalar=1 ya se atendió (una vez por carga). */
export const consumeAutoInstall = () => { if (autoDone) return false; autoDone = true; return state.auto && state.supported && !state.installed; };
