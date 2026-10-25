// Home: resumen + "Tus ventas" (cuadro con el meteorito) + "Tus compras". Filas compactas: miniatura, título, precio y UNA
// pastilla corta de estado. Lo que te toca va primero y resaltado (borde naranja). Sin línea de tiempo ni acciones: tocar una
// venta abre su hoja (la de siempre) y tocar una compra abre su seguimiento /p/<pedido>.
import { router } from 'expo-router';
import { memo, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Chip, haptic, Icon, PrimaryButton, Skeleton } from '@/components/ds';
import { categoryIcon } from '@/components/categoryIcons';
import { LivelyMascot } from '@/components/space';
import { anim, pressTransition } from '@/constants/motion';
import { C, R, S, T } from '@/constants/theme';
import { formatCRC, orderTitle, type SellerOrder } from '@/lib/orders';
import { buyPill, HOME_COPY, type HomeSummary, type Pill, salePill } from '@/lib/home';
import { MY_PURCHASES_EMPTY, MY_PURCHASES_TO_FEED, type PurchaseRow } from '@/lib/purchases';
import { ratingLabel } from '@/lib/rating';

/** Alto de una fila y separación (Home reparte las filas que caben sin scroll: lib/home allocateRows). */
export const ROW_H = 50;
export const ROW_GAP = 6;
/** Alto fijo de cada cuadro además de sus filas (encabezado, márgenes) y de los vacíos. */
export const SALES_CHROME = 20 + 24 + ROW_GAP;
export const BUYS_CHROME = 24 + ROW_GAP;
export const SALES_EMPTY_H = 20 + 24 + ROW_GAP + 20 + S.sm + 50;
export const BUYS_EMPTY_H = 24 + ROW_GAP + 62;

const safePhoto = (p?: string | null) => (typeof p === 'string' && /^(https:\/\/|data:image\/|\/(?!\/))/.test(p) ? p : null);

const Row = memo(function Row({ title, price, photo, icon, pill, onPress, testID, tint }: {
  title: string; price: number; photo: string | null; icon: React.ComponentProps<typeof Icon>['name']; pill: Pill; onPress: () => void; testID: string; tint?: boolean;
}) {
  return (
    <Pressable testID={pill.todo ? `${testID}-todo` : testID} accessibilityRole="button" accessibilityLabel={`${title}, ${formatCRC(price)}, ${pill.label}${pill.todo ? `, ${HOME_COPY.todo.toLowerCase()}` : ''}`}
      onPress={() => { haptic.tap(); onPress(); }}
      style={({ pressed }) => [s.row, tint ? s.rowInBox : s.rowCard, pill.todo && s.rowTodo, pressTransition, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
      {photo ? <Image source={{ uri: photo }} style={s.thumb} resizeMode="cover" accessibilityIgnoresInvertColors />
        : <View style={[s.thumb, s.noPhoto]}><Icon name={icon} size={20} color={C.lilac} /></View>}
      {/* Título y precio arriba; la pastilla abajo con todo el ancho (cabe "Al recibir, dale tu código" en iPhone SE) */}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
          <Text style={[s.title, { flex: 1 }]} numberOfLines={1}>{title}</Text>
          <Text style={s.price}>{formatCRC(price)}</Text>
        </View>
        <Chip key={pill.label} swap label={pill.label} tone={pill.tone} icon={pill.todo ? 'alert-circle' : undefined} />
      </View>
    </Pressable>
  );
});

export const SaleRow = ({ o, onPress }: { o: SellerOrder; onPress: () => void }) =>
  <Row testID="home-sale-row" tint title={orderTitle(o)} price={o.price_crc} photo={safePhoto(o.photo ?? o.photos?.[0])} icon={categoryIcon(o.category)} pill={salePill(o)} onPress={onPress} />;
export const BuyRow = ({ r }: { r: PurchaseRow }) =>
  <Row testID="home-buy-row" title={r.title} price={r.price_crc} photo={safePhoto(r.photo)} icon="bag-handle" pill={buyPill(r)}
    onPress={() => router.push({ pathname: '/p/[slug]', params: { slug: r.slug } })} />;

function Head({ title, children, color = C.textDim, padRight = 0 }: { title: string; children?: ReactNode; color?: string; padRight?: number }) {
  return <View style={[s.head, { paddingRight: padRight }]}><Text style={[T.caption, { color, flexShrink: 0 }]} numberOfLines={1}>{title}</Text><View style={s.headRight}>{children}</View></View>;
}
function HeadLink({ label, a11y, onPress }: { label: string; a11y?: string; onPress: () => void }) {
  return (
    <Pressable onPress={() => { haptic.tap(); onPress(); }} accessibilityRole="button" accessibilityLabel={a11y ?? label} hitSlop={10}
      style={({ pressed }) => [s.link, pressed && { opacity: 0.7 }]}>
      <Text style={[T.footnote, { color: C.lilac, fontFamily: T.headline.fontFamily }]} numberOfLines={1}>{label}</Text>
      <Icon name="chevron-forward" size={14} color={C.lilac} />
    </Pressable>
  );
}
const Skel = ({ n }: { n: number }) => <>{Array.from({ length: n }, (_, i) => <View key={i} style={[s.row, s.rowCard]}><Skeleton w={40} h={40} r={12} /><View style={{ flex: 1, gap: 6 }}><Skeleton w="60%" h={14} /><Skeleton w="35%" h={12} /></View></View>)}</>;

/** Resumen de arriba: 3 números reales (por hacer, ventas y compras en curso) + calificación y lo cobrado si existen. */
export function HomeSummaryCard({ sum, rating }: { sum: HomeSummary; rating: { rating_avg: number | null; rating_count: number } | null }) {
  const stats = [
    { label: HOME_COPY.todo, n: sum.todo, hot: sum.todo > 0 },
    { label: HOME_COPY.salesActive, n: sum.salesActive },
    { label: HOME_COPY.buysActive, n: sum.buysActive },
  ];
  const extra = [rating && rating.rating_count > 0 ? ratingLabel(rating) : null, sum.collected > 0 ? `${formatCRC(sum.collected)} ${HOME_COPY.collected}` : null].filter(Boolean) as string[];
  return (
    <View style={s.summary} testID="home-summary" accessibilityLabel="Resumen">
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        {stats.map((st) => (
          <View key={st.label} style={[s.stat, st.hot && s.statHot]} accessibilityLabel={`${st.label}: ${st.n}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {st.hot ? <Icon name="alert-circle" size={16} color={C.orange} /> : null}
              <Text style={[s.n, st.hot && { color: C.orange }]}>{st.n}</Text>
            </View>
            <Text style={T.footnote} numberOfLines={1}>{st.label}</Text>
          </View>
        ))}
      </View>
      {extra.length ? <View style={s.extra}>
        {rating && rating.rating_count > 0 ? <Icon name="star" size={13} color={C.orange} /> : <Icon name="receipt-outline" size={13} color={C.lilac} />}
        <Text style={[T.footnote, { flex: 1 }]} numberOfLines={2}>{extra.join(' · ')}</Text>
      </View> : null}
    </View>
  );
}

/** "Tus ventas": cuadro morado con el meteorito asomándose arriba a la derecha (decorativo). */
export function SalesBox({ rows, total, loading, onOpen, onHistory, onSeeAll, compact }: {
  rows: SellerOrder[]; total: number; loading: boolean; onOpen: (slug: string) => void; onHistory: () => void; onSeeAll: () => void; compact?: boolean;
}) {
  return (
    <View style={s.box} accessibilityLabel={HOME_COPY.sales}>
      <View pointerEvents="none" testID="ventas-mascot" {...anim('bob')} style={s.mascot}>
        <LivelyMascot size={compact ? 40 : 46} parallax={0} />
      </View>
      <Head title={HOME_COPY.sales} color={C.lilac} padRight={compact ? 34 : 40}>
        {total > rows.length ? <HeadLink label={HOME_COPY.seeAll(total)} a11y={`${HOME_COPY.seeAll(total)} (ventas)`} onPress={onSeeAll} /> : null}
        <HeadLink label="Historial" a11y="Ver historial de ventas" onPress={onHistory} />
      </Head>
      {loading ? <Skel n={2} /> : total === 0 ? (
        <View style={{ gap: S.sm }} testID="sales-empty">
          <Text style={T.callout} numberOfLines={1}>{HOME_COPY.salesEmpty}</Text>
          <PrimaryButton title="Crear link de venta" icon="add" onPress={() => router.push('/vender')} />
        </View>
      ) : rows.map((o) => <SaleRow key={o.slug} o={o} onPress={() => onOpen(o.slug)} />)}
    </View>
  );
}

/** "Tus compras": misma fila, sobre tarjeta. "Ver todas" lleva a Mis compras. */
export function BuysSection({ rows, total, loading }: { rows: PurchaseRow[]; total: number; loading: boolean }) {
  return (
    <View style={{ gap: ROW_GAP }} accessibilityLabel={HOME_COPY.buys}>
      <Head title={HOME_COPY.buys}>
        {total > rows.length ? <HeadLink label={HOME_COPY.seeAll(total)} a11y={`${HOME_COPY.seeAll(total)} (compras)`} onPress={() => router.push('/comprar/compras')} /> : null}
      </Head>
      {loading ? <Skel n={1} /> : total === 0 ? (
        <View style={[s.rowCard, s.emptyBuys]} testID="buys-empty">
          <Icon name="bag-handle" size={22} color={C.lilac} />
          <Text style={[T.callout, { flex: 1 }]} numberOfLines={2}>{MY_PURCHASES_EMPTY}</Text>
          <Pressable onPress={() => { haptic.tap(); router.push('/comprar'); }} accessibilityRole="button" accessibilityLabel={MY_PURCHASES_TO_FEED} hitSlop={6}
            style={({ pressed }) => [s.pill, pressed && { opacity: 0.8 }]}>
            <Text style={[T.footnote, { color: C.lilac, fontFamily: T.headline.fontFamily }]}>{MY_PURCHASES_TO_FEED}</Text>
          </Pressable>
        </View>
      ) : rows.map((r) => <BuyRow key={r.slug} r={r} />)}
    </View>
  );
}

const s = StyleSheet.create({
  summary: { backgroundColor: C.surface, borderRadius: R.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, padding: S.sm, gap: 6 },
  stat: { flex: 1, minWidth: 0, borderRadius: R.md - 4, backgroundColor: 'rgba(255,255,255,0.04)', paddingVertical: 5, paddingHorizontal: S.sm, gap: 0 },
  statHot: { backgroundColor: C.warnBg },
  n: { ...T.title, fontSize: 22, lineHeight: 26, fontVariant: ['tabular-nums'] },
  extra: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  box: { overflow: 'hidden', backgroundColor: C.purple, borderWidth: 1, borderColor: 'rgba(255,138,61,0.35)', borderRadius: R.lg, paddingHorizontal: S.sm + 2, paddingVertical: 10, gap: ROW_GAP },
  mascot: { position: 'absolute', right: -2, top: -5 },
  head: { flexDirection: 'row', alignItems: 'center', gap: S.sm, height: 24 },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: S.md, marginLeft: 'auto', paddingRight: 0 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 2, zIndex: 2 },
  row: { height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: S.sm + 2, paddingHorizontal: S.sm, borderRadius: R.md, borderWidth: 1, borderColor: 'transparent' },
  rowInBox: { backgroundColor: 'rgba(16,6,40,0.38)' },
  rowCard: { backgroundColor: C.surface, borderColor: C.line },
  rowTodo: { borderColor: 'rgba(255,138,61,0.75)', backgroundColor: 'rgba(255,138,61,0.12)' },
  thumb: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.lilacBg },
  noPhoto: { alignItems: 'center', justifyContent: 'center' },
  title: { ...T.headline, fontSize: 15, lineHeight: 19 },
  price: { ...T.headline, fontSize: 15, fontVariant: ['tabular-nums'] },
  emptyBuys: { flexDirection: 'row', alignItems: 'center', gap: S.sm + 2, borderRadius: R.md, borderWidth: StyleSheet.hairlineWidth, padding: S.sm + 2 },
  pill: { minHeight: 36, paddingHorizontal: S.md - 4, borderRadius: R.pill, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' },
});
