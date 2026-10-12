import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Share, Text, View } from 'react-native';
import { Card, haptic, PrimaryButton, Screen, SuccessCheck } from '@/components/ds';
import { C, S, T } from '@/constants/theme';
import { orderLink } from '@/lib/orders';

export default function Compartir() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const link = orderLink(slug);
  const [copied, setCopied] = useState(false);
  const message = `Pagá seguro con Meteorito: ${link}`;

  async function share() {
    if (Platform.OS === 'web') {
      const nav = globalThis.navigator as Navigator | undefined;
      if (nav?.share) return nav.share({ title: 'Meteorito', text: message, url: link }).catch(() => {});
      return copy();
    }
    await Share.share({ message, url: link });
  }
  async function copy() {
    await Clipboard.setStringAsync(link);
    haptic.success();
    setCopied(true);
  }

  return (
    <Screen contentStyle={{ flexGrow: 1, justifyContent: 'center' }}
      footer={<>
        <PrimaryButton title="Compartir link" icon="share-outline" onPress={share} />
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <View style={{ flex: 1 }}><PrimaryButton title="Ver como comprador" variant="secondary" onPress={() => router.push({ pathname: '/p/[slug]', params: { slug } })} /></View>
          <View style={{ flex: 1 }}><PrimaryButton title="Listo" variant="secondary" onPress={() => router.replace('/pedidos')} /></View>
        </View>
      </>}>
      <SuccessCheck />
      <View style={{ gap: S.sm }}>
        <Text style={[T.largeTitle, { textAlign: 'center' }]}>¡Tu link está listo!</Text>
        <Text style={[T.callout, { textAlign: 'center' }]}>Mandalo por WhatsApp o Messenger. El comprador paga protegido y vos cobrás al entregar.</Text>
      </View>
      <Card onPress={copy} accessibilityLabel="Copiar link" style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
        <Text style={[T.body, { flex: 1 }]} numberOfLines={1}>{link.replace('https://', '')}</Text>
        <Text style={[T.headline, { color: copied ? C.success : C.lilac }]}>{copied ? 'Copiado' : 'Copiar'}</Text>
      </Card>
    </Screen>
  );
}
