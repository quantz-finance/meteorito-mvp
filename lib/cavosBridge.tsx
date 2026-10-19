// Chunk perezoso (web): proveedor Cavos + puente hacia authStore. Aquí viven @cavos/kit, starknet, solana, iconos, etc.
import '@/lib/polyfills'; // antes de @cavos/kit
import { CavosProvider, useCavos } from '@cavos/kit/react';
import { useEffect } from 'react';
import { CAVOS_SECURE_STEP, CAVOS_SOCIAL_RECOVERY, APP_SALT, CAVOS_APP_ID } from './config';
import { authStore, useAuthLoadState } from './authStore';
import { walletInfo, type MeteoritoAuth } from './types';
import { Brand } from '@/constants/Colors';

function b64(u: Uint8Array) { let s = ''; u.forEach((b) => (s += String.fromCharCode(b))); return btoa(s); }
function stellarWallet(c: any): any {
  const w = c.session?.wallet ? c.session.wallet('stellar') : c.session;
  if (!w) throw new Error('Wallet Cavos no lista');
  return w;
}

function Bridge() {
  const c = useCavos();
  const { wantLogin } = useAuthLoadState();
  const auth: MeteoritoAuth = {
    configured: !!CAVOS_APP_ID,
    isAuthenticated: c.isAuthenticated,
    isLoading: c.isLoading,
    email: c.user?.email ?? null,
    address: c.address,
    error: c.authError,
    openLogin: () => { c.clearAuthError(); c.openModal(); },
    logout: () => c.logout(),
    getAuthToken: () => { try { return window.sessionStorage.getItem(`cavos-kit:token:${CAVOS_APP_ID}`); } catch { return null; } },
    signMessage: async (m) => { const r = await stellarWallet(c).signMessage(m); return { publicKey: r.publicKey, signature: b64(r.signature) }; },
    signXdr: (x) => stellarWallet(c).signXdr(x),
    wallet: walletInfo(c),
  };
  // Publicar a la app en cada render del SDK (los suscriptores no re-renderizan a Bridge: sin bucle).
  useEffect(() => { authStore.setBridged(auth); });
  useEffect(() => () => authStore.setBridged(null), []);
  // El usuario tocó "Entrar" antes de que el SDK cargara: abrir el modal ahora.
  useEffect(() => {
    if (!wantLogin || c.isLoading) return;
    authStore.consumeLogin();
    if (!c.isAuthenticated) { c.clearAuthError(); c.openModal(); }
  }, [wantLogin, c.isLoading, c.isAuthenticated]);
  return null;
}

export default function CavosBridge() {
  return (
    <CavosProvider
      config={{ appId: CAVOS_APP_ID, chain: 'stellar', network: 'testnet', appSalt: APP_SALT, persistSession: true, socialRecovery: CAVOS_SOCIAL_RECOVERY }}
      modal={{ appName: 'Meteorito', providers: ['google', 'apple', 'email'], emailMode: 'otp', primaryColor: Brand.purple, secureStep: CAVOS_SECURE_STEP }}>
      <Bridge />
    </CavosProvider>
  );
}
