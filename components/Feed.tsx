// Feed de Comprar (tipo red social): publicaciones de los vendedores, lo más nuevo primero, con buscador, filtro por
// verificación (Verificados por defecto / Sin verificar / Todos), paginación infinita por cursor, skeletons y estados
// vacíos. Lecturas públicas: GET /api/store?feed (caché corta, sin datos privados).
import { router } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { haptic, Icon, PrimaryButton, Skeleton, type IconName } from '@/components/ds';
import { StoreAvatar } from '@/components/StoreAvatar';
import { StarsInline, VerifiedBadge } from '@/components/SellerBits';
import { pressTransition } from '@/constants/motion';
import { Fonts } from '@/constants/Colors';
import { C, R, S, T, TOUCH } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { formatCRC } from '@/lib/orders';
import { FEED_ERROR, getFeed, type FeedItem, type VerifiedFilter } from '@/lib/store';
import { timeAgo } from '@/lib/timeago';

export const SEARCH_DEBOUNCE_MS = 300;
const PAGE = 10;
const FILTERS: { key: VerifiedFilter; label: string; icon?: IconName }[] = [
  { key: 'true', label: 'Verificados', icon: 'checkmark-circle' }, { key: 'false', label: 'Sin verificar' }, { key: 'all', label: 'Todos' },
];

export function Feed({ header }: { header: ReactElement }) {
  const [filter, setFilter] = useState<VerifiedFilter>('true');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [more, setMore] = useState(false);
  const req = useRef(0);
  const viewed = useRef(false);

  // Debounce del buscador (~300 ms): no se pide nada por cada tecla.
  useEffect(() => { const id = setTimeout(() => setQ(text.trim()), SEARCH_DEBOUNCE_MS); return () => clearTimeout(id); }, [text]);

  const load = useCallback(async () => {
    const id = ++req.current;
    setPhase('loading'); setItems([]); setCursor(null);
    try {
      const page = await getFeed({ q, verified: filter, limit: PAGE });
      if (id !== req.current) return;
      setItems(page.items); setCursor(page.next_cursor); setPhase('ready');
      if (q) track('feed_search', { results: page.items.length, more: !!page.next_cursor, filter, q_len: q.length });
      else if (!viewed.current) { viewed.current = true; track('feed_viewed', { items: page.items.length, filter }); }
    } catch { if (id === req.current) setPhase('error'); }
  }, [q, filter]);
  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    if (!cursor || more || phase !== 'ready') return;
    const id = req.current; setMore(true);
    try {
      const page = await getFeed({ q, verified: filter, cursor, limit: PAGE });
      if (id !== req.current) return;
      setItems((prev) => [...prev, ...page.items.filter((i) => !prev.some((p) => p.slug === i.slug))]); setCursor(page.next_cursor);
    } catch { /* se reintenta al seguir bajando */ } finally { if (id === req.current) setMore(false); }
  };
  const clear = () => { setText(''); setQ(''); };
  const pick = (f: VerifiedFilter) => { if (f === filter) return; haptic.tap(); setFilter(f); };

  const top = (
    <View style={{ gap: S.md, paddingBottom: S.md }}>
      {header}
      <View style={s.search}>
        <Icon name="search" size={20} color={C.textDim} />
        <TextInput style={s.searchInput} value={text} onChangeText={setText} placeholder="Buscar: PlayStation, bici, iPhone…" placeholderTextColor={C.textDim}
          accessibilityLabel="Buscar productos" autoCapitalize="none" autoCorrect={false} returnKeyType="search" enterKeyHint="search" maxLength={60}
          onSubmitEditing={() => setQ(text.trim())} />
        {text ? <Pressable onPress={clear} accessibilityRole="button" accessibilityLabel="Limpiar búsqueda" hitSlop={10} style={s.clear}>
          <Icon name="close-circle" size={20} color={C.textDim} /></Pressable> : null}
      </View>
      <View style={s.chips} accessibilityRole="tablist">
        {FILTERS.map((f) => {
          const on = f.key === filter;
          return (
            <Pressable key={f.key} onPress={() => pick(f.key)} accessibilityRole="tab" accessibilityState={{ selected: on }} aria-selected={on} accessibilityLabel={f.label}
              style={({ pressed }) => [s.chip, on && s.chipOn, pressed && { opacity: 0.85 }]}>
              {f.icon ? <Icon name={f.icon} size={15} color={on ? C.purpleDark : C.lilac} /> : null}
              <Text style={[s.chipText, on && { color: C.purpleDark }]} numberOfLines={1}>{f.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={T.caption}>{q ? 'Resultados' : 'Lo más nuevo'}</Text>
    </View>
  );

  let empty: ReactElement | null = null;
  if (phase === 'loading') empty = <View style={{ gap: S.md }}><FeedSkeleton /><FeedSkeleton /></View>;
  else if (phase === 'error') empty = <EmptyState icon="cloud-offline-outline" title="No pudimos cargar el feed" text={FEED_ERROR} actions={<PrimaryButton title="Reintentar" icon="refresh" variant="secondary" onPress={load} />} />;
  else if (q) empty = (
    <EmptyState icon="search" title={`No encontramos “${q.length > 24 ? q.slice(0, 24) + '…' : q}”`}
      text={filter === 'all' ? 'Revisa cómo lo escribiste o prueba con una palabra más general, por ejemplo “consola” o “bici”.' : 'Puede que esté en otra lista: busca en Todos o prueba con una palabra más general.'}
      actions={<>
        {filter !== 'all' ? <PrimaryButton title="Buscar en Todos" icon="albums-outline" onPress={() => setFilter('all')} /> : null}
        <PrimaryButton title="Limpiar búsqueda" icon="close" variant="secondary" onPress={clear} />
        <PrimaryButton title="Pídeselo a un vendedor" icon="paper-plane-outline" variant="ghost" onPress={() => router.push('/i/nueva')} />
      </>} />
  );
  else if (filter === 'true') empty = (
    <EmptyState icon="checkmark-circle" title="Todavía no hay vendedores verificados"
      text="Aquí verás a los vendedores verificados. Mientras tanto, mira todas las publicaciones: con cualquier vendedor tu pago queda en custodia hasta que recibas."
      actions={<PrimaryButton title="Ver todos" icon="albums-outline" onPress={() => setFilter('all')} />} />
  );
  else empty = (
    <EmptyState icon="planet-outline" title="Todavía no hay publicaciones"
      text={filter === 'false' ? 'Mira la lista de Todos o vuelve en un rato.' : 'Cuando los vendedores publiquen sus productos, los verás aquí. ¿Buscas algo? Pídeselo a un vendedor.'}
      actions={filter === 'false' ? <PrimaryButton title="Ver todos" icon="albums-outline" onPress={() => setFilter('all')} />
        : <PrimaryButton title="Invitar a un vendedor" icon="paper-plane-outline" variant="secondary" onPress={() => router.push('/i/nueva')} />} />
  );

  return (
    <FlatList data={phase === 'ready' ? items : []} keyExtractor={(i) => i.slug} style={{ flex: 1 }}
      renderItem={({ item, index }) => <FeedCard item={item} index={index} filter={filter} />}
      ItemSeparatorComponent={Sep} ListHeaderComponent={top} ListEmptyComponent={empty}
      ListFooterComponent={more ? <ActivityIndicator color={C.lilac} style={{ marginVertical: S.lg }} /> : <View style={{ height: S.xl }} />}
      onEndReached={loadMore} onEndReachedThreshold={0.6} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false} initialNumToRender={4} windowSize={7} testID="feed" />
  );
}
const Sep = () => <View style={{ height: S.md }} />;

function openSeller(it: FeedItem, index: number, filter: VerifiedFilter) {
  haptic.tap(); track('feed_item_clicked', { target: 'seller', position: index, verified: it.seller.verified, filter });
  router.push({ pathname: '/t/[store]', params: { store: it.seller.store_slug } });
}
function openItem(it: FeedItem, index: number, filter: VerifiedFilter, target: 'product' | 'cta') {
  haptic.tap(); track('feed_item_clicked', { target, position: index, verified: it.seller.verified, filter });
  router.push({ pathname: '/p/[slug]', params: { slug: it.slug } });
}

export const FeedCard = memo(function FeedCard({ item: it, index, filter }: { item: FeedItem; index: number; filter: VerifiedFilter }) {
  const [broken, setBroken] = useState(false);
  return (
    <View style={s.card} testID="feed-card">
      <View style={s.cardHead}>
        <Pressable onPress={() => openSeller(it, index, filter)} accessibilityRole="link" accessibilityLabel={`Ver el perfil de ${it.seller.display_name}`}
          hitSlop={4} style={({ pressed }) => [s.who, pressed && { opacity: 0.8 }]}>
          <StoreAvatar store={it.seller} size={40} />
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={[T.headline, { flexShrink: 1 }]} numberOfLines={1}>{it.seller.display_name}</Text>
              {it.seller.verified ? <VerifiedBadge size={16} /> : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.xs }}>
              <StarsInline avg={it.seller.rating_avg} count={it.seller.rating_count} />
              <Text style={T.footnote}>·</Text>
              <Text style={T.footnote} numberOfLines={1}>{timeAgo(it.created_at)}</Text>
            </View>
          </View>
        </Pressable>
      </View>
      <Pressable onPress={() => openItem(it, index, filter, 'product')} accessibilityRole="link" accessibilityLabel={`${it.title}, ${formatCRC(it.price_crc)}`}
        style={({ pressed }) => [pressTransition, pressed && { opacity: 0.92 }]}>
        {it.photo && !broken
          ? <Image source={{ uri: it.photo }} style={s.photo} resizeMode="cover" onError={() => setBroken(true)} accessibilityIgnoresInvertColors />
          : <View style={[s.photo, s.noPhoto]}><Icon name="image-outline" size={40} color={C.lilac} /></View>}
      </Pressable>
      <View style={s.cardBody}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={T.body} numberOfLines={2}>{it.title}</Text>
          <Text style={T.moneySm} numberOfLines={1}>{formatCRC(it.price_crc)}</Text>
        </View>
        <Pressable onPress={() => openItem(it, index, filter, 'cta')} accessibilityRole="button" accessibilityLabel={`Comprar ${it.title}`}
          style={({ pressed }) => [s.cta, pressTransition, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}>
          <Icon name="bag-handle-outline" size={18} color={C.purpleDark} />
          <Text style={s.ctaText}>Comprar</Text>
        </Pressable>
      </View>
    </View>
  );
});

export function FeedSkeleton() {
  return (
    <View style={s.card} testID="feed-skeleton">
      <View style={[s.cardHead, { gap: S.sm, flexDirection: 'row', alignItems: 'center' }]}>
        <Skeleton w={40} h={40} r={20} /><View style={{ flex: 1, gap: 6 }}><Skeleton w="50%" h={14} /><Skeleton w="35%" h={12} /></View>
      </View>
      <Skeleton h={220} r={0} />
      <View style={[s.cardBody, { gap: S.sm }]}><View style={{ flex: 1, gap: 6 }}><Skeleton w="70%" h={14} /><Skeleton w="40%" h={18} /></View><Skeleton w={110} h={TOUCH} r={R.pill} /></View>
    </View>
  );
}

function EmptyState({ icon, title, text, actions }: { icon: IconName; title: string; text: string; actions?: ReactElement }) {
  return (
    <View style={s.empty} testID="feed-empty">
      <View style={s.emptyIcon}><Icon name={icon} size={34} color={C.lilac} /></View>
      <Text style={[T.title, { textAlign: 'center' }]}>{title}</Text>
      <Text style={[T.callout, { textAlign: 'center' }]}>{text}</Text>
      {actions ? <View style={{ alignSelf: 'stretch', gap: S.sm, marginTop: S.xs }}>{actions}</View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: S.sm, backgroundColor: C.surface, borderRadius: R.md, paddingLeft: S.md, minHeight: TOUCH + 4, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  searchInput: { flex: 1, minWidth: 0, color: C.text, fontFamily: Fonts.regular, fontSize: 16, minHeight: TOUCH + 4, paddingVertical: 0, outlineStyle: 'none' } as any,
  clear: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', gap: S.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 14, borderRadius: R.pill, borderWidth: 1, borderColor: 'rgba(201,182,255,0.4)' },
  chipOn: { backgroundColor: C.lilac, borderColor: C.lilac },
  chipText: { fontFamily: Fonts.bold, fontSize: 14, color: C.lilac },
  card: { backgroundColor: C.surface, borderRadius: R.lg, overflow: 'hidden', borderWidth: 0.5, borderColor: C.line },
  cardHead: { padding: S.sm + 4 },
  who: { flexDirection: 'row', alignItems: 'center', gap: S.sm, alignSelf: 'flex-start', maxWidth: '100%' },
  photo: { width: '100%', aspectRatio: 4 / 3, backgroundColor: C.lilacBg },
  noPhoto: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { flexDirection: 'row', alignItems: 'center', gap: S.sm, padding: S.sm + 4 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TOUCH, paddingHorizontal: S.md, borderRadius: R.pill, backgroundColor: C.lilac },
  ctaText: { fontFamily: Fonts.bold, fontSize: 15, color: C.purpleDark },
  empty: { alignItems: 'center', gap: S.sm, paddingVertical: S.lg, paddingHorizontal: S.sm },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center', marginBottom: S.xs },
});
