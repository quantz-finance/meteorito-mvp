import { Tabs } from 'expo-router';
import { TabBar } from '@/components/TabBar';

// 3 pestañas: Vender (la de entrada), Comprar, Pedidos. "/" redirige a /vender (app/index.tsx).
export const unstable_settings = { initialRouteName: 'vender' };

export default function TabLayout() {
  return (
    <Tabs tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="vender" options={{ title: 'Vender' }} />
      <Tabs.Screen name="comprar" options={{ title: 'Comprar' }} />
      <Tabs.Screen name="pedidos" options={{ title: 'Pedidos' }} />
    </Tabs>
  );
}
