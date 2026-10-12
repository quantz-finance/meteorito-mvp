import { Buffer } from 'buffer';
// web: el SDK Cavos/Stellar usa Buffer en signMessage (evita "Buffer is not defined").
(globalThis as any).Buffer = Buffer;

import { Nunito_400Regular, Nunito_700Bold, Nunito_900Black, useFonts } from '@expo-google-fonts/nunito';
import { DarkTheme, Stack, ThemeProvider, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { CavosRoot, useAuth } from '@/lib/cavos';
import Welcome from '@/components/Welcome';
import { Brand } from '@/constants/Colors';

export { ErrorBoundary } from 'expo-router';
export const unstable_settings = { initialRouteName: '(tabs)' };

SplashScreen.preventAutoHideAsync();

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
  const isPublic = segments[0] === 'p'; // link de venta: visible sin login
  if (!isPublic && (!auth.isAuthenticated || !auth.address)) return <Welcome />;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="p/[slug]" />
      <Stack.Screen name="compartir/[slug]" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
