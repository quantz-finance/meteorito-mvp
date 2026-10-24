// Bloque "Patrocinado" del feed de Comprar: productos de vendedores que pagaron por mostrarlos aquí (migración 023).
// Publicidad identificable (Ley 7472): bloque propio con título "Patrocinado" y la etiqueta en CADA tarjeta; nunca
// mezclado con lo orgánico. Sin patrocinios activos no se muestra. Métricas: sponsored_impression / sponsored_clicked
// (PostHog, sin montos ni datos de la persona). Carrusel horizontal DENTRO del bloque: la página no se desborda.
import { router } from 'expo-router';
import { memo, useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { haptic, Icon, PrimaryButton, Sheet } from '@/components/ds';
import { VerifiedBadge } from '@/components/SellerBits';
import { Fonts } from '@/constants/Colors';
import { pressTransition } from '@/constants/motion';
import { C, R, S, T } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { COPY } from '@/lib/copy';
import { formatCRC } from '@/lib/orders';
import type { SponsoredItem, VerifiedFilter } from '@/lib/store';

export function SponsoredBlock({ items, filter }: { items: SponsoredItem[]; filter: VerifiedFilter }) {
  const [info, setInfo] = useState(false);
  const seen = useRef(new Set<number>());
  useEffect(() => {
    items.forEach((it, i) => {
      if (seen.current.has(it.id)) return;
      seen.current.add(it.id);
      track('sponsored_impression', { sponsored_id: it.id, position: i, filter, verified: it.seller.verified });
    });
  }, [items, filter]);
  if (!items.length) return null;
  return (
    <View style={s.block} testID="sponsored-block" accessibilityRole="summary" accessibilityLabel={COPY.sponsored.label}>
      <View style={s.head}>
        <Text style={s.title}>{COPY.sponsored.label}</Text>
        <Pressable onPress={() => { haptic.tap(); setInfo(true); }} accessibilityRole="button" accessibilityLabel={COPY.sponsored.infoA11y} hitSlop={12} testID="sponsored-info">
          <Icon name="information-circle-outline" size={18} color={C.textDim} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row} style={s.scroller}>
        {items.map((it, i) => <SponsoredCard key={it.id} it={it} onPress={() => {
          haptic.tap(); track('sponsored_clicked', { sponsored_id: it.id, position: i, filter, verified: it.seller.verified });
          router.push({ pathname: '/p/[slug]', params: { slug: it.slug } });
        }} />)}
      </ScrollView>
      <Sheet visible={info} onClose={() => setInfo(false)} title={COPY.sponsored.infoTitle}
        footer={<PrimaryButton title={COPY.sponsored.ok} icon="checkmark" onPress={() => setInfo(false)} />}>
        <Text style={T.callout}>{COPY.sponsored.infoText}</Text>
      </Sheet>
    </View>
  );
}

const SponsoredCard = memo(function SponsoredCard({ it, onPress }: { it: SponsoredItem; onPress: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <Pressable onPress={onPress} accessibilityRole="link" accessibilityLabel={`${COPY.sponsored.a11y(it.title)}, ${formatCRC(it.price_crc)}, ${it.seller.display_name}`}
      testID="sponsored-card" style={({ pressed }) => [s.card, pressTransition, pressed && { opacity: 0.9 }]}>
      <View>
        {it.photo && !broken
          ? <Image source={{ uri: it.photo }} style={s.photo} resizeMode="cover" onError={() => setBroken(true)} accessibilityIgnoresInvertColors />
          : <View style={[s.photo, s.noPhoto]}><Icon name="image-outline" size={28} color={C.lilac} /></View>}
        <View style={s.tag}><Text style={s.tagText}>{COPY.sponsored.label}</Text></View>
      </View>
      <View style={s.body}>
        <Text style={s.cardTitle} numberOfLines={2}>{it.title}</Text>
        <Text style={T.moneySm} numberOfLines={1}>{formatCRC(it.price_crc)}</Text>
        <View style={s.who}>
          <Text style={[T.footnote, { flexShrink: 1 }]} numberOfLines={1}>{it.seller.display_name}</Text>
          {it.seller.verified ? <VerifiedBadge size={13} /> : null}
        </View>
      </View>
    </Pressable>
  );
});

const W = 142;
const s = StyleSheet.create({
  block: { gap: S.sm, paddingVertical: S.sm, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontFamily: Fonts.bold, fontSize: 12, lineHeight: 16, color: C.textDim, letterSpacing: 0.6, textTransform: 'uppercase' },
  scroller: { flexGrow: 0 },
  row: { gap: S.sm },
  card: { width: W, backgroundColor: C.surface, borderRadius: R.md, overflow: 'hidden', borderWidth: 0.5, borderColor: C.line },
  photo: { width: W, height: W, backgroundColor: C.lilacBg },
  noPhoto: { alignItems: 'center', justifyContent: 'center' },
  tag: { position: 'absolute', top: 6, left: 6, paddingHorizontal: 7, paddingVertical: 2, borderRadius: R.pill, backgroundColor: 'rgba(20,10,40,0.78)' },
  tagText: { fontFamily: Fonts.bold, fontSize: 12, color: C.text, letterSpacing: 0.3 },
  body: { gap: 2, padding: S.sm },
  cardTitle: { fontFamily: Fonts.regular, fontSize: 14, lineHeight: 18, color: C.text },
  who: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
