// Vista de una tienda: nombre, puntuación y productos disponibles (foto, nombre, precio). Sin datos sensibles.
import { router } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';
import { ErrorText, Icon } from '@/components/ds';
import { StoreAvatar } from '@/components/StoreAvatar';
import { GridPager } from '@/components/GridPager';
import { pressTransition } from '@/constants/motion';
import { C, R, S, T } from '@/constants/theme';
import { formatCRC } from '@/lib/orders';
import { ratingLabel, type Store } from '@/lib/store';

export function StoreHeader({ store, editable, onChange }: { store: Store; editable?: boolean; onChange?: (s: Store) => void }) {
  const rated = store.rating_count > 0 && store.rating_avg != null;
  const [err, setErr] = useState<string | null>(null);
  return (
    <View style={{ gap: S.xs }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
      <StoreAvatar store={store} editable={editable} onChange={onChange} onError={setErr} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={T.title} numberOfLines={1}>{store.display_name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs }}>
          <Icon name={rated ? 'star' : 'sparkles-outline'} size={16} color={rated ? '#FFD84D' : C.lilac} />
          <Text style={T.callout} numberOfLines={1}>{ratingLabel(store)}</Text>
        </View>
      </View>
    </View>
    {err ? <ErrorText>{err}</ErrorText> : null}
    </View>
  );
}

export function StoreItems({ store, empty, minCellW = 150, minCellH = 168, onItemPress }: { store: Store; empty: string; minCellW?: number; minCellH?: number; /** Mi tienda: gestionar (pausar/archivar) en vez de abrir. */ onItemPress?: (it: Store['items'][number]) => void }) {
  if (!store.items.length) return (
    <View style={s.empty}><Icon name="pricetags-outline" size={32} color={C.lilac} /><Text style={[T.callout, { textAlign: 'center' }]}>{empty}</Text></View>
  );
  return (
    <GridPager items={store.items} keyOf={(it) => it.slug} minCellW={minCellW} minCellH={minCellH} label="Página de productos"
      renderItem={(it) => (
        <Pressable accessibilityRole="link" accessibilityLabel={`${it.title}, ${formatCRC(it.price_crc)}`}
          onPress={() => (onItemPress ? onItemPress(it) : router.push({ pathname: '/p/[slug]', params: { slug: it.slug } }))}
          style={({ pressed }) => [s.item, pressTransition, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
          {it.photo ? <Image source={{ uri: it.photo }} style={s.photo} resizeMode="cover" />
            : <View style={[s.photo, s.noPhoto]}><Icon name="image-outline" size={28} color={C.lilac} /></View>}
          <View style={s.meta}>
            <Text style={[T.footnote, { color: C.text }]} numberOfLines={1}>{it.listing_status === 'pausada' ? 'En pausa · ' : ''}{it.title}</Text>
            <Text style={[T.headline, { fontVariant: ['tabular-nums'] }]} numberOfLines={1}>{formatCRC(it.price_crc)}</Text>
          </View>
        </Pressable>
      )} />
  );
}

const s = StyleSheet.create({
  item: { flex: 1, backgroundColor: C.surface, borderRadius: R.lg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  photo: { flex: 1, width: '100%', backgroundColor: C.lilacBg },
  meta: { paddingHorizontal: S.sm, paddingVertical: 6, gap: 0 },
  noPhoto: { alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', gap: S.sm, paddingVertical: S.xl },
});
