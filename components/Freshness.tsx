import { StyleSheet, Text, View } from 'react-native';
import { C, T } from '@/constants/theme';
import { memo } from 'react';
import { agoLabel, isStale, useNow, useStampValue, type Stamp } from '@/lib/freshness';
import { POLL_MS } from '@/lib/refresh';

/** Indicador de sincronización con el servidor: punto verde + "Actualizado hace Xs" (ámbar si dejó de actualizar). */
export const Freshness = memo(function Freshness({ stamp, live = true, align = 'flex-start' }: { stamp: Stamp; live?: boolean; align?: 'flex-start' | 'center' | 'flex-end' }) {
  const at = useStampValue(stamp);
  const now = useNow();
  const stale = live && isStale(at, POLL_MS, now);
  return (
    <View style={[s.row, { alignSelf: align }]} accessibilityRole="text" accessibilityLiveRegion="none">
      <View style={[s.dot, { backgroundColor: !at ? C.textDim : stale ? C.orange : C.success }]} />
      <Text style={[T.footnote, stale && { color: C.orange }]}>{stale ? `${agoLabel(at, now)} · reintentando` : agoLabel(at, now)}{live ? ' · se actualiza solo' : ''}</Text>
    </View>
  );
});
const s = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: 6 }, dot: { width: 8, height: 8, borderRadius: 4 } });
