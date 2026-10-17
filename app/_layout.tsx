// Primero: Buffer global para el SDK Cavos/Stellar (web).
import '@/lib/polyfills';

import { Nunito_400Regular, Nunito_700Bold, Nunito_900Black, useFonts } from '@expo-google-fonts/nunito';
import { DarkTheme, Stack, ThemeProvider, usePathname, useSegments } from 'expo-router';
import { identify, initAnalytics, resetAnalytics, screen, track } from '@/lib/analytics';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { CavosRoot, useAuth } from '@/lib/cavos';
import { bindWalletOnLogin } from '@/lib/wallet';
import { setReloginHandler } from '@/lib/api';
import { DemoBadge } from '@/components/DemoBadge';
import Welcome from '@/components/Welcome';
import { Brand } from '@/constants/Colors';

export { ErrorBoundary } from 'expo-router';
export const unstable_settings = { initialRouteName: '(tabs)' };

SplashScreen.preventAutoHideAsync();
initAnalytics();
// Nombres de pantalla sin slugs ni datos.
const screenName = (p: string) => p.replace(/^\/p\/[^/]+/, '/p/:slug').replace(/^\/compartir\/[^/]+/, '/compartir/:slug') || '/';

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: Brand.purpleDark, card: Brand.purpleMid, primary: Brand.lilac, text: Brand.white, border: Brand.purpleMid },
};

export default function RootLayout() {
  const [loaded, error] = useFonts({ Nunito_400Regular, Nunito_700Bold, Nunito_900Black });
  useEffect(() => { if (error) throw error; }, [error]);
  useEffect(() => { if (loaded) SplashScreen.hideAsync(); }, [loaded]);
  if (!loaded) return null;
  return (
    <ThemeProvider value={theme}>
      <StatusBar style="light" />
      <CavosRoot>
        <Gate />
      </CavosRoot>
    </ThemeProvider>
  );
}

function Gate() {
  const auth = useAuth();
  const segments = useSegments();
  const pathname = usePathname();
  const isPublic = segments[0] === 'p' || segments[0] === 'legal'; // link de venta y legales: visibles sin login
  const authed = auth.isAuthenticated && !!auth.address;
  useEffect(() => { screen(authed || isPublic ? screenName(pathname) : 'welcome'); }, [pathname, authed]);
  useEffect(() => {
    if (authed) identify(auth.getAuthToken()).then(() => track('signed_in'));
    else resetAnalytics();
  }, [authed]);
  // Liga sub -> wallet con cada token Cavos fresco nuevo (primer login y re-login; vencido = se omite).
  const tok = authed ? auth.getAuthToken() : null;
  useEffect(() => { if (authed) bindWalletOnLogin(auth); }, [authed, auth.wallet.state, tok]);
  // session_relogin_required: abrir el login de Cavos SIN logout (la llave se queda en este dispositivo).
  useEffect(() => { setReloginHandler((a) => a.openLogin()); return () => setReloginHandler(null); }, []);
  if (!isPublic && (!auth.isAuthenticated || !auth.address)) return <Welcome />;
  return (
    <>
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="p/[slug]" />
      <Stack.Screen name="compartir/[slug]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="legal/[doc]" />
    </Stack>
    <DemoBadge />
    </>
  );
}
