// Panel de disputas (solo admin): lista con filtros Nuevas / Necesitan decisión / Resueltas, edad, plazo, monto, partes y
// motivo. Denso a propósito (herramienta interna). Quien no es admin ve "No encontramos esta página" (el servidor responde
// 404 a cualquier acción admin). Detalle: /admin/disputa?slug=<pedido>.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, ErrorText, haptic, Icon, PrimaryButton, Screen, SkeletonCard } from '@/components/ds';
import { pressTransition } from '@/constants/motion';
import { Fonts } from '@/constants/Colors';
import { C, R, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { userMessage } from '@/lib/cavosSession';
import { formatCRC } from '@/lib/labels';
import { ageLabel, deadlineLabel, listDisputes, useIsAdmin, type AdminDisputeRow, type AdminList, type DisputeTab } from '@/lib/admin';
import { OUTCOME_LABEL } from '@/api/_lib/disputeRules';
import { AdminNotFound } from '@/components/AdminNotFound';

const TABS: { id: DisputeTab; label: string }[] = [{ id: 'nuevas', label: 'Nuevas' }, { id: 'decidir', label: 'Necesitan decisión' }, { id: 'resueltas', label: 'Resueltas' }];

export default function AdminDisputas() {
  const auth = useAuth();
  const admin = useIsAdmin(auth);
  const q = useLocalSearchParams<{ tab?: string }>();
  const fixed = TABS.some((t) => t.id === q.tab);
  const [tab, setTabState] = useState<DisputeTab>(fixed ? (q.tab as DisputeTab) : 'decidir');
  const [picked, setPicked] = useState(fixed);
  const setTab = (t: DisputeTab) => { setPicked(true); setTabState(t); };
  const [data, setData] = useState<AdminList | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    if (admin !== true) return;
    let live = true;
    listDisputes(auth).then((d) => {
      if (!live) return;
      setData(d); setErr(null);
      // Sin pestaña elegida: abre la primera con trabajo (decidir > nuevas)
      if (!picked && !d.counts.decidir && d.counts.nuevas) setTabState('nuevas');
    }).catch((e) => { if (live) { setErr(userMessage((e as Error).message)); setData((p) => p ?? null); } });
    return () => { live = false; };
  }, [admin])); // eslint-disable-line react-hooks/exhaustive-deps

  if (admin === false) return <AdminNotFound />;
  const rows = (data?.disputes ?? []).filter((r) => r.tab === tab);
  const caps = data?.capabilities;
  return (
    <Screen title="Disputas" back="/pedidos">
      <View style={s.tabs} accessibilityRole="tablist">
        {TABS.map((t) => {
          const on = t.id === tab; const n = data?.counts?.[t.id];
          return (
            <Pressable key={t.id} testID={`tab-${t.id}`} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => { haptic.tap(); setTab(t.id); }}
              style={({ pressed }) => [s.tab, on && s.tabOn, pressTransition, pressed && { opacity: 0.8 }]}>
              <Text style={[s.tabText, on && { color: C.purple }]} numberOfLines={1}>{t.label}{n != null ? ` · ${n}` : ''}</Text>
            </Pressable>
          );
        })}
      </View>
      {data ? <Text testID="admin-flags" style={T.footnote}>
        Auto-resolución: {data.flags.autoResolve ? 'encendida' : 'apagada'} · IA: {caps?.ai ? 'disponible' : 'no disponible'} · On-chain: {caps?.executeOnchain ? 'desde el panel' : 'con el script'}{caps?.responses ? '' : ' · Respuesta del vendedor: falta la migración 027'}
      </Text> : null}
      <Pressable testID="admin-pagos-link" accessibilityRole="link" onPress={() => { haptic.tap(); router.push('/admin/pagos' as never); }}
        style={({ pressed }) => [s.line, { minHeight: 44 }, pressed && { opacity: 0.8 }]}>
        <Icon name="card" size={18} color={C.lilac} />
        <Text style={[T.footnote, { color: C.lilac, flex: 1 }]}>Pagos a Cuenta IBAN</Text>
        <Icon name="chevron-forward" size={16} color={C.lilac} />
      </Pressable>
      {err ? <ErrorText>{err}</ErrorText> : null}
      {admin === null || (!data && !err) ? <><SkeletonCard /><SkeletonCard /></>
        : rows.length === 0 ? <Card style={{ alignItems: 'center', paddingVertical: S.lg }}><Text testID="admin-empty" style={T.callout}>No hay disputas aquí.</Text></Card>
        : <View style={{ gap: S.sm }} testID="admin-list">{rows.map((r) => <Row key={r.slug} r={r} />)}</View>}
    </Screen>
  );
}

function Row({ r }: { r: AdminDisputeRow }) {
  const dl = deadlineLabel(r.deadline);
  const tags: { text: string; tone: 'warn' | 'lilac' | 'success' }[] = [];
  if (r.rule) tags.push({ text: `Regla: ${r.rule.title} · ${OUTCOME_LABEL[r.rule.outcome]}`, tone: 'lilac' });
  if (r.has_response) tags.push({ text: 'Respondió el vendedor', tone: 'success' });
  if (r.decision?.status === 'pending_onchain') tags.push({ text: 'Decidida: falta ejecutar on-chain', tone: 'warn' });
  if (r.decision?.status === 'failed') tags.push({ text: 'La ejecución falló', tone: 'warn' });
  if (r.guest_refund_pending) tags.push({ text: 'Pendiente devolver al comprador', tone: 'warn' });
  const seller = r.seller.name ? `${r.seller.name}${r.seller.store_slug ? ` (@${r.seller.store_slug})` : ''}` : 'Vendedor';
  return (
    <Pressable testID={`dispute-${r.slug}`} accessibilityRole="button" accessibilityLabel={`${r.product}, ${r.reason_label}`}
      onPress={() => { haptic.tap(); router.push(`/admin/disputa?slug=${r.slug}` as never); }}
      style={({ pressed }) => [s.row, pressTransition, pressed && { opacity: 0.85 }]}>
      <View style={s.line}>
        <Text style={[T.headline, { flex: 1, minWidth: 0 }]} numberOfLines={1}>{r.product}</Text>
        <Text style={[T.headline, { fontVariant: ['tabular-nums'] }]}>{formatCRC(r.price_crc)}</Text>
      </View>
      <View style={[s.line, { flexWrap: 'wrap' }]}>
        <Text style={s.pill}>{r.reason_label}</Text>
        <Text style={T.footnote}>{r.slug} · abierta {ageLabel(r.opened_at)}</Text>
        {dl ? <Text style={[T.footnote, dl.late && { color: C.orange }]}>· {dl.text}</Text> : null}
        {r.resolution?.buyerPct != null && r.tab === 'resueltas' ? <Text style={T.footnote}>· comprador {r.resolution.buyerPct}%</Text> : null}
      </View>
      <Text style={T.footnote} numberOfLines={1}>{seller} · comprador {r.buyer.kind} ·{r.buyer.ref}</Text>
      {r.description_preview ? <Text style={[T.footnote, { color: C.text }]} numberOfLines={2}>{r.description_preview}</Text> : null}
      {tags.length ? <View style={[s.line, { flexWrap: 'wrap' }]}>{tags.map((t) => <Text key={t.text} style={[s.tag, t.tone === 'warn' && { color: C.orange, backgroundColor: C.warnBg }, t.tone === 'success' && { color: C.success, backgroundColor: C.successBg }]}>{t.text}</Text>)}</View> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: S.xs },
  tab: { minHeight: 36, paddingHorizontal: S.sm + 2, borderRadius: R.pill, borderWidth: 1, borderColor: C.line, justifyContent: 'center', backgroundColor: C.lilacBg },
  tabOn: { backgroundColor: C.lilac, borderColor: C.lilac },
  tabText: { fontFamily: Fonts.bold, fontSize: 13, color: C.lilac },
  row: { backgroundColor: C.surface, borderRadius: R.md, padding: S.sm + 4, gap: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  line: { flexDirection: 'row', alignItems: 'center', gap: S.xs + 2 },
  pill: { fontFamily: Fonts.bold, fontSize: 11, color: C.lilac, backgroundColor: C.lilacBg, borderRadius: R.pill, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  tag: { fontFamily: Fonts.bold, fontSize: 11, color: C.lilac, backgroundColor: C.lilacBg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
});
