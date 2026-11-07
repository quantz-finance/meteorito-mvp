import { Tabs } from 'expo-router';
import { TabBar } from '@/components/TabBar';
import { useIsGuest } from '@/components/ComprarNav';

// 3 pestañas: Comprar (la de entrada), Vender, Home (ruta /pedidos). "/" redirige a /comprar (app/index.tsx).
export const unstable_settings = { initialRouteName: 'comprar' };

// Sin cuenta (comprador invitado) solo se llega aquí a la pestaña Comprar (lib/publicRoutes.ts): sin barra de pestañas,
// porque Vender y Home piden entrar. La salida es "Volver" arriba (ComprarScreen) y los 3 iconos de Comprar.
export default function TabLayout() {
  const guest = useIsGuest();
  return (
    <Tabs tabBar={(p) => (guest ? null : <TabBar {...p} />)} screenOptions={{
      headerShown: false,
      // Las pantallas son transparentes (el universo animado se ve detrás), así que las pestañas inactivas
      // se ocultan con opacidad (fundido corto, solo opacity): nada se ve por debajo.
      animation: 'fade', transitionSpec: { animation: 'timing', config: { duration: 140 } },
    }}>
      <Tabs.Screen name="comprar" options={{ title: 'Comprar' }} />
      <Tabs.Screen name="vender" options={{ title: 'Vender' }} />
      {/* Home (/pedidos: ventas, compras y Mi cuenta) sin pestaña: dos secciones, Comprar y Vender. Se abre desde Vender. */}
      <Tabs.Screen name="pedidos" options={{ title: 'Home', href: null }} />
    </Tabs>
  );
}
