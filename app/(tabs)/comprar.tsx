import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Card, Chip, Icon, PrimaryButton, Screen, type IconName } from '@/components/ds';
import { C, S, T } from '@/constants/theme';

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'link', title: 'Abre el link del vendedor', text: 'Te lo manda por WhatsApp o Messenger.' },
  { icon: 'lock-closed', title: 'Pagas en custodia', text: 'Tu pago de prueba queda en custodia hasta que recibas el producto.' },
  { icon: 'keypad', title: 'Revisa y da tu PIN', text: 'Solo cuando lo tengas en la mano y funcione.' },
];

export default function Comprar() {
  return (
    <Screen title="Comprar" subtitle="Celulares, consolas, laptops y más, con fondos en custodia (escrow).">
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
        <Icon name="paper-plane-outline" size={32} color={C.lilac} />
        <Text style={T.headline}>¿Quieres algo que aún no está publicado?</Text>
        <Text style={[T.callout, { textAlign: 'center' }]}>Invita a un vendedor: dices qué quieres y a qué precio, él publica y te manda el link de pago.</Text>
        <PrimaryButton title="Invitar a un vendedor" icon="paper-plane-outline" onPress={() => router.push('/i/nueva')} />
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
