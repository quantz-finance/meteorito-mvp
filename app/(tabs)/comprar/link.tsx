import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ui } from '@/components/ui';
import { parseSlug } from '@/lib/orders';
import { useStableWindow } from '@/lib/viewport';
import { router } from 'expo-router';
import { Card, ErrorText, haptic, Icon, PrimaryButton, Screen, Sheet } from '@/components/ds';
import { ComprarNav } from '@/components/ComprarNav';
import { Reveal } from '@/components/space';
import { C, R, S, T } from '@/constants/theme';

// Comprar › Pagar con link (/comprar/link): lo que antes estaba arriba del feed, igual: importar de Facebook, invitar
// (pedir link) a un vendedor y pagar un link.
export default function PagarConLink() {
  const short = useStableWindow().height < 740;
  const [payOpen, setPayOpen] = useState(false);
  const [link, setLink] = useState('');
  const linkSlug = parseSlug(link);
  const goPay = () => { if (!linkSlug) return; setPayOpen(false); setLink(''); router.push(`/p/${linkSlug}`); };
  return (
    <Screen title="Pagar con link" subtitle={short ? undefined : 'Sin crear cuenta, con fondos en custodia (escrow).'} scroll={false}
      right={<ComprarNav active="link" />}>
      <View style={{ gap: S.md }}>
        <Reveal i={0}><Card style={{ gap: S.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
            <Icon name="paper-plane-outline" size={24} color={C.lilac} />
            <Text style={[T.headline, { flex: 1 }]}>¿Lo viste en Facebook o en otro lado?</Text>
          </View>
          <Text style={T.callout} numberOfLines={3}>Invita al vendedor: pega el link del anuncio o di qué quieres y a qué precio. Él acepta y te manda el link de pago.</Text>
          <PrimaryButton title="Importar de un link" icon="link" accessibilityLabel="Importar de un link"
            onPress={() => router.push({ pathname: '/i/nueva', params: { fb: '1' } })} />
          <PrimaryButton title="Invitar a un vendedor" icon="paper-plane-outline" variant="secondary" accessibilityLabel="Invitar a un vendedor" onPress={() => router.push('/i/nueva')} />
        </Card></Reveal>
        <Reveal i={1}><Pressable accessibilityRole="button" accessibilityLabel="Pagar un link" onPress={() => { haptic.tap(); setPayOpen(true); }}
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

