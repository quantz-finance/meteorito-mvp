import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ui } from '@/components/ui';
import { parseSlug } from '@/lib/orders';
import { useStableWindow } from '@/lib/viewport';
import { router } from 'expo-router';
import { Card, ErrorText, haptic, Icon, PrimaryButton, Screen, Sheet, type IconName } from '@/components/ds';
import { Reveal } from '@/components/space';
import { C, R, S, T } from '@/constants/theme';

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'link', title: 'Abre el link', text: 'Te lo manda el vendedor por WhatsApp.' },
  { icon: 'lock-closed', title: 'Paga en custodia', text: 'El pago queda apartado hasta que recibas.' },
  { icon: 'keypad', title: 'Da tu PIN', text: 'Solo cuando lo tengas en la mano.' },
];

export default function Comprar() {
  const short = useStableWindow().height < 740;
  const [payOpen, setPayOpen] = useState(false);
  const [link, setLink] = useState('');
  const linkSlug = parseSlug(link);
  const goPay = () => { if (!linkSlug) return; setPayOpen(false); setLink(''); router.push(`/p/${linkSlug}`); };
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
        <Reveal i={4}><Pressable accessibilityRole="button" accessibilityLabel="Pagar un link" onPress={() => { haptic.tap(); setPayOpen(true); }}
          style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: S.sm + 4, backgroundColor: C.surface, borderRadius: R.lg, padding: S.sm + 4, minHeight: 64, borderWidth: 0.5, borderColor: C.line }, pressed && { opacity: 0.85 }]}>
          <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: C.lilac, alignItems: 'center', justifyContent: 'center' }}><Icon name="link" size={22} color={C.purpleDark} /></View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={T.headline} numberOfLines={1}>Pagar un link</Text>
            <Text style={T.footnote} numberOfLines={1}>Pega el link que te mandó el vendedor</Text>
          </View>
          <Icon name="chevron-forward" size={20} color={C.lilac} />
        </Pressable></Reveal>
      </View>

      <Sheet visible={payOpen} onClose={() => setPayOpen(false)} title="Pagar un link"
        footer={<PrimaryButton title="Ver producto" icon="arrow-forward" disabled={!linkSlug} onPress={goPay} />}>
        <Text style={T.callout}>Pega el link que te mandó el vendedor (o solo el código).</Text>
        <TextInput style={ui.input} placeholder="meteorito.app/p/…" placeholderTextColor={C.textDim} value={link} onChangeText={setLink}
          autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="go" onSubmitEditing={goPay} autoFocus />
        {link.trim() && !linkSlug ? <ErrorText>Ese link no parece de Meteorito.</ErrorText> : null}
      </Sheet>
    </Screen>
  );
}
