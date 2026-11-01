// Quien compra, después de liberado el pago (regla v3 "Período de reclamo de 30 días", lib/rules.ts CLAIM_RULE):
// tarjeta con la regla y "Reportar un problema" -> hoja con motivo + su versión -> claim_open. No congela fondos ni
// promete devolución. Después muestra el estado (abierto / respondido / resuelto) y la respuesta de quien vende.
// Solo pedidos v3 liberados; sin la migración 035 (available:false) o fuera de plazo sin reporte: no se muestra.
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, ErrorText, haptic, Icon, PrimaryButton, Sheet } from '@/components/ds';
import { ui } from '@/components/ui';
import { LegalRuleRows } from '@/components/LegalRules';
import { C, R, S, T, TOUCH } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { userMessage } from '@/lib/cavosSession';
import { CLAIM_REASON_LABEL, CLAIM_STATUS_LABEL, getBuyerClaim, openBuyerClaim, type BuyerClaimState } from '@/lib/claims';
import { legalRule } from '@/lib/rules';
import { whenLabel } from '@/lib/ruleTimes';
import { CLAIM_TEXT_MIN } from '../api/_lib/orderRules';

export function ClaimCard({ slug }: { slug: string }) {
  const auth = useAuth();
  const [st, setSt] = useState<BuyerClaimState | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getBuyerClaim(auth, slug).then((r) => { if (live) setSt(r); }).catch(() => { if (live) setSt(null); });
    return () => { live = false; };
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!st || !st.available || !st.applies) return null;
  const c = st.claim;
  if (c) return (
    <Card testID="claim-status" style={{ gap: S.sm }}>
      <View style={s.row}><Icon name="flag-outline" size={18} color={C.lilac} /><Text style={[T.headline, { flex: 1 }]}>Tu reporte: {CLAIM_STATUS_LABEL[c.status].toLowerCase()}</Text></View>
      <Text style={T.callout}>{c.status === 'resuelto' ? 'El equipo marcó tu reporte como resuelto.'
        : c.seller_response ? 'Quien vende respondió a tu reporte.' : 'Le avisamos a quien vende. Puede responder y el reporte queda en su historial.'}</Text>
      {c.seller_response ? <View testID="claim-seller-response" style={s.quote}><Text style={T.footnote}>Respuesta de quien vende</Text><Text style={T.body}>{c.seller_response}</Text></View> : null}
      <Text style={T.footnote}>En esta etapa Meteorito no devuelve el pago, y tus derechos frente a quien vende se mantienen.</Text>
    </Card>
  );
  if (st.window.phase !== 'open') return null;

  const submit = async () => {
    if (!reason) return setErr('Elige qué pasó');
    if (text.trim().length < CLAIM_TEXT_MIN) return setErr('Cuéntanos qué pasó (mínimo 10 caracteres).');
    setBusy(true); setErr(null);
    try { const r = await openBuyerClaim(auth, slug, reason, text.trim()); haptic.success(); setSt({ ...st, claim: r.claim }); setOpen(false); }
    catch (e) { haptic.error(); setErr(userMessage((e as Error).message)); }
    finally { setBusy(false); }
  };
  return <>
    <Card testID="claim-card" style={{ gap: S.sm }}>
      <LegalRuleRows rules={[legalRule('reclamo_30_dias')]} />
      {st.window.until ? <Text testID="claim-until" style={T.footnote}>{`Puedes reportar hasta el ${whenLabel(st.window.until)}.`}</Text> : null}
      <PrimaryButton testID="claim-open" title="Reportar un problema" icon="flag-outline" variant="ghost" onPress={() => { setErr(null); setOpen(true); }} />
    </Card>
    <Sheet visible={open} onClose={() => setOpen(false)} title="Reportar un problema"
      footer={<>{err && <ErrorText>{err}</ErrorText>}<PrimaryButton testID="claim-send" title="Enviar reporte" icon="flag-outline" loading={busy} disabled={!reason} onPress={submit} /></>}>
      <Text style={T.callout}>Le avisamos a quien vende para que pueda responder. El pago ya se liberó: Meteorito no lo devuelve en esta etapa.</Text>
      <View style={s.grid}>
        {Object.entries(CLAIM_REASON_LABEL).map(([id, label]) => {
          const on = reason === id;
          return <Pressable key={id} testID={`claim-reason-${id}`} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => { haptic.tap(); setReason(id); }} style={[s.reason, on && s.reasonOn]}>
            <Text style={[T.headline, { fontSize: 15 }]} numberOfLines={1}>{label}</Text>
          </Pressable>;
        })}
      </View>
      <TextInput testID="claim-text" style={[ui.input, { minHeight: 96, paddingTop: S.sm + 4, textAlignVertical: 'top' }]} multiline maxLength={2000}
        placeholder="Cuéntanos qué pasó" placeholderTextColor={C.textDim} value={text} onChangeText={setText} accessibilityLabel="Cuéntanos qué pasó" />
    </Sheet>
  </>;
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: S.sm, alignItems: 'center' },
  quote: { gap: 2, padding: S.sm, borderRadius: R.md, backgroundColor: C.lilacBg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  reason: { flexBasis: '47%', flexGrow: 1, minHeight: TOUCH, justifyContent: 'center', borderRadius: R.md, paddingHorizontal: S.md, backgroundColor: C.lilacBg, borderWidth: 1, borderColor: 'transparent' },
  reasonOn: { borderColor: C.orange, backgroundColor: C.warnBg },
});
