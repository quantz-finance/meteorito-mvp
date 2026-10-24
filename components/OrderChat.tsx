// Chat dentro de una compra: tarjeta en el seguimiento (/p/<pedido>, solo en el dispositivo del comprador) y botón en
// el pedido del vendedor (Home). El servidor vuelve a validar que quien abre sea el comprador o el vendedor del pedido.
import { Text, View } from 'react-native';
import { Card } from '@/components/ds';
import { ChatButton } from '@/components/ChatButton';
import { S, T } from '@/constants/theme';
import { useChatAvailable } from '@/lib/chat';
import { COPY } from '@/lib/copy';

export function OrderChatCard({ slug }: { slug: string }) {
  const available = useChatAvailable();
  if (!available) return null;
  return (
    <Card style={{ gap: S.sm }} testID="order-chat">
      <Text style={T.caption}>{COPY.chat.title}</Text>
      <Text style={T.callout}>{COPY.chat.orderHint}</Text>
      <ChatButton as="buyer" target={{ order_slug: slug }} source="order_buyer" title={COPY.chat.orderBuyer} testID="order-chat-buyer" />
    </Card>
  );
}

export function SellerOrderChat({ slug, onOpen }: { slug: string; onOpen?: () => void }) {
  return <View><ChatButton as="seller" target={{ order_slug: slug }} source="order_seller" title={COPY.chat.orderSeller} testID="order-chat-seller" onOpen={onOpen} /></View>;
}
