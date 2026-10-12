import { Tabs } from 'expo-router';
import { TabBar } from '@/components/TabBar';

export default function TabLayout() {
  return (
    <Tabs tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'Inicio' }} />
      <Tabs.Screen name="vender" options={{ title: 'Vender' }} />
      <Tabs.Screen name="pedidos" options={{ title: 'Pedidos' }} />
      <Tabs.Screen name="comprar" options={{ title: 'Comprar' }} />
    </Tabs>
  );
}
