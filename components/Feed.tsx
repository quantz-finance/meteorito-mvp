// Feed de Comprar (tipo red social): publicaciones de los vendedores en una cuadrícula de 2 columnas, lo más nuevo primero,
// con buscador, filtro por identidad en dos mitades iguales (Identidad confirmada por defecto / Sin confirmar; textos en
// lib/copy.ts), paginación infinita por cursor, skeletons y estados vacíos. Lecturas públicas: GET /api/store?feed.
// Ventas cerradas: hoy solo EJEMPLOS ficticios con etiqueta "Ejemplo" (lib/feedSales.ts, FEED_DEMO_SALES), 1 de cada 6.
import { COPY } from '@/lib/copy';
import { router } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { haptic, Icon, PrimaryButton, Sheet, Skeleton, type IconName } from '@/components/ds';
import { StoreAvatar } from '@/components/StoreAvatar';
import { FollowButton } from '@/components/FollowButton';
import { StarRow, VerifiedBadge } from '@/components/SellerBits';
import { pressTransition } from '@/constants/motion';
import { Fonts } from '@/constants/Colors';
import { C, R, S, T, TOUCH } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { formatCRC } from '@/lib/orders';
import { FEED_ERROR, getFeed, type FeedItem, type VerifiedFilter } from '@/lib/store';
import { useAuth } from '@/lib/cavos';
import { followsSome, loadFollowing } from '@/lib/follows';
import { isSale, mixFeed, saleHeadline, saleLabel, saleStars, type SalePost } from '@/lib/feedSales';

export const SEARCH_DEBOUNCE_MS = 300;
const PAGE = 10;
/** Dos mitades iguales: Identidad confirmada / Sin confirmar. */
const FILTERS: { key: VerifiedFilter; label: string }[] = [
  { key: 'true', label: COPY.filters.confirmed }, { key: 'false', label: COPY.filters.unconfirmed },
];
const other = (f: VerifiedFilter) => FILTERS.find((x) => x.key !== f)!;
type Cell = FeedItem | SalePost | { kind: 'filler'; id: string };

export function Feed({ header }: { header: ReactElement }) {
  const [filter, setFilter] = useState<VerifiedFilter>('true');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [more, setMore] = useState(false);
  const [example, setExample] = useState(false);
  const req = useRef(0);
  const viewed = useRef(false);
  const auth = useAuth();
  // Algoritmo: si sigues a alguien, el feed se pide personalizado (sus productos suben); si no, el mismo para todos.
  const personal = async () => { await loadFollowing(auth); return followsSome() ? auth : null; };

  // Debounce del buscador (~300 ms): no se pide nada por cada tecla.
  useEffect(() => { const id = setTimeout(() => setQ(text.trim()), SEARCH_DEBOUNCE_MS); return () => clearTimeout(id); }, [text]);

  const load = useCallback(async () => {
    const id = ++req.current;
    setPhase('loading'); setItems([]); setCursor(null);
    try {
      const page = await getFeed({ q, verified: filter, limit: PAGE, personal: await personal() });
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
      const page = await getFeed({ q, verified: filter, cursor, limit: PAGE, personal: await personal() });
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
        <TextInput style={s.searchInput} value={text} onChangeText={setText} placeholder={COPY.feed.searchPlaceholder} placeholderTextColor={C.textDim}
          accessibilityLabel={COPY.feed.searchLabel} autoCapitalize="none" autoCorrect={false} returnKeyType="search" enterKeyHint="search" maxLength={60}
          onSubmitEditing={() => setQ(text.trim())} />
        {text ? <Pressable onPress={clear} accessibilityRole="button" accessibilityLabel={COPY.feed.clear} hitSlop={10} style={s.clear}>
          <Icon name="close-circle" size={20} color={C.textDim} /></Pressable> : null}
      </View>
      <View style={s.seg} accessibilityRole="tablist" testID="feed-filter">
        {FILTERS.map((f) => {
          const on = f.key === filter;
          return (
            <Pressable key={f.key} onPress={() => pick(f.key)} accessibilityRole="tab" accessibilityState={{ selected: on }} aria-selected={on} accessibilityLabel={f.label}
              style={({ pressed }) => [s.segBtn, on && s.segOn, pressed && { opacity: 0.85 }]}>
              <Text style={[s.segText, on && { color: C.purpleDark }]} numberOfLines={1}>{f.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={T.caption}>{q ? COPY.feed.results : COPY.feed.latest}</Text>
    </View>
  );

  let empty: ReactElement | null = null;
  if (phase === 'loading') empty = <View style={{ gap: S.md }}><FeedSkeleton /><FeedSkeleton /></View>;
  else if (phase === 'error') empty = <EmptyState icon="cloud-offline-outline" title="No pudimos cargar el feed" text={FEED_ERROR} actions={<PrimaryButton title="Reintentar" icon="refresh" variant="secondary" onPress={load} />} />;
  else if (q) empty = (
    <EmptyState icon="search" title={`No encontramos “${q.length > 24 ? q.slice(0, 24) + '…' : q}”`}
      text="Puede que esté en la otra lista. También puedes probar con una palabra más general, por ejemplo “consola” o “bici”."
      actions={<>
        <PrimaryButton title={COPY.feed.searchOther(other(filter).label)} icon="swap-horizontal" onPress={() => setFilter(other(filter).key)} />
        <PrimaryButton title={COPY.feed.clear} icon="close" variant="secondary" onPress={clear} />
        <PrimaryButton title="Pídeselo a un vendedor" icon="paper-plane-outline" variant="ghost" onPress={() => router.push('/i/nueva')} />
      </>} />
  );
  else if (filter === 'true') empty = (
    <EmptyState icon="checkmark-circle" title={COPY.feed.emptyConfirmedTitle}
      text={COPY.feed.emptyConfirmedText}
      actions={<PrimaryButton title={COPY.feed.seeUnconfirmed} icon="swap-horizontal" onPress={() => setFilter('false')} />} />
  );
  else empty = (
    <EmptyState icon="planet-outline" title="Todavía no hay publicaciones"
      text="Mira la lista de Identidad confirmada o vuelve en un rato. ¿Buscas algo? Pídeselo a un vendedor."
      actions={<>
        <PrimaryButton title={COPY.feed.seeConfirmed} icon="swap-horizontal" onPress={() => setFilter('true')} />
        <PrimaryButton title="Invitar a un vendedor" icon="paper-plane-outline" variant="secondary" onPress={() => router.push('/i/nueva')} />
      </>} />
  );

  // Ventas cerradas de ejemplo mezcladas (1 de cada 6, mismo filtro); relleno invisible si queda una sola en la última fila.
  const mixed: Cell[] = phase === 'ready' ? mixFeed<FeedItem>(items, filter, q) : [];
  const cells: Cell[] = mixed.length % 2 ? [...mixed, { kind: 'filler', id: 'filler' }] : mixed;
  return (
    <>
    <FlatList data={cells} keyExtractor={(i) => ('slug' in i ? i.slug : i.id)} style={{ flex: 1 }} numColumns={2} columnWrapperStyle={s.row}
      renderItem={({ item, index }) => 'slug' in item ? <FeedCard item={item} index={index} filter={filter} />
        : isSale(item) ? <SaleCard post={item} onPress={() => { haptic.tap(); track('feed_item_clicked', { target: 'sale_example', position: index, verified: item.verified, filter }); setExample(true); }} />
        : <View style={s.cell} />}
      ItemSeparatorComponent={Sep} ListHeaderComponent={top} ListEmptyComponent={empty}
      ListFooterComponent={more ? <ActivityIndicator color={C.lilac} style={{ marginVertical: S.lg }} /> : <View style={{ height: S.xl }} />}
      onEndReached={loadMore} onEndReachedThreshold={0.6} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false} initialNumToRender={6} windowSize={7} testID="feed" />
    <Sheet visible={example} onClose={() => setExample(false)} title={COPY.sales.sheetTitle}
      footer={<PrimaryButton title={COPY.sales.sheetOk} icon="checkmark" onPress={() => setExample(false)} />}>
      <Text style={T.callout}>{COPY.sales.sheetText}</Text>
    </Sheet>
    </>
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

/** Tarjeta compacta (media columna): foto, título, precio y vendedor con su check de identidad. */
export const FeedCard = memo(function FeedCard({ item: it, index, filter }: { item: FeedItem; index: number; filter: VerifiedFilter }) {
  const [broken, setBroken] = useState(false);
  return (
    <View style={[s.cell, s.card]} testID="feed-card">
      <Pressable onPress={() => openItem(it, index, filter, 'product')} accessibilityRole="link" accessibilityLabel={`${it.title}, ${formatCRC(it.price_crc)}`}
        style={({ pressed }) => [pressTransition, pressed && { opacity: 0.92 }]}>
        {it.photo && !broken
          ? <Image source={{ uri: it.photo }} style={s.photo} resizeMode="cover" onError={() => setBroken(true)} accessibilityIgnoresInvertColors />
          : <View style={[s.photo, s.noPhoto]}><Icon name="image-outline" size={32} color={C.lilac} /></View>}
        <View style={s.cardBody}>
          <Text style={s.title} numberOfLines={2}>{it.title}</Text>
          <Text style={T.moneySm} numberOfLines={1}>{formatCRC(it.price_crc)}</Text>
        </View>
      </Pressable>
      <View style={s.follow}><FollowButton store={it.seller} source="feed" size="sm" /></View>
      <Pressable onPress={() => openSeller(it, index, filter)} accessibilityRole="link" accessibilityLabel={`Ver el perfil de ${it.seller.display_name}`}
        hitSlop={4} style={({ pressed }) => [s.who, pressed && { opacity: 0.8 }]}>
        <StoreAvatar store={it.seller} size={22} />
        <Text style={[T.footnote, { color: C.text, flexShrink: 1 }]} numberOfLines={1}>{it.seller.display_name}</Text>
        {it.seller.verified ? <VerifiedBadge size={14} /> : null}
      </Pressable>
    </View>
  );
});

/** Venta cerrada (hoy solo ejemplos ficticios): foto, quién le vendió a quién, estrellas y comentario. Sin montos. */
export const SaleCard = memo(function SaleCard({ post: p, onPress }: { post: SalePost; onPress: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={saleLabel(p)} testID="feed-sale"
      style={({ pressed }) => [s.cell, s.card, pressTransition, pressed && { opacity: 0.92 }]}>
      <View>
        {p.photo && !broken
          ? <Image source={{ uri: p.photo }} style={s.photo} resizeMode="cover" onError={() => setBroken(true)} accessibilityIgnoresInvertColors />
          : <View style={[s.photo, s.noPhoto]}><Icon name={p.icon as IconName} size={40} color={C.lilac} /></View>}
        <View style={s.example} testID="feed-sale-example"><Text style={s.exampleText}>{COPY.sales.example}</Text></View>
      </View>
      <View style={s.cardBody}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name="bag-check-outline" size={14} color={C.success} />
          <Text style={[T.footnote, { color: C.text, flexShrink: 1 }]} numberOfLines={2}>{saleHeadline(p)}</Text>
          {p.verified ? <VerifiedBadge size={14} /> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <StarRow value={p.stars} size={13} />
          <Text style={T.footnote} numberOfLines={1}>{saleStars(p.stars)}</Text>
        </View>
        {p.comment ? <Text style={[T.footnote, { fontStyle: 'italic' }]} numberOfLines={2}>“{p.comment}”</Text> : null}
      </View>
    </Pressable>
  );
});

export function FeedSkeleton() {
  const half = (
    <View style={[s.cell, s.card]} testID="feed-skeleton">
      <Skeleton h={150} r={0} />
      <View style={[s.cardBody, { gap: 6 }]}><Skeleton w="85%" h={14} /><Skeleton w="50%" h={16} /><Skeleton w="60%" h={12} /></View>
    </View>
  );
  return <View style={s.row}>{half}{half}</View>;
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
  // Filtro: dos mitades iguales (mismo ancho y alto).
  seg: { flexDirection: 'row', padding: 3, gap: 3, borderRadius: R.pill, borderWidth: 1, borderColor: 'rgba(201,182,255,0.4)' },
  segBtn: { flex: 1, flexBasis: 0, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: TOUCH, paddingHorizontal: 2, borderRadius: R.pill },
  segOn: { backgroundColor: C.lilac },
  segText: { fontFamily: Fonts.bold, fontSize: 14, color: C.lilac, flexShrink: 1 },
  // Cuadrícula de 2 columnas: cada celda es la mitad (flexBasis 0), también la última si queda sola (relleno invisible).
  row: { flexDirection: 'row', gap: S.sm },
  cell: { flex: 1, flexBasis: 0, minWidth: 0 },
  card: { backgroundColor: C.surface, borderRadius: R.lg, overflow: 'hidden', borderWidth: 0.5, borderColor: C.line },
  who: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: S.sm, paddingBottom: S.sm, minHeight: 32 },
  photo: { width: '100%', aspectRatio: 1, backgroundColor: C.lilacBg },
  noPhoto: { alignItems: 'center', justifyContent: 'center' },
  follow: { position: 'absolute', top: 6, right: 6 },
  cardBody: { gap: 2, paddingHorizontal: S.sm, paddingTop: S.sm, paddingBottom: S.xs + 2 },
  title: { fontFamily: Fonts.regular, fontSize: 15, lineHeight: 19, color: C.text },
  example: { position: 'absolute', top: 6, left: 6, paddingHorizontal: 7, paddingVertical: 2, borderRadius: R.pill, backgroundColor: 'rgba(20,10,40,0.72)' },
  exampleText: { fontFamily: Fonts.bold, fontSize: 12, color: C.text, letterSpacing: 0.3 },
  empty: { alignItems: 'center', gap: S.sm, paddingVertical: S.lg, paddingHorizontal: S.sm },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center', marginBottom: S.xs },
});
