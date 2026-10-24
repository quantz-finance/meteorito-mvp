// Historial de ventas del vendedor: cada venta con su estado y resultado (cobrado, reembolsado, en curso), más el total
// cobrado. Mismos datos que Home (/api/store action 'orders', con su sesión); sin funciones nuevas.
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { GridPager } from '@/components/GridPager';
import { Card, Chip, ErrorText, Icon, PrimaryButton, Screen, SkeletonCard, statusTone } from '@/components/ds';
import { C, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { userMessage } from '@/lib/cavosSession';
import { formatCRC, getSellerOrders } from '@/lib/orders';
import { HISTORY_EMPTY, HISTORY_TITLE, historyTotals, salesHistory, type SaleRow, shortDate, totalsLine } from '@/lib/sellerTools';
import { supabaseConfigured } from '@/lib/supabase';
import { useStableWindow } from '@/lib/viewport';

const TONE: Record<SaleRow['outcome'], 'success' | 'warn' | 'muted' | 'lilac'> = { cobrado: 'success', parcial: 'warn', reembolsado: 'warn', cancelado: 'muted', en_curso: 'lilac' };

function SaleCard({ r }: { r: SaleRow }) {
  return (
    <Card accessibilityLabel={`${r.title}, ${formatCRC(r.price_crc)}, ${r.statusLabel}, ${r.outcomeLabel}`} style={{ flex: 1, gap: S.xs, padding: S.sm + 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
        <Text style={[T.headline, { flex: 1 }]} numberOfLines={1}>{r.title}</Text>
        <Text style={[T.headline, { fontVariant: ['tabular-nums'] }]}>{formatCRC(r.price_crc)}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, flexWrap: 'wrap' }}>
        <Chip label={r.outcomeLabel} tone={TONE[r.outcome]} />
        {r.closed ? null : <Text style={T.footnote} numberOfLines={1}>{r.statusLabel}</Text>}
        <Text style={[T.footnote, { marginLeft: 'auto' }]}>{shortDate(r.date)}</Text>
      </View>
    </Card>
  );
}

export default function Ventas() {
  const auth = useAuth();
  const short = useStableWindow().height < 740;
  const [rows, setRows] = useState<SaleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    if (!auth.address || !supabaseConfigured) { setRows([]); return; }
    getSellerOrders(auth).then((os) => setRows(salesHistory(os))).catch((e) => setError(userMessage((e as Error).message)));
  }, [auth.address]);
  useEffect(load, [load]);
  const totals = rows ? historyTotals(rows) : null;

  return (
    <Screen title={HISTORY_TITLE} back="/pedidos" scroll={false}>
      <View style={{ flex: 1, gap: S.sm }}>
        {totals ? <Card style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, padding: S.sm + 4 }} accessibilityLabel={totalsLine(totals)}>
          <Icon name="receipt-outline" size={22} color={C.lilac} />
          <View style={{ flex: 1 }}>
            <Text style={[T.title, { fontVariant: ['tabular-nums'] }]}>{formatCRC(totals.collected)}</Text>
            <Text style={T.footnote} numberOfLines={1}>Cobrado · {totals.closed} {totals.closed === 1 ? 'venta cerrada' : 'ventas cerradas'} · {totals.open} en curso</Text>
          </View>
        </Card> : null}
        {error ? <><ErrorText>{error}</ErrorText><PrimaryButton title="Intentar de nuevo" variant="secondary" onPress={load} /></>
          : rows === null ? <><SkeletonCard /><SkeletonCard /><SkeletonCard /></>
          : rows.length === 0 ? (
            <Card style={{ alignItems: 'center', paddingVertical: S.xl, gap: S.md }}>
              <Icon name="receipt-outline" size={40} color={C.lilac} />
              <Text style={[T.callout, { textAlign: 'center' }]}>{HISTORY_EMPTY}</Text>
              <PrimaryButton title="Crear link de venta" icon="add" onPress={() => router.push('/vender')} />
            </Card>
          ) : <GridPager items={rows} keyOf={(r) => r.slug} minCellW={300} minCellH={short ? 70 : 78} maxCols={2} label="Página del historial"
              renderItem={(r) => <SaleCard r={r} />} />}
      </View>
    </Screen>
  );
}
