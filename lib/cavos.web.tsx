// Web (Safari / PWA): SDK web de Cavos. Las llaves viven en el vault de Cavos (iframe).
import { CavosProvider, useCavos } from '@cavos/kit/react';
import { useEffect, useState, type ReactNode } from 'react';
import { APP_SALT, CAVOS_APP_ID } from './config';
import type { MeteoritoAuth } from './types';
import { Brand } from '@/constants/Colors';

export function CavosRoot({ children }: { children: ReactNode }) {
  // El SDK usa window/localStorage: no se monta durante el render estático.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <CavosProvider
      config={{ appId: CAVOS_APP_ID, chain: 'stellar', network: 'testnet', appSalt: APP_SALT, persistSession: true }}
      modal={{ appName: 'Meteorito', providers: ['google', 'apple', 'email'], emailMode: 'otp', primaryColor: Brand.purple }}>
      {children}
    </CavosProvider>
  );
}


function b64(u: Uint8Array) { let s = ''; u.forEach((b) => (s += String.fromCharCode(b))); return btoa(s); }
function stellarWallet(c: any): any {
  const w = c.session?.wallet ? c.session.wallet('stellar') : c.session;
  if (!w) throw new Error('Wallet Cavos no lista');
  return w;
}

export function useAuth(): MeteoritoAuth {
  const c = useCavos();
  return {
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
  };
}
