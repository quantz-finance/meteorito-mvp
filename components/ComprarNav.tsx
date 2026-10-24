// Comprar tiene 3 pantallas (cada una con su link): Feed (/comprar, por defecto), Pagar con link (/comprar/link) y
// Mis compras (/comprar/compras). Se cambian con 3 iconos arriba a la derecha, del mismo tamaño, con estado activo claro.
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { haptic, Icon } from '@/components/ds';
import { C } from '@/constants/theme';
import { COMPRAR_VIEWS, type ComprarView } from '@/lib/comprarViews';
import { Dot, useBuyerUnread } from '@/components/ChatInbox';
import { useAuth } from '@/lib/cavos';

export type { ComprarView } from '@/lib/comprarViews';

/** Sin sesión de vendedor (Cavos): comprador invitado, con su llave en este dispositivo. */
export function useIsGuest() {
  const auth = useAuth();
  return !(auth.isAuthenticated && auth.address);
}
/** Volver para el comprador invitado en las pantallas de Comprar (sin barra de pestañas): regresa a la bienvenida. */
export const GUEST_BACK = '/' as const;

export function ComprarNav({ active }: { active: ComprarView }) {
  const unread = useBuyerUnread(); // mensajes sin leer del comprador: punto en Mis compras
  return (
    <View accessibilityRole="tablist" style={s.row}>
      {COMPRAR_VIEWS.map((v) => {
        const on = v.key === active;
        return (
          <Pressable key={v.key} accessibilityRole="tab" accessibilityState={{ selected: on }} aria-selected={on} accessibilityLabel={v.label} hitSlop={4}
            onPress={() => { if (on) return; haptic.tap(); router.replace(v.href); }}
            style={({ pressed }) => [s.btn, on && s.on, pressed && !on && { opacity: 0.7 }]}>
            <Icon name={v.icon} size={22} color={on ? C.purpleDark : C.lilac} />
            {v.key === 'compras' && unread ? <Dot testID="compras-unread" /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  btn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: C.lilacBg },
  on: { backgroundColor: C.lilac },
});
