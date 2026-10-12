import { Text, View } from 'react-native';
import { Icon, Sheet, type IconName } from '@/components/ds';
import { C, S, T } from '@/constants/theme';

const FAQ: { icon: IconName; q: string; a: string }[] = [
  { icon: 'shield-checkmark', q: '¿Cómo me protege Meteorito?', a: 'El comprador paga y el dinero queda apartado. El vendedor cobra cuando el comprador recibe el producto y lo revisa.' },
  { icon: 'keypad', q: '¿Para qué es el PIN?', a: 'El comprador recibe un PIN de 6 dígitos. Lo da al vendedor solo cuando tiene el producto en la mano. Con 3 intentos fallidos se bloquea.' },
  { icon: 'time', q: '¿Y si el comprador no confirma?', a: 'Si nadie reporta un problema, el pago se libera solo 24 h después del envío.' },
  { icon: 'chatbubbles', q: '¿Qué pasa si hay un problema?', a: 'Reportalo antes de las 24 h. El pago queda en pausa mientras revisamos el caso.' },
];

export function HelpSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Ayuda">
      {FAQ.map((f) => (
        <View key={f.q} style={{ flexDirection: 'row', gap: S.md }}>
          <Icon name={f.icon} size={22} color={C.lilac} />
          <View style={{ flex: 1, gap: S.xs }}>
            <Text style={T.headline}>{f.q}</Text>
            <Text style={T.callout}>{f.a}</Text>
          </View>
        </View>
      ))}
    </Sheet>
  );
}
