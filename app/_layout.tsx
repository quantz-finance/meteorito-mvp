// Primero: Buffer global para el SDK Cavos/Stellar (web).
import '@/lib/polyfills';

import * as Font from 'expo-font';
import { toast, ToastHost } from '@/components/ds';
import { consumeUpdatedFlag, startUpdater } from '@/lib/updater';
import { installViewport } from '@/lib/viewport';
import { DarkTheme, Stack, ThemeProvider, usePathname, useSegments } from 'expo-router';
import { identify, initAnalytics, resetAnalytics, screen, track } from '@/lib/analytics';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';

import { CavosRoot, useAuth } from '@/lib/cavos';
import { hasCavosTrace } from '@/lib/authStore';
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
  el.classList.add('bs-out');
  setTimeout(() => el.remove(), 380);
}

export { ErrorBoundary } from 'expo-router';
export const unstable_settings = { initialRouteName: '(tabs)' };

initAnalytics();
// Fuentes web livianas (woff2 con subset, scripts/build/subset-fonts.py) con font-display: swap: se pinta con la del sistema
// y cambia a Nunito al llegar. Mismo nombre de familia que usan los estilos. "ionicons" se registra antes del primer
// <Icon> para que @expo/vector-icons reutilice esta carga (11 KB) en vez de bajar el TTF completo (380 KB).
const woff = (m: number) => ({ uri: m, display: Font.FontDisplay.SWAP });
const FONTS = {
  Nunito_400Regular: woff(require('../assets/fonts/nunito-400.woff2')),
  Nunito_700Bold: woff(require('../assets/fonts/nunito-700.woff2')),
  Nunito_900Black: woff(require('../assets/fonts/nunito-900.woff2')),
};
if (Platform.OS === 'web' && typeof document !== 'undefined') Font.loadAsync({ ionicons: woff(require('../assets/fonts/ionicons-app.woff2')) }).catch(() => {});
// Nombres de pantalla sin slugs ni datos.
const screenName = (p: string) => p.replace(/^\/p\/[^/]+/, '/p/:slug').replace(/^\/compartir\/[^/]+/, '/compartir/:slug').replace(/^\/i\/(?!nueva$)[^/]+/, '/i/:code') || '/';

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: Brand.purpleDark, card: Brand.purpleMid, primary: Brand.lilac, text: Brand.white, border: Brand.purpleMid },
};

export default function RootLayout() {
  // Las fuentes NO bloquean el primer render: se pinta con la tipografía del sistema y se cambia a Nunito al llegar (swap).
  const [, error] = Font.useFonts(Platform.OS === 'web' ? FONTS : { Nunito_400Regular: require('@expo-google-fonts/nunito/400Regular/Nunito_400Regular.ttf'), Nunito_700Bold: require('@expo-google-fonts/nunito/700Bold/Nunito_700Bold.ttf'), Nunito_900Black: require('@expo-google-fonts/nunito/900Black/Nunito_900Black.ttf') });
  useEffect(() => { if (error) console.error('[fonts]', error); }, [error]);
  useEffect(() => {
    SplashScreen.hideAsync();
    if (Platform.OS !== 'web') return;
    startUpdater(); // PWA: se actualiza sola en un momento seguro
    installViewport(); // alto estable: el teclado de iPhone no comprime ni mueve la pantalla
    if (consumeUpdatedFlag()) setTimeout(() => toast('Actualizado', 'info'), 600);
  }, []);
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
  // Con sesión previa en este dispositivo, el splash (mascota) sigue hasta que Cavos termina de cargar la cuenta:
  // así no parpadea la bienvenida antes de entrar. Sin sesión, o en links públicos, se quita al primer render.
  const [trace] = useState(() => Platform.OS === 'web' && !isPublic && hasCavosTrace());
  const loading = auth.isLoading || (auth.isAuthenticated && !auth.address);
  const [started, setStarted] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => { if (loading) setStarted(true); }, [loading]);
  useEffect(() => { if (!trace) return; const id = setTimeout(() => setTimedOut(true), 12000); return () => clearTimeout(id); }, [trace]);
  const waitingCavos = trace && !authed && !isPublic && (!started || loading) && !timedOut;
  useEffect(() => { if (!waitingCavos) hideBootSplash(); }, [waitingCavos]);
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
