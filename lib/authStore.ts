// Estado de auth compartido entre la app y el SDK Cavos (web), que se carga bajo demanda (chunk aparte, ~MB).
// Mientras Cavos no está montado, la app ve una sesión de invitado (sin cuenta) y nunca espera al SDK.
import { useSyncExternalStore } from 'react';
import { CAVOS_APP_ID } from './config';
import type { MeteoritoAuth } from './types';

interface State { bridged: MeteoritoAuth | null; load: boolean; hint: boolean; wantLogin: boolean }
let state: State = { bridged: null, load: false, hint: false, wantLogin: false };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const set = (p: Partial<State>) => { state = { ...state, ...p }; emit(); };

export const authStore = {
  subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
  get: () => state,
  setBridged: (bridged: MeteoritoAuth | null) => set({ bridged }),
  requestLoad: () => { if (!state.load) set({ load: true }); },
  setHint: (hint: boolean) => set({ hint }),
  /** El usuario tocó "Entrar": cargar Cavos y abrir su modal en cuanto esté listo. */
  requestLogin: () => set({ load: true, wantLogin: true }),
  consumeLogin: () => { if (state.wantLogin) set({ wantLogin: false }); },
};

const nope = () => Promise.reject(new Error('Inicia sesión'));
const noWallet = { state: 'loading' as const, recoveryProtected: false, hasPasskey: false, approveDevice: nope, enrollPasskey: nope };
const base = (isLoading: boolean): MeteoritoAuth => ({
  configured: !!CAVOS_APP_ID, isAuthenticated: false, isLoading, email: null, address: null, error: null,
  openLogin: () => authStore.requestLogin(), logout: () => {}, getAuthToken: () => null, signMessage: nope as any, signXdr: nope, wallet: noWallet,
});
const guestIdle = base(false);
const guestLoading = base(true);

/** ¿Hay rastro de una sesión Cavos (o un login en curso) en este navegador? Entonces hay que montar el SDK ya. */
export function hasCavosTrace(): boolean {
  try {
    for (const st of [window.localStorage, window.sessionStorage]) for (let i = 0; i < st.length; i++) if ((st.key(i) ?? '').toLowerCase().includes('cavos')) return true;
  } catch { /* storage bloqueado */ }
  return false;
}

export function useAuthStore(): MeteoritoAuth {
  const s = useSyncExternalStore(authStore.subscribe, authStore.get, authStore.get);
  if (s.bridged) return s.bridged;
  return s.load && s.hint ? guestLoading : s.wantLogin ? guestLoading : guestIdle;
}
/** Suscripción a UN campo primitivo (evita re-renders y bucles con el puente de Cavos). */
export const useAuthFlag = (k: 'load' | 'wantLogin' | 'hint') => useSyncExternalStore(authStore.subscribe, () => authStore.get()[k], () => false);
