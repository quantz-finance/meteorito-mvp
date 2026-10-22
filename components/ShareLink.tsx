// Link con botones Copiar y Compartir (Web Share API; si no hay, copia). Se usa en Vender y en Mi tienda.
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Platform, Share, StyleSheet, Text, View } from 'react-native';
import { haptic, PrimaryButton, toast } from '@/components/ds';
import { C, R, S, T } from '@/constants/theme';
import { track } from '@/lib/analytics';

export function ShareLink({ link, message, kind }: { link: string; message: string; kind: 'order' | 'store' }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    track('link_copied', { kind } as any);
    try { await Clipboard.setStringAsync(link); } catch { /* sin portapapeles */ }
    haptic.success(); toast('Link copiado'); setCopied(true);
  }
  async function share() {
    const nav = Platform.OS === 'web' ? (globalThis.navigator as Navigator | undefined) : undefined;
    track('share_clicked', { method: Platform.OS !== 'web' ? 'native_share' : nav?.share ? 'web_share' : 'copy', kind } as any);
    if (Platform.OS === 'web') {
      if (nav?.share) {
        try { await nav.share({ title: 'Meteorito', text: message, url: link }); return; }
        catch (e: any) { if (e?.name === 'AbortError') return; } // canceló: nada que hacer
      }
      return copy();
    }
    await Share.share({ message: `${message} ${link}`, url: link });
  }
  return (
    <View style={{ gap: S.sm }}>
      <View style={s.linkBox}>
        <Text style={[T.body, { flex: 1, color: C.text }]} numberOfLines={1} selectable>{link.replace('https://', '')}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <View style={{ flex: 1 }}><PrimaryButton title={copied ? 'Copiado' : 'Copiar'} icon={copied ? 'checkmark' : 'copy-outline'} variant="secondary" onPress={copy} /></View>
        <View style={{ flex: 1 }}><PrimaryButton title="Compartir" icon="share-outline" onPress={share} /></View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  linkBox: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: S.md, borderRadius: R.md, backgroundColor: C.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
});
