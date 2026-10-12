import { Text, View } from 'react-native';
import { Card, Chip, Icon, MoneyTimeline, statusTone } from '@/components/ds';
import { C, S, T } from '@/constants/theme';
import { categoryIcon } from '@/components/categoryIcons';
import { formatCRC, STATUS_LABEL, type SellerOrder } from '@/lib/orders';

export function OrderCard({ order, onPress, timeline = true }: { order: SellerOrder; onPress?: () => void; timeline?: boolean }) {
  return (
    <Card onPress={onPress} accessibilityLabel={`${order.brand} ${order.model}`} style={{ gap: S.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
        <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={categoryIcon(order.category)} size={24} color={C.lilac} />
        </View>
        <View style={{ flex: 1, gap: S.xs }}>
          <Text style={T.headline} numberOfLines={1}>{order.brand} {order.model}</Text>
          <Chip label={STATUS_LABEL[order.status] ?? order.status} tone={statusTone(order.status)} />
        </View>
        <Text style={T.moneySm}>{formatCRC(order.price_crc)}</Text>
      </View>
      {timeline ? <MoneyTimeline status={order.status} compact /> : null}
    </Card>
  );
}
