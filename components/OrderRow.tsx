import { Text, View } from 'react-native';
import { Card, Chip, Icon, MoneyTimeline, statusTone } from '@/components/ds';
import { C, S, T } from '@/constants/theme';
import { categoryIcon } from '@/components/categoryIcons';
import { formatCRC, orderTitle, STATUS_LABEL, type SellerOrder } from '@/lib/orders';

export function OrderCard({ order, onPress, timeline = true, fill }: { order: SellerOrder; onPress?: () => void; timeline?: boolean; fill?: boolean }) {
  return (
    <Card onPress={onPress} accessibilityLabel={orderTitle(order)} style={[{ gap: fill ? S.sm : S.md }, fill && { flex: 1, justifyContent: 'center', paddingVertical: S.sm }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
        <View style={{ width: fill ? 40 : 48, height: fill ? 40 : 48, borderRadius: 14, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={categoryIcon(order.category)} size={24} color={C.lilac} />
        </View>
        <View style={{ flex: 1, gap: S.xs }}>
          <Text style={T.headline} numberOfLines={1}>{orderTitle(order)}</Text>
          <Chip key={order.status} swap label={STATUS_LABEL[order.status] ?? order.status} tone={statusTone(order.status)} />
        </View>
        <Text style={T.moneySm}>{formatCRC(order.price_crc)}</Text>
      </View>
      {timeline ? <MoneyTimeline status={order.status} compact /> : null}
    </Card>
  );
}
