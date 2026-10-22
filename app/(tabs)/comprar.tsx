import { Text, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { Card, Chip, Icon, PrimaryButton, Screen, type IconName } from '@/components/ds';
import { Reveal } from '@/components/space';
import { C, R, S, T } from '@/constants/theme';

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'link', title: 'Abre el link', text: 'Te lo manda el vendedor por WhatsApp.' },
  { icon: 'lock-closed', title: 'Paga en custodia', text: 'El pago queda apartado hasta que recibas.' },
  { icon: 'keypad', title: 'Da tu PIN', text: 'Solo cuando lo tengas en la mano.' },
];

export default function Comprar() {
  const short = useWindowDimensions().height < 740;
  return (
    <Screen title="Comprar" subtitle={short ? undefined : 'Sin crear cuenta, con fondos en custodia (escrow).'} scroll={false}>
      <View style={{ flex: 1, gap: S.md }}>
        <Text style={T.caption}>Cómo funciona</Text>
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          {STEPS.map((s, i) => (
            <Reveal key={s.title} i={i} style={{ flex: 1 }}>
              <View style={{ flex: 1, backgroundColor: C.surface, borderRadius: R.lg, padding: S.sm + 4, gap: S.xs, borderWidth: 0.5, borderColor: C.line }}>
                <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={s.icon} size={18} color={C.lilac} />
                </View>
                <Text style={[T.headline, { fontSize: 15 }]} numberOfLines={2}>{s.title}</Text>
                <Text style={T.footnote} numberOfLines={4}>{s.text}</Text>
              </View>
            </Reveal>
          ))}
        </View>
        <Reveal i={3}><Card style={{ gap: S.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
            <Icon name="paper-plane-outline" size={24} color={C.lilac} />
            <Text style={[T.headline, { flex: 1 }]}>¿Quieres algo que aún no está publicado?</Text>
          </View>
          <Text style={T.callout} numberOfLines={3}>Invita a un vendedor: dices qué quieres y a qué precio; él publica y te manda el link de pago.</Text>
          <PrimaryButton title="Invitar a un vendedor" icon="paper-plane-outline" onPress={() => router.push('/i/nueva')} />
        </Card></Reveal>
        <Reveal i={4}><Card style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
          <Icon name="storefront-outline" size={24} color={C.lilac} />
          <Text style={[T.callout, { flex: 1 }]} numberOfLines={2}>Buscar productos aquí mismo</Text>
          <Chip label="Próximamente" tone="warn" />
        </Card></Reveal>
      </View>
    </Screen>
  );
}
