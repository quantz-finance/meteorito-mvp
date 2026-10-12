// iOS / Android: SDK nativo de Cavos (requiere development build, no Expo Go).
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
  };
}
