// Panel admin: reportes después de liberar (regla v3 "Período de reclamo de 30 días"). Lista con las dos versiones y
// "Marcar resuelto" (nota obligatoria). No mueve fondos. Sin la migración 035: un aviso y nada más.
import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Card, ErrorText, PrimaryButton } from '@/components/ds';
import { ui } from '@/components/ui';
import { C, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { userMessage } from '@/lib/cavosSession';
import { CLAIM_REASON_LABEL, CLAIM_STATUS_LABEL, listAdminClaims, resolveAdminClaim, type AdminClaimRow } from '@/lib/claims';
import { whenLabel } from '@/lib/ruleTimes';

export function AdminClaims() {
  const auth = useAuth();
  const [d, setD] = useState<{ available: boolean; claims: AdminClaimRow[] } | null>(null);
  const load = () => listAdminClaims(auth).then(setD).catch(() => setD(null));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null;
  return (
    <View testID="admin-claims" style={{ gap: S.sm }}>
      <Text style={T.caption}>Reportes después de liberar (30 días)</Text>
      {!d.available ? <Text style={T.footnote}>Falta la migración 035.</Text>
        : !d.claims.length ? <Text style={T.footnote}>No hay reportes.</Text>
        : d.claims.map((c) => <ClaimRow key={c.slug} c={c} onDone={load} />)}
    </View>
  );
}

function ClaimRow({ c, onDone }: { c: AdminClaimRow; onDone: () => void }) {
  const auth = useAuth();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card testID={`admin-claim-${c.slug}`} style={{ gap: S.xs }}>
      <Text style={T.headline}>{c.slug} · {CLAIM_STATUS_LABEL[c.status]}{c.counts ? '' : ' (aún no cuenta)'}</Text>
      <Text style={T.footnote}>{CLAIM_REASON_LABEL[c.reason] ?? c.reason} · {whenLabel(c.opened_at)}</Text>
      <Text style={T.body}>Quien compra: {c.description}</Text>
      {c.seller_response ? <Text style={T.body}>Quien vende: {c.seller_response}</Text> : <Text style={[T.footnote, { color: C.orange }]}>Sin respuesta de quien vende</Text>}
      {c.status === 'resuelto' ? <Text style={T.footnote}>Resuelto por {c.resolved_by}: {c.resolution_note}</Text> : <>
        <TextInput testID="admin-claim-note" style={ui.input} placeholder="Nota (obligatoria)" placeholderTextColor={C.textDim} value={note} onChangeText={setNote} maxLength={1000} />
        {err ? <ErrorText>{err}</ErrorText> : null}
        <PrimaryButton testID="admin-claim-resolve" title="Marcar resuelto" variant="ghost" loading={busy} disabled={note.trim().length < 3}
          onPress={async () => { setBusy(true); setErr(null); try { await resolveAdminClaim(auth, c.slug, note.trim()); onDone(); } catch (e) { setErr(userMessage((e as Error).message)); } finally { setBusy(false); } }} />
      </>}
    </Card>
  );
}
