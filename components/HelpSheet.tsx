import { useAutoReleaseWindow } from '@/lib/autorelease';
import { Text, View } from 'react-native';
import { useState } from 'react';
import { LearnSheet } from '@/components/LearnSheet';
import { PrimaryButton } from '@/components/ds';
import { Icon, Sheet, type IconName } from '@/components/ds';
import { C, S, T } from '@/constants/theme';

const faq = (w: string | null): { icon: IconName; q: string; a: string }[] => [
  { icon: 'shield-checkmark', q: '¿Cómo funciona la custodia?', a: 'El comprador paga y el dinero queda apartado en custodia (escrow). El vendedor cobra cuando el comprador recibe el producto y lo revisa.' },
  { icon: 'keypad', q: '¿Para qué es el PIN?', a: 'El comprador recibe un PIN de 6 dígitos. Lo da al vendedor solo cuando tiene el producto en la mano. Con 3 intentos fallidos se bloquea.' },
  { icon: 'time', q: '¿Y si el comprador no confirma?', a: w ? `Si nadie reporta un problema, el pago se libera solo ${w} después del envío.` : 'Si nadie reporta un problema, el pago se libera solo al vencer el plazo de liberación automática.' },
  { icon: 'chatbubbles', q: '¿Qué pasa si hay un problema?', a: `${w ? `Repórtalo antes de ${w}.` : 'Repórtalo antes de que se libere el pago.'} El pago queda en pausa mientras revisamos el caso.` },
];

export function HelpSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const FAQ = faq(useAutoReleaseWindow());
  const [learn, setLearn] = useState(false);
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
      <PrimaryButton title="Cuenta Cavos, custodia y testnet" variant="secondary" icon="book-outline" onPress={() => setLearn(true)} />
      <LearnSheet visible={learn} onClose={() => setLearn(false)} />
    </Sheet>
  );
}
