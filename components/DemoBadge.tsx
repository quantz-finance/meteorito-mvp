// Distintivo discreto "Demo" + selector Vendedor/Comprador. Solo existe con EXPO_PUBLIC_DEMO_MODE.
// Se oculta con ?badge=0 (y vuelve con ?badge=1); el rol también se puede fijar con ?role=seller|buyer.
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { C } from '@/constants/theme';
import { DEMO_ENABLED, demoLastSlug, setDemoRole, useDemoState, type DemoRole } from '@/lib/demo';

export function DemoBadge() {
  if (!DEMO_ENABLED) return null;
  return <DemoBadgeInner />;
}

function DemoBadgeInner() {
  const { role, badge } = useDemoState();
  if (!badge) return null;
  const pick = (r: DemoRole) => {
    if (r === role) return;
    setDemoRole(r);
    if (r === 'buyer') { const slug = demoLastSlug(); router.replace(slug ? { pathname: '/p/[slug]', params: { slug } } : '/comprar'); }
    else router.replace('/pedidos');
  };
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: 6, left: 0, right: 0, alignItems: 'center', zIndex: 9999 }}>
      <View testID="demo-badge" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(20,10,45,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
        <Text style={{ color: C.textDim, fontSize: 11 }}>Demo</Text>
        {(['seller', 'buyer'] as DemoRole[]).map((r) => (
          <Pressable key={r} accessibilityRole="button" accessibilityLabel={r === 'seller' ? 'Vista vendedor' : 'Vista comprador'} onPress={() => pick(r)}>
            <Text style={{ fontSize: 11, color: role === r ? C.lilac : C.textDim, fontWeight: role === r ? '700' : '400' }}>{r === 'seller' ? 'Vendedor' : 'Comprador'}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
