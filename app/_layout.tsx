// Primero: Buffer global para el SDK Cavos/Stellar (web).
import '@/lib/polyfills';

import { Nunito_400Regular, Nunito_700Bold, Nunito_900Black, useFonts } from '@expo-google-fonts/nunito';
import { ToastHost } from '@/components/ds';
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

/** Quita el splash HTML inline (app/+html.tsx) cuando la app ya pintó. */
function hideBootSplash() {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('boot-splash');
  if (!el) return;
  el.style.opacity = '0';
  setTimeout(() => el.remove(), 250);
}

export { ErrorBoundary } from 'expo-router';
export const unstable_settings = { initialRouteName: '(tabs)' };

initAnalytics();
// Nombres de pantalla sin slugs ni datos.
const screenName = (p: string) => p.replace(/^\/p\/[^/]+/, '/p/:slug').replace(/^\/compartir\/[^/]+/, '/compartir/:slug').replace(/^\/i\/(?!nueva$)[^/]+/, '/i/:code') || '/';

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: Brand.purpleDark, card: Brand.purpleMid, primary: Brand.lilac, text: Brand.white, border: Brand.purpleMid },
};

export default function RootLayout() {
  // Las fuentes NO bloquean el primer render: se pinta con la tipografía del sistema y se cambia a Nunito al llegar (swap).
  const [, error] = useFonts({ Nunito_400Regular, Nunito_700Bold, Nunito_900Black });
  useEffect(() => { if (error) console.error('[fonts]', error); }, [error]);
  useEffect(() => { SplashScreen.hideAsync(); hideBootSplash(); }, []);
  return (
    <ThemeProvider value={theme}>
      <StatusBar style="light" />
      <CavosRoot>
        <Gate />
      </CavosRoot>
      <ToastHost />
    </ThemeProvider>
  );
}

function Gate() {
  const auth = useAuth();
  const segments = useSegments();
  const pathname = usePathname();
  const isPublic = segments[0] === 'p' || segments[0] === 't' || segments[0] === 'i' || segments[0] === 'legal'; // link de pago, tienda, invitaciones de compra y legales: visibles sin login
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
      <Stack.Screen name="t/[store]" />
      <Stack.Screen name="mi-tienda" />
      <Stack.Screen name="i/nueva" />
      <Stack.Screen name="i/[code]" />
      <Stack.Screen name="compartir/[slug]" options={{ presentation: 'modal' }} />
      <Stack.Screen name="legal/[doc]" />
    </Stack>
    <DemoBadge />
    </>
  );
}
