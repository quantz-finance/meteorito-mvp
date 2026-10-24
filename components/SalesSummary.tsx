// "Tus ventas": 3 contadores compactos, sin saldo (los cobros van al banco o SINPE), con el meteorito asomándose
// a la derecha (flota suave; decorativo, no ocupa alto: el card no crece y los pedidos no se van a la página 2).
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { haptic, Icon, Skeleton } from '@/components/ds';
import { LivelyMascot } from '@/components/space';
import { anim } from '@/constants/motion';
import { C, R, S, T } from '@/constants/theme';
import type { SellerOrder } from '@/lib/orders';

const IN_PROGRESS = ['escrow_creado', 'fondeado', 'enviado', 'en_disputa'];
const DELIVERED = ['entregado', 'liberado', 'resuelto'];

export function SalesSummary({ orders, compact, onHistory }: { orders: SellerOrder[] | null; compact?: boolean; onHistory?: () => void }) {
  const count = (sts: string[]) => (orders ?? []).filter((o) => sts.includes(o.status)).length;
  const stats = [
    { label: 'Publicados', n: count(['creado']) },
    { label: 'En curso', n: count(IN_PROGRESS) },
    { label: 'Entregados', n: count(DELIVERED) },
  ];
  const m = compact ? 60 : 74; // ancho de la mascota
  return (
    <View style={[s.box, compact && { paddingVertical: S.sm }, { paddingRight: m - 2 }]} accessibilityLabel="Tus ventas">
      <View pointerEvents="none" testID="ventas-mascot" {...anim('bob')} style={[s.mascot, { width: m, top: compact ? -2 : 0 }]}>
        <LivelyMascot size={m} parallax={0} />
      </View>
      <View style={s.head}>
        <Text style={[T.caption, { color: C.lilac }]}>Tus ventas</Text>
        {compact ? null : <Text style={[T.footnote, { color: C.lilac, flexShrink: 1 }]} numberOfLines={1}>Cobras en tu banco o SINPE</Text>}
        {onHistory ? <Pressable onPress={() => { haptic.tap(); onHistory(); }} accessibilityRole="button" accessibilityLabel="Ver historial de ventas" hitSlop={12}
          style={({ pressed }) => [s.hist, pressed && { opacity: 0.7 }]}>
          <Text style={[T.footnote, { color: C.lilac, fontFamily: T.headline.fontFamily }]}>Historial</Text>
          <Icon name="chevron-forward" size={14} color={C.lilac} />
        </Pressable> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        {stats.map((st) => (
          <View key={st.label} style={s.stat} accessibilityLabel={`${st.label}: ${st.n}`}>
            {orders === null ? <Skeleton w={24} h={24} /> : <Text style={s.n}>{st.n}</Text>}
            <Text style={T.footnote} numberOfLines={1}>{st.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  hist: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 'auto', zIndex: 2 },
  box: { overflow: 'hidden', backgroundColor: C.purple, borderWidth: 1, borderColor: 'rgba(255,138,61,0.35)', borderRadius: R.lg, paddingHorizontal: S.md, paddingVertical: S.sm + 4, gap: 4 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: S.sm },
  stat: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  mascot: { position: 'absolute', right: 2 },
  n: { ...T.title, fontSize: 22, lineHeight: 26, fontVariant: ['tabular-nums'] },
});
