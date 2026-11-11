// iOS / Android: SDK nativo de Cavos (requiere development build, no Expo Go).
import './polyfills'; // antes de @cavos/kit
import { clearNativeAuthToken, nativeAuthToken } from './nativeFetch'; // fetch('/api/...') -> API absoluta + token del login
import 'react-native-get-random-values';
import { CavosProvider, useCavos } from '@cavos/kit/react-native';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { APP_SALT, CAVOS_APP_ID, CAVOS_RP_ID, NATIVE_REDIRECT_URI } from './config';
import { DEMO_ENABLED, useDemoAuth } from './demo';
import { walletInfo, type MeteoritoAuth } from './types';
import { Brand } from '@/constants/Colors';

export function CavosRoot({ children }: { children: ReactNode }) {
  if (DEMO_ENABLED) return <>{children}</>; // demo: sin proveedor Cavos
  // Sin appId el kit nativo revienta al montar (NativeCavosAuthError: appId is required): mejor un aviso claro.
  if (!CAVOS_APP_ID) return <MissingConfig />;
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
      modal={{ appName: 'Meteorito', providers: ['google', 'apple', 'email'], primaryColor: Brand.purple, secureStep: 'required' /* RN: sin enclave; passkey es el único respaldo (socialRecovery solo en web) */ }}>
      {children}
    </CavosProvider>
  );
}

function MissingConfig() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: Brand.purpleDark }}>
      <Text style={{ color: Brand.white, fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 8 }}>Falta configurar la app</Text>
      <Text style={{ color: Brand.white, opacity: 0.8, textAlign: 'center' }}>
        Crea un archivo .env en la raíz del proyecto con EXPO_PUBLIC_CAVOS_APP_ID (y las demás variables EXPO_PUBLIC_*) y vuelve a correr npx expo run:ios.
      </Text>
    </View>
  );
}

function b64(u: Uint8Array) { let s = ''; u.forEach((b) => (s += String.fromCharCode(b))); return btoa(s); }
function stellarWallet(c: any): any {
  // Kit RN 0.3.0: la wallet tipada está en c.wallet (c.session es del kit web).
  const s = c.wallet ?? c.session;
  const w = s?.wallet ? s.wallet('stellar') : s;
  if (!w) throw new Error('Wallet Cavos no lista');
  return w;
}

/** Modo demo (build con EXPO_PUBLIC_DEMO_MODE): sesión simulada, sin Cavos. DEMO_ENABLED es constante en el build, el orden de hooks no cambia. */
export function useAuth(): MeteoritoAuth {
  return DEMO_ENABLED ? useDemoAuth() : useCavosAuth();
}

function useCavosAuth(): MeteoritoAuth {
  const c = useCavos();
  return {
    configured: !!CAVOS_APP_ID,
    isAuthenticated: c.isAuthenticated,
    isLoading: c.isLoading,
    email: c.user?.email ?? null,
    address: c.address,
    error: c.authError,
    openLogin: () => { c.clearAuthError(); c.openModal(); },
    logout: () => { clearNativeAuthToken(); return c.logout(); },
    // El kit RN no expone el id_token: lib/nativeFetch.ts lo toma de la respuesta del login (solo en memoria).
    getAuthToken: () => (c.isAuthenticated ? nativeAuthToken() : null),
    signMessage: async (m) => { const r = await stellarWallet(c).signMessage(m); return { publicKey: r.publicKey, signature: b64(r.signature) }; },
    signXdr: (x) => stellarWallet(c).signXdr(x),
    // Kit RN: walletStatus no trae isUndeployed; se deriva de wallet.status para que el bind/activación sigan igual que en web.
    wallet: walletInfo({ ...c, walletStatus: { ...c.walletStatus, isUndeployed: c.wallet?.status === 'undeployed' } }),
  };
}
