// Cola de pagos a Cuenta IBAN (solo admin, migración 029). El escrow ya liberó el USDC a la wallet 'platform'; el equipo
// transfiere al IBAN del vendedor por fuera y lo marca aquí como pagado con una nota (número de transferencia). Nada es
// automático. Quien no es admin ve "No encontramos esta página" (el servidor responde 404 a cualquier acción admin).
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Card, ErrorText, haptic, Icon, PrimaryButton, Screen, SkeletonCard, toast } from '@/components/ds';
import { AdminNotFound } from '@/components/AdminNotFound';
import { ui } from '@/components/ui';
import { pressTransition } from '@/constants/motion';
import { Fonts } from '@/constants/Colors';
import { C, R, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { userMessage } from '@/lib/cavosSession';
import { formatCRC } from '@/lib/labels';
import { ageLabel, listPayouts, markPayoutPaid, shortDate, useIsAdmin, type AdminPayoutRow } from '@/lib/admin';
import { formatIban } from '@/lib/payout';

export const PAYOUT_STATE_LABEL = { pendiente: 'Pendiente pagar al banco', pagado: 'Pagado' } as const;
type Tab = 'pendiente' | 'pagado';

export default function AdminPagos() {
  const auth = useAuth();
  const admin = useIsAdmin(auth);
  const [tab, setTab] = useState<Tab>('pendiente');
  const [data, setData] = useState<Awaited<ReturnType<typeof listPayouts>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    listPayouts(auth).then((d) => { setData(d); setErr(null); }).catch((e) => setErr(userMessage((e as Error).message)));
  }, [auth]);
  useFocusEffect(useCallback(() => { if (admin === true) load(); }, [admin])); // eslint-disable-line react-hooks/exhaustive-deps
  if (admin === false) return <AdminNotFound />;
  const rows = (data?.payouts ?? []).filter((p) => p.state === tab);
  return (
    <Screen title="Pagos a Cuenta IBAN" back="/admin/disputas">
      <View style={s.tabs} accessibilityRole="tablist">
        {(['pendiente', 'pagado'] as Tab[]).map((t) => {
          const on = t === tab; const n = data?.counts?.[t];
          return (
            <Pressable key={t} testID={`ptab-${t}`} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => { haptic.tap(); setTab(t); }}
              style={({ pressed }) => [s.tab, on && s.tabOn, pressTransition, pressed && { opacity: 0.8 }]}>
              <Text style={[s.tabText, on && { color: C.purple }]}>{t === 'pendiente' ? 'Pendientes' : 'Pagados'}{n != null ? ` · ${n}` : ''}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={T.footnote}>El USDC ya llegó a la wallet platform. Transfiere al IBAN y márcalo como pagado.</Text>
      {err ? <ErrorText>{err}</ErrorText> : null}
      {data && !data.available ? <Card><Text testID="payouts-unavailable" style={T.callout}>Falta la migración 029: todavía no hay cola de pagos.</Text></Card>
        : admin === null || (!data && !err) ? <><SkeletonCard /><SkeletonCard /></>
        : rows.length === 0 ? <Card style={{ alignItems: 'center', paddingVertical: S.lg }}><Text testID="payouts-empty" style={T.callout}>No hay pagos aquí.</Text></Card>
        : <View style={{ gap: S.sm }} testID="payouts-list">{rows.map((r) => <Row key={r.slug} r={r} onDone={load} />)}</View>}
    </Screen>
  );
}

function Row({ r, onDone }: { r: AdminPayoutRow; onDone: () => void }) {
  const auth = useAuth();
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const pending = r.state === 'pendiente';
  async function paid() {
    setBusy(true); setErr(null);
    try { await markPayoutPaid(auth, r.slug, note); haptic.success(); toast('Marcado como pagado'); onDone(); }
    catch (e) { haptic.error(); setErr(userMessage((e as Error).message)); }
    finally { setBusy(false); }
  }
  return (
    <View style={s.row} testID={`payout-${r.slug}`}>
      <View style={s.line}>
        <Text style={[T.headline, { flex: 1, minWidth: 0 }]} numberOfLines={1}>{r.product || r.slug}</Text>
        <Text style={[T.headline, { fontVariant: ['tabular-nums'] }]}>{r.amount_crc != null ? formatCRC(r.amount_crc) : `${r.amount_usdc} USDC`}</Text>
      </View>
      <View style={[s.line, { flexWrap: 'wrap' }]}>
        <Text style={[s.pill, pending && { color: C.orange, backgroundColor: C.warnBg }]}>{PAYOUT_STATE_LABEL[r.state]}</Text>
        <Text style={T.footnote}>{r.slug} · {r.amount_usdc} USDC · liberado {ageLabel(r.created_at)}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Copiar IBAN" onPress={() => { Clipboard.setStringAsync(r.iban).then(() => toast('IBAN copiado')).catch(() => {}); }}
        style={({ pressed }) => [s.line, { minHeight: 44 }, pressed && { opacity: 0.8 }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[T.body, { fontVariant: ['tabular-nums'] }]} numberOfLines={1}>{formatIban(r.iban)}</Text>
          <Text style={T.footnote} numberOfLines={1}>{r.holder_name}</Text>
        </View>
        <Icon name="copy-outline" size={18} color={C.lilac} />
      </Pressable>
      {pending ? <>
        <TextInput testID={`payout-note-${r.slug}`} style={ui.input} value={note} onChangeText={setNote} maxLength={500} placeholder="Nota: número de transferencia"
          placeholderTextColor={C.textDim} accessibilityLabel="Nota del pago" />
        {err ? <ErrorText>{err}</ErrorText> : null}
        <PrimaryButton title="Marcar como pagado" icon="checkmark" loading={busy} disabled={note.trim().length < 3} onPress={paid} />
      </> : <Text style={T.footnote}>Pagado {shortDate(r.paid_at)} por {r.paid_by ?? '—'}{r.note ? ` · ${r.note}` : ''}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: S.xs },
  tab: { minHeight: 36, paddingHorizontal: S.sm + 2, borderRadius: R.pill, borderWidth: 1, borderColor: C.line, justifyContent: 'center', backgroundColor: C.lilacBg },
  tabOn: { backgroundColor: C.lilac, borderColor: C.lilac },
  tabText: { fontFamily: Fonts.bold, fontSize: 13, color: C.lilac },
  row: { backgroundColor: C.surface, borderRadius: R.md, padding: S.sm + 4, gap: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  line: { flexDirection: 'row', alignItems: 'center', gap: S.xs + 2 },
  pill: { fontFamily: Fonts.bold, fontSize: 11, color: C.success, backgroundColor: C.successBg, borderRadius: R.pill, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
});
