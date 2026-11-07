// Proveedor Cavos SOLO del build E2E (resolver opt-in de Metro); sin secretos, SDK ni red real.
// Gate, Welcome, pruebas de dirección y transporte API son los de producción.
import { useEffect } from 'react';
import { authStore } from '../../lib/authStore';
import type { MeteoritoAuth } from '../../lib/types';
const KEY = 'cavos:e2e:session';
const ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
function publish() {
  const sub = localStorage.getItem(KEY);
  const token = sub ? `${btoa('{"alg":"none"}')}.${btoa(JSON.stringify({ sub, iat: 1700000000, exp: Number(localStorage.getItem('cavos:e2e:exp') ?? 4102444800) }))}.e2e` : null;
  const auth: MeteoritoAuth = {
    configured: true, isAuthenticated: !!sub, isLoading: false, address: sub ? ADDRESS : null, email: sub ? 'comprador@e2e.invalid' : null, error: null,
    openLogin: () => { localStorage.setItem(KEY, crypto.randomUUID()); authStore.consumeLogin(); publish(); },
    logout: () => { localStorage.removeItem(KEY); publish(); }, getAuthToken: () => token,
    signMessage: async () => ({ publicKey: ADDRESS, signature: 'Zml4dHVyZS1lMmU=' }), signXdr: async (x) => x,
    wallet: { state: 'ready', recoveryProtected: true, hasPasskey: true, approveDevice: async () => {}, enrollPasskey: async () => {} },
  };
  authStore.setBridged(auth);
  requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.cavosE2eReady = sub ? '1' : '0'; }));
  if (authStore.get().wantLogin) auth.openLogin();
}
export default function MockCavosBridge() {
  useEffect(() => { publish(); return () => authStore.setBridged(null); }, []);
  return null;
}
