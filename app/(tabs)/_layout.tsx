import { Tabs } from 'expo-router';
import { TabBar } from '@/components/TabBar';

// 3 pestañas: Vender (la de entrada), Comprar, Home (ruta /pedidos). "/" redirige a /vender (app/index.tsx).
export const unstable_settings = { initialRouteName: 'vender' };

export default function TabLayout() {
  return (
    <Tabs tabBar={(p) => <TabBar {...p} />} screenOptions={{
      headerShown: false,
      // Las pantallas son transparentes (el universo animado se ve detrás), así que las pestañas inactivas
      // se ocultan con opacidad (fundido corto, solo opacity): nada se ve por debajo.
      animation: 'fade', transitionSpec: { animation: 'timing', config: { duration: 140 } },
    }}>
      <Tabs.Screen name="vender" options={{ title: 'Vender' }} />
      <Tabs.Screen name="comprar" options={{ title: 'Comprar' }} />
      <Tabs.Screen name="pedidos" options={{ title: 'Home' }} />
    </Tabs>
  );
}
