import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { Fonts } from '@/constants/Colors';
import { C } from '@/constants/theme';
import { haptic } from '@/components/ds';

type Name = React.ComponentProps<typeof Ionicons>['name'];
const icon = (on: Name, off: Name) => ({ color, focused }: { color: import("react-native").ColorValue; focused: boolean }) =>
  <Ionicons name={focused ? on : off} size={26} color={color as string} />;

export default function TabLayout() {
  return (
    <Tabs
      screenListeners={{ tabPress: () => haptic.tap() }}
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: C.surface, borderTopColor: C.line },
        tabBarActiveTintColor: C.white,
        tabBarInactiveTintColor: C.textDim,
        tabBarLabelStyle: { fontFamily: Fonts.bold, fontSize: 11 },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Inicio', tabBarIcon: icon('home', 'home-outline') }} />
      <Tabs.Screen name="vender" options={{ title: 'Vender', tabBarIcon: icon('pricetag', 'pricetag-outline') }} />
      <Tabs.Screen name="pedidos" options={{ title: 'Pedidos', tabBarIcon: icon('cube', 'cube-outline') }} />
      <Tabs.Screen name="comprar" options={{ title: 'Comprar', tabBarIcon: icon('bag-handle', 'bag-handle-outline') }} />
    </Tabs>
  );
}
