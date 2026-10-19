import { Text, View } from 'react-native';
import { Card, Chip, Icon, Screen, type IconName } from '@/components/ds';
import { C, S, T } from '@/constants/theme';

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'link', title: 'Abre el link del vendedor', text: 'Te lo manda por WhatsApp o Messenger.' },
  { icon: 'lock-closed', title: 'Paga protegido', text: 'Tu dinero queda apartado hasta que recibas el producto.' },
  { icon: 'keypad', title: 'Revisa y da tu PIN', text: 'Solo cuando lo tengas en la mano y funcione.' },
];

export default function Comprar() {
  return (
    <Screen title="Comprar" subtitle="Celulares, consolas, laptops y más, con pago protegido.">
      <Card style={{ gap: S.md }}>
        {STEPS.map((s) => (
          <View key={s.title} style={{ flexDirection: 'row', gap: S.md, alignItems: 'center' }}>
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={s.icon} size={22} color={C.lilac} />
            </View>
            <View style={{ flex: 1 }}><Text style={T.headline}>{s.title}</Text><Text style={T.footnote}>{s.text}</Text></View>
          </View>
        ))}
      </Card>
      <Card style={{ alignItems: 'center', gap: S.sm, paddingVertical: S.lg }}>
        <Icon name="storefront-outline" size={32} color={C.lilac} />
        <Text style={T.headline}>Explorar productos</Text>
        <Text style={[T.callout, { textAlign: 'center' }]}>Muy pronto vas a poder buscar productos acá mismo.</Text>
        <Chip label="Próximamente" tone="warn" />
      </Card>
    </Screen>
  );
}
