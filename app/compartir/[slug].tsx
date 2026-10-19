import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Share, Text, View } from 'react-native';
import { Card, haptic, PrimaryButton, Screen, SuccessCheck } from '@/components/ds';
import { toast } from '@/components/ds';
import { C, S, T } from '@/constants/theme';
import { orderLink } from '@/lib/orders';
import { track } from '@/lib/analytics';
import { DEMO_ENABLED, setDemoRole } from '@/lib/demo';

export default function Compartir() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const link = orderLink(slug);
  const [copied, setCopied] = useState(false);
  const message = `Paga en custodia con Meteorito: ${link}`;

  async function share() {
    track('share_clicked', { method: Platform.OS === 'web' && (globalThis.navigator as any)?.share ? 'web_share' : Platform.OS === 'web' ? 'copy' : 'native_share' });
    if (Platform.OS === 'web') {
      const nav = globalThis.navigator as Navigator | undefined;
      if (nav?.share) return nav.share({ title: 'Meteorito', text: message, url: link }).catch(() => {});
      return copy();
    }
    await Share.share({ message, url: link });
  }
  async function copy() {
    track('link_copied');
    await Clipboard.setStringAsync(link);
    haptic.success(); toast('Link copiado');
    setCopied(true);
  }

  return (
    <Screen contentStyle={{ flexGrow: 1, justifyContent: 'center' }}
      footer={<>
        <PrimaryButton title="Compartir link" icon="share-outline" onPress={share} />
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <View style={{ flex: 1 }}><PrimaryButton title="Ver como comprador" variant="secondary" onPress={() => { if (DEMO_ENABLED) setDemoRole('buyer'); router.push({ pathname: '/p/[slug]', params: { slug } }); }} /></View>
          <View style={{ flex: 1 }}><PrimaryButton title="Listo" variant="secondary" onPress={() => router.replace('/pedidos')} /></View>
        </View>
      </>}>
      <SuccessCheck />
      <View style={{ gap: S.sm }}>
        <Text style={[T.largeTitle, { textAlign: 'center' }]}>¡Tu link está listo!</Text>
        <Text style={[T.callout, { textAlign: 'center' }]}>Mándalo por WhatsApp o Messenger. El comprador paga y los fondos quedan en custodia; tú cobras al entregar.</Text>
      </View>
      <Card onPress={copy} accessibilityLabel="Copiar link" style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
        <Text style={[T.body, { flex: 1 }]} numberOfLines={1}>{link.replace('https://', '')}</Text>
        <Text style={[T.headline, { color: copied ? C.success : C.lilac }]}>{copied ? 'Copiado' : 'Copiar'}</Text>
      </Card>
    </Screen>
  );
}
