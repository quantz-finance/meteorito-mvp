// Piezas del vendedor que comparten el feed, el perfil público y la ficha: check de identidad, estrellas y ventas.
import { COPY } from '@/lib/copy';
import { Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/ds';
import type { SalesOutcome } from '@/lib/store';
import { activityLabel, type Activity } from '@/lib/activity';
import { C, S, T } from '@/constants/theme';

export const VERIFIED_COLOR = '#5CC8FF';
/** Check de identidad confirmada (icono, no emoji). */
export function VerifiedBadge({ size = 16 }: { size?: number }) {
  return <View accessible accessibilityRole="image" accessibilityLabel={COPY.identity.badge} testID="verified-badge"><Icon name="checkmark-circle" size={size} color={VERIFIED_COLOR} /></View>;
}
/** "4.8 (12)" con estrella, o "Nuevo" si todavía no tiene reseñas. */
export function StarsInline({ avg, count, size = 14 }: { avg: number | null; count: number; size?: number }) {
  const rated = count > 0 && avg != null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }} accessibilityLabel={rated ? `${avg!.toFixed(1)} de 5, ${count} reseña${count === 1 ? '' : 's'}` : 'Vendedor nuevo, sin reseñas'}>
      <Icon name={rated ? 'star' : 'sparkles-outline'} size={size} color={rated ? '#FFD84D' : C.lilac} />
      <Text style={[T.footnote, { color: rated ? C.text : C.textDim }]} numberOfLines={1}>{rated ? `${(Math.round(avg! * 10) / 10).toFixed(1)} (${count})` : 'Nuevo'}</Text>
    </View>
  );
}
/** 5 estrellas (llenas, media y vacías) para el resumen y cada reseña. */
export function StarRow({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: S.xs / 2 }} accessibilityLabel={`${value} de 5 estrellas`}>
      {[1, 2, 3, 4, 5].map((n) => <Icon key={n} name={value >= n ? 'star' : value >= n - 0.5 ? 'star-half' : 'star-outline'} size={size} color={value >= n - 0.5 ? '#FFD84D' : C.textDim} />)}
    </View>
  );
}

/** Cómo salieron las ventas, SIN montos: "22 sin problemas · 1 con disputa resuelta" (+ "en disputa" si hay). */
export function SalesOutcomeLine({ sales, center }: { sales?: SalesOutcome | null; center?: boolean }) {
  if (!sales) return null;
  if (!sales.completed && !sales.disputes_open) return <Text style={[T.footnote, center && { textAlign: 'center' }]}>{COPY.profile.noSalesYet}</Text>;
  const parts: { icon: IconName; text: string; color: string }[] = [
    { icon: 'checkmark-done', text: COPY.profile.noIssues(sales.no_issues), color: C.success },
    ...(sales.disputes_resolved ? [{ icon: 'scale-outline' as IconName, text: COPY.profile.disputesResolved(sales.disputes_resolved), color: C.lilac }] : []),
    ...(sales.disputes_open ? [{ icon: 'alert-circle-outline' as IconName, text: COPY.profile.disputesOpen(sales.disputes_open), color: C.orange }] : []),
  ];
  return (
    <View testID="sales-outcome" accessible accessibilityLabel={`${COPY.profile.outcomesTitle}: ${parts.map((x) => x.text).join(', ')}`}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: center ? 'center' : 'flex-start' }}>
      {parts.map((x) => <View key={x.text} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name={x.icon} size={14} color={x.color} /><Text style={T.footnote}>{x.text}</Text></View>)}
    </View>
  );
}

/** Última conexión del vendedor (rango grueso del API, nunca la hora exacta). En línea: punto verde (ícono). */
export function ActivityLine({ activity, compact = false, center = false }: { activity: Activity | null | undefined; compact?: boolean; center?: boolean }) {
  const label = activityLabel(activity);
  if (!label) return null;
  const online = activity?.k === 'online';
  const size = compact ? 8 : 10;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: compact ? 4 : 6, justifyContent: center ? 'center' : 'flex-start', minWidth: 0 }}
      testID="seller-activity" accessibilityLabel={label}>
      {online ? <Icon name="ellipse" size={size} color={C.success} /> : <Icon name="time-outline" size={compact ? 12 : 14} color={C.textDim} />}
      <Text style={[T.footnote, compact && { fontSize: 12, lineHeight: 16 }, online && { color: C.success }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}
