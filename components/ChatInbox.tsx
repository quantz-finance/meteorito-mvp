// Entradas a la bandeja de mensajes, sin pestaña nueva. Vendedor: botón con insignia en el encabezado de Home.
// Comprador: fila "Tus mensajes" en Mis compras y un punto en el icono de Mis compras (ComprarNav).
// Sin la migración 025 (chat no disponible) no se muestra nada.
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, haptic, Icon } from '@/components/ds';
import { pressTransition } from '@/constants/motion';
import { Fonts } from '@/constants/Colors';
import { C, S, T, TOUCH } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { chatTotal, useChatAvailable, useChatUnread, type ChatRole } from '@/lib/chat';
import { COPY } from '@/lib/copy';

export const inboxHref = (as: ChatRole) => `/mensajes?as=${as === 'seller' ? 's' : 'b'}` as const;

/** Número rojo-naranja sobre un icono (9+ como máximo). */
export function Badge({ n, testID }: { n: number; testID?: string }) {
  if (n <= 0) return null;
  return <View testID={testID} style={s.badge} pointerEvents="none"><Text style={s.badgeText}>{n > 9 ? '9+' : n}</Text></View>;
}
/** Punto pequeño (sin número) para iconos compactos. */
export function Dot({ testID }: { testID?: string }) {
  return <View testID={testID} style={s.dot} pointerEvents="none" />;
}

/** Vendedor: botón "Mensajes" con insignia en el encabezado de Home. */
export function SellerInboxButton() {
  const auth = useAuth();
  const available = useChatAvailable();
  const n = useChatUnread(auth, 'seller', available && auth.isAuthenticated);
  if (!available) return null;
  const label = n ? `${COPY.chat.title}, ${COPY.chat.unreadA11y(n)}` : COPY.chat.title;
  return (
    <Pressable testID="seller-inbox" accessibilityRole="button" accessibilityLabel={label} hitSlop={8}
      onPress={() => { haptic.tap(); router.push(inboxHref('seller') as never); }}
      style={({ pressed }) => [s.iconBtn, pressTransition, pressed && { opacity: 0.7, transform: [{ scale: 0.96 }] }]}>
      <Icon name="chatbubbles-outline" size={22} color={C.lilac} />
      <Badge n={n} testID="seller-inbox-badge" />
    </Pressable>
  );
}

/** Comprador: fila en Mis compras. Se muestra si este dispositivo ya tiene conversaciones. */
export function BuyerInboxRow() {
  const auth = useAuth();
  const available = useChatAvailable();
  const n = useChatUnread(auth, 'buyer', available);
  const total = chatTotal('buyer');
  if (!available || total === 0) return null;
  return (
    <Card testID="buyer-inbox" accessibilityLabel={n ? `${COPY.chat.inboxBuyer}, ${COPY.chat.unreadA11y(n)}` : COPY.chat.inboxBuyer}
      onPress={() => { haptic.tap(); router.push(inboxHref('buyer') as never); }} style={{ paddingVertical: S.sm + 2, paddingHorizontal: S.sm + 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm + 4 }}>
        <View style={s.rowIcon}><Icon name="chatbubbles-outline" size={20} color={C.purpleDark} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={T.headline} numberOfLines={1}>{COPY.chat.inboxBuyer}</Text>
          <Text style={T.footnote} numberOfLines={1}>{n ? COPY.chat.unreadA11y(n) : `${total} ${total === 1 ? 'conversación' : 'conversaciones'}`}</Text>
        </View>
        {n ? <View testID="buyer-inbox-badge" style={[s.badge, s.badgeInline]}><Text style={s.badgeText}>{n > 9 ? '9+' : n}</Text></View> : null}
        <Icon name="chevron-forward" size={18} color={C.textDim} />
      </View>
    </Card>
  );
}

/** Comprador: ¿hay mensajes sin leer? (para el punto en el icono de Mis compras). */
export function useBuyerUnread(): number {
  const auth = useAuth();
  const available = useChatAvailable();
  return useChatUnread(auth, 'buyer', available);
}

const s = StyleSheet.create({
  iconBtn: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.bg },
  badgeInline: { position: 'relative', top: 0, right: 0, borderWidth: 0, minWidth: 22, height: 22, borderRadius: 11 },
  badgeText: { fontFamily: Fonts.black, fontSize: 11, lineHeight: 13, color: C.white, fontVariant: ['tabular-nums'] },
  dot: { position: 'absolute', top: 6, right: 6, width: 10, height: 10, borderRadius: 5, backgroundColor: C.orange, borderWidth: 2, borderColor: C.bg },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.lilac, alignItems: 'center', justifyContent: 'center' },
});
