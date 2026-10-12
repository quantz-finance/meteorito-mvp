import { SymbolView } from 'expo-symbols';
import { Tabs } from 'expo-router';
import { Brand, Fonts } from '@/constants/Colors';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';

type Sym = React.ComponentProps<typeof SymbolView>['name'];
const icon = (name: Sym) => ({ color }: { color: import('react-native').ColorValue }) => <SymbolView name={name} tintColor={color} size={26} />;

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: useClientOnlyValue(false, true),
        headerStyle: { backgroundColor: Brand.purpleDark },
        headerTitleStyle: { fontFamily: Fonts.black, color: Brand.white },
        tabBarStyle: { backgroundColor: Brand.purpleMid, borderTopColor: Brand.purpleMid },
        tabBarActiveTintColor: Brand.lilac,
        tabBarInactiveTintColor: Brand.muted,
        tabBarLabelStyle: { fontFamily: Fonts.bold },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Inicio', tabBarIcon: icon({ ios: 'house.fill', android: 'home', web: 'home' }) }} />
      <Tabs.Screen name="vender" options={{ title: 'Vender', tabBarIcon: icon({ ios: 'tag.fill', android: 'sell', web: 'sell' }) }} />
      <Tabs.Screen name="comprar" options={{ title: 'Comprar', tabBarIcon: icon({ ios: 'cart.fill', android: 'shopping_cart', web: 'shopping_cart' }) }} />
      <Tabs.Screen name="pedidos" options={{ title: 'Mis pedidos', tabBarIcon: icon({ ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' }) }} />
    </Tabs>
  );
}
