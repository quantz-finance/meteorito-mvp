// Plantilla de anuncio: texto listo para pegar en Facebook, WhatsApp o Marketplace con el link y el acuerdo de entrega.
// Se abre desde "¡Tu link está listo!" (Vender) y desde la hoja de un pedido sin pagar (Home).
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, haptic, Icon, PrimaryButton, Sheet, toast } from '@/components/ds';
import { C, R, S, T } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { AD_COPIED, AD_COPY, AD_FORMATS, AD_HINT, AD_TITLE, adTemplate, type AdFormat, type AdInput } from '@/lib/sellerTools';

export function AdTemplateSheet({ visible, onClose, ad }: { visible: boolean; onClose: () => void; ad: AdInput | null }) {
  const [format, setFormat] = useState<AdFormat>('whatsapp');
  const text = ad ? adTemplate(ad, format) : '';
  async function copy() {
    track('ad_copied' as any, { format } as any);
    try { await Clipboard.setStringAsync(text); } catch { /* sin portapapeles */ }
    haptic.success(); toast(AD_COPIED);
  }
  return (
    <Sheet visible={visible} onClose={onClose} title={AD_TITLE}
      footer={<PrimaryButton title={AD_COPY} icon="copy-outline" onPress={copy} disabled={!ad} />}>
      <Text style={T.footnote}>{AD_HINT}</Text>
      <View style={{ flexDirection: 'row', gap: S.sm }} accessibilityRole="radiogroup">
        {AD_FORMATS.map((f) => { const on = format === f.key; return (
          <Pressable key={f.key} onPress={() => { haptic.tap(); setFormat(f.key); }} accessibilityRole="radio" aria-checked={on} accessibilityLabel={f.label}
            style={({ pressed }) => [s.chip, { flex: f.key === 'marketplace' ? 1.5 : 1 }, on && s.on, pressed && { opacity: 0.85 }]}>
            <Text style={[T.headline, { fontSize: 15, color: on ? C.white : C.lilac }]} numberOfLines={1}>{f.label}</Text>
          </Pressable>); })}
      </View>
      <Card style={{ padding: S.sm + 4 }} accessibilityLabel="Vista previa del anuncio">
        <Text style={[T.footnote, { color: C.text }]} selectable testID="ad-preview">{text}</Text>
      </Card>
    </Sheet>
  );
}

/** Fila para abrir la plantilla (misma en Vender y en la hoja del pedido). */
export function AdTemplateButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={() => { haptic.tap(); onPress(); }} accessibilityRole="button" accessibilityLabel={AD_TITLE}
      style={({ pressed }) => [s.row, pressed && { opacity: 0.85 }]}>
      <Icon name="document-text-outline" size={20} color={C.lilac} />
      <View style={{ flex: 1 }}>
        <Text style={[T.headline, { fontSize: 15, color: C.lilac }]} numberOfLines={1}>{AD_TITLE}</Text>
      </View>
      <Icon name="chevron-forward" size={18} color={C.lilac} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  chip: { flex: 1, minHeight: 44, paddingHorizontal: S.sm, borderRadius: R.md, borderWidth: 1, borderColor: C.lilac, alignItems: 'center', justifyContent: 'center' },
  on: { backgroundColor: C.lilac, borderColor: C.lilac },
  row: { flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: 44, paddingHorizontal: S.sm + 4, borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: C.lilacBg },
});
