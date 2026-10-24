// Ficha de un producto de EJEMPLO del feed (/p/ej-…): foto, título, precio, estado, zona, descripción y su tienda de
// ejemplo. NUNCA se paga: no hay PayBox ni ningún botón de pago (solo uno desactivado que lo explica), el producto no
// existe en la base y el API rechaza su slug (orderBySlug -> 409 demo_product). Los datos (ficticios) se cargan aparte
// (import dinámico de api/_lib/demoProducts.ts) para no sumar peso al resto de la app. Textos: COPY.demoProducts.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Chip, haptic, Icon, PrimaryButton, Screen, Skeleton } from '@/components/ds';
import { StarsInline, VerifiedBadge } from '@/components/SellerBits';
import { StoreAvatar } from '@/components/StoreAvatar';
import { Fonts } from '@/constants/Colors';
import { C, R, S, T } from '@/constants/theme';
import { COPY } from '@/lib/copy';
import { formatCRC } from '@/lib/orders';
import { FEED_DEMO_PRODUCTS } from '../api/_lib/demoFlag';

type Demo = NonNullable<ReturnType<typeof import('../api/_lib/demoProducts').demoProduct>>;

export function DemoProductPage({ slug }: { slug: string }) {
  const [p, setP] = useState<Demo | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (!FEED_DEMO_PRODUCTS) { setP(null); return; }
    import('../api/_lib/demoProducts').then((m) => live && setP(m.demoProduct(slug))).catch(() => live && setP(null));
    return () => { live = false; };
  }, [slug]);
  const pay = (
    <View style={{ gap: S.xs }}>
      <PrimaryButton testID="demo-pay-disabled" title={COPY.demoProducts.payDisabled} icon="lock-closed" disabled onPress={() => {}} />
      <Text style={[T.footnote, { textAlign: 'center' }]}>{COPY.demoProducts.productNote}</Text>
    </View>
  );
  if (p === null) return (
    <Screen back="/comprar" title={COPY.demoProducts.productTitle} space="calm">
      <Card style={{ alignItems: 'center', gap: S.sm }}><Icon name="information-circle-outline" size={36} color={C.lilac} /><Text style={[T.callout, { textAlign: 'center' }]}>{COPY.demoProducts.gone}</Text></Card>
    </Screen>
  );
  return (
    <Screen back="/comprar" title={COPY.demoProducts.productTitle} subtitle={COPY.demoProducts.productSubtitle} space="calm" footer={p ? pay : undefined}>
      {p === undefined ? <><Skeleton h={300} r={R.lg} /><Skeleton h={120} r={R.lg} /></> : <>
        <View testID="demo-product-notice" style={s.notice} accessibilityRole="alert">
          <Icon name="information-circle-outline" size={20} color={C.purpleDark} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[T.headline, { color: C.purpleDark }]}>{COPY.demoProducts.productNoteTitle}</Text>
            <Text style={[T.footnote, { color: C.purpleDark }]}>{COPY.demoProducts.productNote}</Text>
          </View>
        </View>
        <Card style={{ gap: S.sm, padding: 0, overflow: 'hidden' }}>
          <View>
            <Image testID="demo-product-photo" source={{ uri: p.photo }} accessibilityLabel={`Foto de ${p.title} (ejemplo)`} style={s.photo} resizeMode="cover" />
            <View style={s.tag}><Text style={s.tagText}>{COPY.demoProducts.tag}</Text></View>
          </View>
          <View style={{ gap: S.sm, paddingHorizontal: S.md, paddingBottom: S.md }}>
            <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
              <Chip label={COPY.demoProducts.tag} icon="information-circle-outline" />
              <Chip label={p.condition} tone="muted" />
            </View>
            <Text style={T.title} accessibilityRole="header">{p.title}</Text>
            <Text style={T.money}>{formatCRC(p.price_crc)}</Text>
            <View style={s.row}><Icon name="location-outline" size={14} color={C.textDim} /><Text style={T.footnote}>{p.location}</Text></View>
            <Text style={T.callout}>{p.description}</Text>
          </View>
        </Card>
        <Pressable testID="demo-product-seller" accessibilityRole="link" accessibilityLabel={COPY.demoProducts.seeStore}
          onPress={() => { haptic.tap(); router.push({ pathname: '/t/[store]', params: { store: p.seller.store_slug } }); }}
          style={({ pressed }) => [s.seller, pressed && { opacity: 0.85 }]}>
          <StoreAvatar store={p.seller} size={40} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <View style={s.row}><Text style={[T.headline, { flexShrink: 1 }]} numberOfLines={1}>{p.seller.display_name}</Text>{p.seller.verified ? <VerifiedBadge size={16} /> : null}</View>
            <StarsInline avg={p.seller.rating_avg} count={p.seller.rating_count} />
            <Text style={[T.footnote, { color: C.lilac, fontFamily: Fonts.bold }]}>{COPY.demoProducts.seeStore}</Text>
          </View>
          <Icon name="chevron-forward" size={18} color={C.textDim} />
        </Pressable>
      </>}
    </Screen>
  );
}

const s = StyleSheet.create({
  notice: { flexDirection: 'row', gap: S.sm, alignItems: 'flex-start', padding: S.md, borderRadius: R.md, backgroundColor: C.lilac },
  photo: { width: '100%', aspectRatio: 1, backgroundColor: C.lilacBg },
  tag: { position: 'absolute', top: 10, left: 10, paddingHorizontal: 9, paddingVertical: 3, borderRadius: R.pill, backgroundColor: 'rgba(20,10,40,0.72)' },
  tagText: { fontFamily: Fonts.bold, fontSize: 13, color: C.text, letterSpacing: 0.3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  seller: { flexDirection: 'row', alignItems: 'center', gap: S.sm, padding: S.md, borderRadius: R.lg, backgroundColor: C.surface, borderWidth: 0.5, borderColor: C.line },
});
