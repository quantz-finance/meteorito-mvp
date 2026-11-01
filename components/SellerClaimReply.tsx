// Quien vende: reporte de quien compró DESPUÉS de liberado el pago (regla v3 "Período de reclamo de 30 días").
// Puede responder antes de que el reporte cuente en su historial (48 h desde el aviso); después también puede responder.
// El historial público muestra solo el estado (abierto / respondido / resuelto), nunca el texto. Sin 035 o sin reporte: nada.
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, ErrorText, Icon, PrimaryButton } from '@/components/ds';
import { ui } from '@/components/ui';
import { C, R, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { userMessage } from '@/lib/cavosSession';
import { CLAIM_REASON_LABEL, CLAIM_STATUS_LABEL, getSellerClaim, respondSellerClaim, type SellerClaimState } from '@/lib/claims';
import { leftLabel, useNow, whenLabel } from '@/lib/ruleTimes';

export function SellerClaimReply({ slug }: { slug: string }) {
  const auth = useAuth();
  const now = useNow();
  const [st, setSt] = useState<SellerClaimState | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getSellerClaim(auth, slug).then((r) => { if (live) setSt(r); }).catch(() => { if (live) setSt(null); });
    return () => { live = false; };
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!st?.available || !st.claim) return null;
  const c = st.claim;
  const send = async () => {
    setBusy(true); setErr(null);
    try { const r = await respondSellerClaim(auth, slug, text.trim()); setSt({ ...st, claim: r.claim }); setText(''); }
    catch (e) { setErr(userMessage((e as Error).message)); }
    finally { setBusy(false); }
  };
  return (
    <Card testID="seller-claim" style={{ gap: S.sm }}>
      <View style={s.row}><Icon name="flag-outline" size={18} color={C.orange} /><Text style={[T.headline, { flex: 1 }]}>Reporte de quien compró</Text>
        <Text testID="seller-claim-status" style={[T.footnote, { color: C.lilac }]}>{CLAIM_STATUS_LABEL[c.status]}</Text></View>
      <View style={s.quote}><Text style={T.footnote}>{CLAIM_REASON_LABEL[c.reason] ?? 'Otro'}</Text><Text style={T.body}>{c.description}</Text></View>
      {c.seller_response ? <View testID="seller-claim-done" style={s.quote}><Text style={T.footnote}>Tu respuesta</Text><Text style={T.body}>{c.seller_response}</Text></View>
        : <Text testID="seller-claim-countdown" style={T.callout}>{!c.counts && c.counts_at
          ? `Responde antes del ${whenLabel(c.counts_at)} (${leftLabel(c.counts_at, now)}): así el reporte entra a tu historial ya respondido.`
          : 'El reporte ya está en tu historial como abierto. Si respondes, pasa a respondido.'}</Text>}
      <Text style={T.footnote}>En tu historial público solo se ve el estado del reporte, no el texto.</Text>
      {st.can_respond && !c.seller_response ? <>
        <TextInput testID="seller-claim-text" style={[ui.input, { minHeight: 80, paddingTop: S.sm + 4, textAlignVertical: 'top' }]} multiline maxLength={1000}
          placeholder="Tu respuesta" placeholderTextColor={C.textDim} value={text} onChangeText={setText} accessibilityLabel="Tu respuesta" />
        {err ? <ErrorText>{err}</ErrorText> : null}
        <PrimaryButton testID="seller-claim-send" title="Enviar respuesta" icon="chatbubbles-outline" loading={busy} disabled={!text.trim()} onPress={send} />
      </> : null}
    </Card>
  );
}
const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: S.sm, alignItems: 'center' },
  quote: { gap: 2, padding: S.sm, borderRadius: R.md, backgroundColor: C.lilacBg },
});
