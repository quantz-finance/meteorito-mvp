import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, Share, Text, View } from 'react-native';
import { Button, ui } from '@/components/ui';
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
    setCopied(true);
  }

  return (
    <View style={[ui.screen, ui.content, { justifyContent: 'center' }]}>
      <Text style={ui.h1}>¡Tu link está listo!</Text>
      <Text style={ui.muted}>Mandalo por Messenger o WhatsApp. El comprador paga protegido y vos cobrás al entregar.</Text>
      <View style={ui.card}><Text style={ui.text} selectable>{link}</Text></View>
      <Button title="Compartir" onPress={share} />
      <Button title={copied ? '¡Copiado!' : 'Copiar link'} variant="outline" onPress={copy} />
      <Button title="Ver como comprador" variant="outline" onPress={() => router.push({ pathname: '/p/[slug]', params: { slug } })} />
      <Button title="Listo" variant="outline" onPress={() => router.replace('/pedidos')} />
    </View>
  );
}
