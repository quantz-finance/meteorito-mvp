// Vista de una tienda: nombre, puntuación y productos disponibles (foto, nombre, precio). Sin datos sensibles.
import { router } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ds';
import { Reveal } from '@/components/space';
import { pressTransition } from '@/constants/motion';
import { C, R, S, T } from '@/constants/theme';
import { formatCRC } from '@/lib/orders';
import { ratingLabel, type Store } from '@/lib/store';

export function StoreHeader({ store }: { store: Store }) {
  const rated = store.rating_count > 0 && store.rating_avg != null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
      <View style={s.avatar}><Text style={s.avatarText}>{store.display_name.charAt(0).toUpperCase()}</Text></View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={T.title} numberOfLines={1}>{store.display_name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs }}>
          <Icon name={rated ? 'star' : 'sparkles-outline'} size={16} color={rated ? '#FFD84D' : C.lilac} />
          <Text style={T.callout} numberOfLines={1}>{ratingLabel(store)}</Text>
        </View>
      </View>
    </View>
  );
}

export function StoreItems({ store, empty }: { store: Store; empty: string }) {
  if (!store.items.length) return (
    <View style={s.empty}><Icon name="pricetags-outline" size={32} color={C.lilac} /><Text style={[T.callout, { textAlign: 'center' }]}>{empty}</Text></View>
  );
  return (
    <View style={s.grid}>
      {store.items.map((it, i) => (
        <Reveal key={it.slug} i={Math.min(i, 6)} style={s.cell}>
          <Pressable accessibilityRole="link" accessibilityLabel={`${it.title}, ${formatCRC(it.price_crc)}`}
            onPress={() => router.push({ pathname: '/p/[slug]', params: { slug: it.slug } })}
            style={({ pressed }) => [s.item, pressTransition, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
            {it.photo ? <Image source={{ uri: it.photo }} style={s.photo} resizeMode="cover" />
              : <View style={[s.photo, s.noPhoto]}><Icon name="image-outline" size={28} color={C.lilac} /></View>}
            <View style={{ padding: S.sm, gap: 2 }}>
              <Text style={T.callout} numberOfLines={2}>{it.title}</Text>
              <Text style={[T.headline, { fontVariant: ['tabular-nums'] }]} numberOfLines={1}>{formatCRC(it.price_crc)}</Text>
            </View>
          </Pressable>
        </Reveal>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.lilac, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 24, fontWeight: '900', color: C.purpleDark },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -S.xs },
  cell: { width: '50%', padding: S.xs },
  item: { backgroundColor: C.surface, borderRadius: R.lg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  photo: { width: '100%', aspectRatio: 1, backgroundColor: C.lilacBg },
  noPhoto: { alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', gap: S.sm, paddingVertical: S.xl },
});
