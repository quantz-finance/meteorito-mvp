// Comprar › Mis compras (/comprar/compras; comprador, con o sin cuenta): las compras de ESTE dispositivo (registro local, PIN guardado, pedido propio
// de cada producto) y, con llave de invitado o sesión, las del servidor (/api/store action 'buyer_orders': solo las de
// esta llave o esta cuenta). Activas primero; cerradas detrás de un selector. Cada fila abre su seguimiento /p/<pedido>.
import { AppearSub } from '@/components/Appear';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { GridPager } from '@/components/GridPager';
import { Card, Chip, haptic, Icon, PrimaryButton, Screen, SkeletonCard, statusTone } from '@/components/ds';
import { C, R, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { formatCRC } from '@/lib/orders';
import { loadMyPurchases } from '@/lib/myPurchases';
import {
  MY_PURCHASES_ACTIVE, MY_PURCHASES_CLOSED, MY_PURCHASES_EMPTY, MY_PURCHASES_TO_FEED, MY_PURCHASES_NONE_ACTIVE, MY_PURCHASES_TITLE,
  purchaseA11y, purchaseNext, purchaseStatus, readLocalPurchases, splitPurchases, type PurchaseRow,
} from '@/lib/purchases';
import { useStableWindow } from '@/lib/viewport';
import { ComprarNav, GUEST_BACK, useIsGuest } from '@/components/ComprarNav';
import { BuyerInboxRow } from '@/components/ChatInbox';

function PurchaseCard({ r }: { r: PurchaseRow }) {
  return (
    <Card testID="purchase-row" accessibilityLabel={purchaseA11y(r)} onPress={() => router.push({ pathname: '/p/[slug]', params: { slug: r.slug } })}
      style={{ flex: 1, justifyContent: 'center', padding: S.sm + 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm + 4 }}>
        {r.photo ? <Image source={{ uri: r.photo }} style={s.thumb} resizeMode="cover" accessibilityIgnoresInvertColors />
          : <View style={[s.thumb, s.noPhoto]}><Icon name="bag-handle" size={24} color={C.lilac} /></View>}
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
            <Text style={[T.headline, { flex: 1 }]} numberOfLines={1}>{r.title}</Text>
            <Text style={[T.headline, { fontVariant: ['tabular-nums'] }]}>{formatCRC(r.price_crc)}</Text>
          </View>
          <View style={{ flexDirection: 'row' }}><Chip label={purchaseStatus(r)} tone={statusTone(r.status ?? '')} /></View>
          <Text style={T.footnote} numberOfLines={2}>{purchaseNext(r)}</Text>
        </View>
        <Icon name="chevron-forward" size={18} color={C.textDim} />
      </View>
    </Card>
  );
}

export default function MisCompras() {
  const guest = useIsGuest(); // sin cuenta: sin barra de pestañas, Volver arriba a la izquierda
  const auth = useAuth();
  const short = useStableWindow().height < 740;
  const [rows, setRows] = useState<PurchaseRow[] | null>(null);
  const [tab, setTab] = useState<'active' | 'closed' | null>(null);
  const load = useCallback(() => {
    setRows((prev) => prev ?? (readLocalPurchases().length ? readLocalPurchases() : null)); // lo de este dispositivo, al instante
    let live = true;
    loadMyPurchases(auth).then((r) => { if (live) setRows(r.rows); }).catch(() => { if (live) setRows((p) => p ?? []); });
    return () => { live = false; };
  }, [auth.isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(load);

  const { active, closed } = splitPurchases(rows ?? []);
  const view = tab ?? (active.length || !closed.length ? 'active' : 'closed');
  const list = view === 'active' ? active : closed;
  const seg = (k: 'active' | 'closed', label: string, n: number) => (
    <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: view === k }} aria-selected={view === k} accessibilityLabel={`${label}, ${n}`}
      onPress={() => { haptic.tap(); setTab(k); }} style={[s.seg, view === k && s.segOn]}>
      <Text style={[T.headline, { color: view === k ? C.purpleDark : C.lilac }]}>{label} · {n}</Text>
    </Pressable>
  );

  return (
    <Screen back={guest ? GUEST_BACK : undefined} backTop title={MY_PURCHASES_TITLE} scroll={false} right={<ComprarNav active="compras" />}>
      <AppearSub style={{ flex: 1, gap: S.sm }}>
        <BuyerInboxRow />
        {rows === null ? <><SkeletonCard /><SkeletonCard /></>
          : active.length + closed.length === 0 ? (
            <Card style={{ alignItems: 'center', paddingVertical: S.xl, gap: S.md }}>
              <Icon name="bag-handle" size={40} color={C.lilac} />
              <Text testID="purchases-empty" style={[T.callout, { textAlign: 'center' }]}>{MY_PURCHASES_EMPTY}</Text>
              <PrimaryButton title={MY_PURCHASES_TO_FEED} icon="storefront-outline" variant="secondary" testID="purchases-to-feed" onPress={() => router.replace('/comprar')} />
            </Card>
          ) : <>
            <View accessibilityRole="tablist" style={s.segs}>{seg('active', MY_PURCHASES_ACTIVE, active.length)}{seg('closed', MY_PURCHASES_CLOSED, closed.length)}</View>
            {list.length === 0 ? <Text style={[T.callout, { textAlign: 'center', paddingVertical: S.lg }]}>{MY_PURCHASES_NONE_ACTIVE}</Text>
              : <GridPager items={list} keyOf={(r) => r.slug} minCellW={300} minCellH={short ? 92 : 100} maxCols={2} label="Página de compras"
                  renderItem={(r) => <PurchaseCard r={r} />} />}
          </>}
      </AppearSub>
    </Screen>
  );
}

const s = StyleSheet.create({
  thumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: C.lilacBg },
  noPhoto: { alignItems: 'center', justifyContent: 'center' },
  segs: { flexDirection: 'row', gap: S.xs, backgroundColor: C.surface, borderRadius: R.md, padding: 4, borderWidth: 0.5, borderColor: C.line },
  seg: { flex: 1, minHeight: 40, borderRadius: R.md - 4, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: C.lilac },
});
