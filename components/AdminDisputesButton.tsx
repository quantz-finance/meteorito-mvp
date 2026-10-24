// Entrada al panel de disputas en el encabezado de Home (sin pestaña nueva). SOLO aparece si el servidor confirma que la
// sesión es de un admin (ADMIN_EMAILS); el panel vuelve a verificarlo en cada llamada.
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { haptic, Icon } from '@/components/ds';
import { pressTransition } from '@/constants/motion';
import { C, TOUCH } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { useIsAdmin } from '@/lib/admin';

export function AdminDisputesButton() {
  const auth = useAuth();
  const admin = useIsAdmin(auth);
  if (admin !== true) return null;
  return (
    <Pressable testID="admin-disputes" accessibilityRole="button" accessibilityLabel="Disputas" hitSlop={8}
      onPress={() => { haptic.tap(); router.push('/admin/disputas' as never); }}
      style={({ pressed }) => [s.btn, pressTransition, pressed && { opacity: 0.7, transform: [{ scale: 0.96 }] }]}>
      <Icon name="hammer-outline" size={22} color={C.lilac} />
    </Pressable>
  );
}
const s = StyleSheet.create({ btn: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: 'center', justifyContent: 'center' } });
