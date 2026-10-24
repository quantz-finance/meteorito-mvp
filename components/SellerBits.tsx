// Piezas del vendedor que comparten el feed de Comprar y el perfil público: check de verificado y estrellas.
import { Text, View } from 'react-native';
import { Icon } from '@/components/ds';
import { C, S, T } from '@/constants/theme';

export const VERIFIED_COLOR = '#5CC8FF';
/** Check de "vendedor verificado" (icono, no emoji). */
export function VerifiedBadge({ size = 16 }: { size?: number }) {
  return <View accessible accessibilityRole="image" accessibilityLabel="Vendedor verificado" testID="verified-badge"><Icon name="checkmark-circle" size={size} color={VERIFIED_COLOR} /></View>;
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
