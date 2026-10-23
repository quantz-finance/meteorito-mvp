// "Tus ventas" (antes en Inicio): 3 contadores compactos, sin saldo (los cobros van al banco o SINPE).
import { StyleSheet, Text, View } from 'react-native';
import { Skeleton } from '@/components/ds';
import { C, R, S, T } from '@/constants/theme';
import type { SellerOrder } from '@/lib/orders';

const IN_PROGRESS = ['escrow_creado', 'fondeado', 'enviado', 'en_disputa'];
const DELIVERED = ['entregado', 'liberado', 'resuelto'];

export function SalesSummary({ orders, compact }: { orders: SellerOrder[] | null; compact?: boolean }) {
  const count = (sts: string[]) => (orders ?? []).filter((o) => sts.includes(o.status)).length;
  const stats = [
    { label: 'Publicados', n: count(['creado']) },
    { label: 'En curso', n: count(IN_PROGRESS) },
    { label: 'Entregados', n: count(DELIVERED) },
  ];
  return (
    <View style={[s.box, compact && { paddingVertical: S.sm }]} accessibilityLabel="Tus ventas">
      <View style={s.head}>
        <Text style={[T.caption, { color: C.lilac }]}>Tus ventas</Text>
        {compact ? null : <Text style={[T.footnote, { color: C.lilac, flexShrink: 1 }]} numberOfLines={1}>Cobras en tu banco o SINPE</Text>}
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
  box: { backgroundColor: C.purple, borderWidth: 1, borderColor: 'rgba(255,138,61,0.35)', borderRadius: R.lg, paddingHorizontal: S.md, paddingVertical: S.sm + 4, gap: 4 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: S.sm },
  stat: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  n: { ...T.title, fontSize: 22, lineHeight: 26, fontVariant: ['tabular-nums'] },
});
