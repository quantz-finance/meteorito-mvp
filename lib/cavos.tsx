// iOS / Android: SDK nativo de Cavos (requiere development build, no Expo Go).
import './polyfills'; // antes de @cavos/kit
import 'react-native-get-random-values';
import { CavosProvider, useCavos } from '@cavos/kit/react-native';
import type { ReactNode } from 'react';
import { APP_SALT, CAVOS_APP_ID, CAVOS_RP_ID, NATIVE_REDIRECT_URI } from './config';
import type { MeteoritoAuth } from './types';
import { Brand } from '@/constants/Colors';

export function CavosRoot({ children }: { children: ReactNode }) {
  return (
    <CavosProvider
      config={{
        appId: CAVOS_APP_ID,
        chain: 'stellar',
        network: 'testnet',
        appSalt: APP_SALT,
        redirectUri: NATIVE_REDIRECT_URI,
        rpId: CAVOS_RP_ID,
      }}
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
    getAuthToken: () => null /* TODO nativo: el kit RN guarda el token en memoria; exponerlo */,
    signMessage: async (m) => { const r = await stellarWallet(c).signMessage(m); return { publicKey: r.publicKey, signature: b64(r.signature) }; },
    signXdr: (x) => stellarWallet(c).signXdr(x),
  };
}
