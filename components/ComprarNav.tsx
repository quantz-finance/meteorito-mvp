// Comprar tiene 3 pantallas (cada una con su link): Feed (/comprar, por defecto), Pagar con link (/comprar/link) y
// Mis compras (/comprar/compras). Se cambian con 3 iconos arriba a la derecha, del mismo tamaño, con estado activo claro.
// Cuarto icono: la lupa (acción, no pantalla) abre el buscador en un modalcito (components/SearchSheet); desde Pagar con
// link o Mis compras lleva al feed con la hoja abierta. Con búsqueda activa, un punto en la lupa.
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { haptic, Icon } from '@/components/ds';
import { C } from '@/constants/theme';
import { COMPRAR_VIEWS, type ComprarView } from '@/lib/comprarViews';
import { Dot, useBuyerUnread } from '@/components/ChatInbox';
import { openSearch, SEARCH_COPY, useFeedSearch } from '@/lib/feedSearch';

export type { ComprarView } from '@/lib/comprarViews';

export { useIsGuest } from '@/lib/useIsGuest';
/** Volver para el comprador invitado en las pantallas de Comprar (sin barra de pestañas): regresa a la bienvenida. */
export const GUEST_BACK = '/' as const;

export function ComprarNav({ active }: { active: ComprarView }) {
  const unread = useBuyerUnread(); // mensajes sin leer del comprador: punto en Mis compras
  const search = useFeedSearch();
  return (
    <View style={s.row}>
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
      <Pressable accessibilityRole="button" accessibilityLabel={SEARCH_COPY.open} hitSlop={4} testID="comprar-search"
        onPress={() => { haptic.tap(); openSearch(); if (active !== 'feed') router.replace('/comprar'); }}
        style={({ pressed }) => [s.btn, pressed && { opacity: 0.7 }]}>
        <Icon name="search" size={22} color={C.lilac} />
        {search.active ? <Dot testID="search-active" /> : null}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4 }, // 4 iconos de 44 caben en iPhone SE junto al título
  btn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: C.lilacBg },
  on: { backgroundColor: C.lilac },
});
