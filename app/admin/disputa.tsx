// Detalle de una disputa (solo admin): línea de tiempo del pedido, foto y hash del envío, evidencia del comprador, chat del
// pedido (y de la tienda entre el mismo par), respuesta del vendedor, estado on-chain con links al explorador, sugerencia
// de las reglas, resumen con IA y la decisión humana (Reembolsar / Liberar al vendedor / Dividir %) con nota y confirmación.
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, Chip, ErrorText, haptic, Icon, PrimaryButton, Screen, Section, SkeletonCard } from '@/components/ds';
import { AdminNotFound } from '@/components/AdminNotFound';
import { ui } from '@/components/ui';
import { Fonts } from '@/constants/Colors';
import { C, R, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { userMessage } from '@/lib/cavosSession';
import { formatCRC, STATUS_LABEL } from '@/lib/labels';
import { ageLabel, aiDispute, deadlineLabel, decideDispute, getDispute, markGuestRefunded, shortDate, useIsAdmin, type AdminDisputeDetail, type AiView, type DecideResult, type Outcome } from '@/lib/admin';
import { OUTCOME_LABEL } from '@/api/_lib/disputeRules';

const CONF: Record<string, string> = { alta: 'Confianza alta', media: 'Confianza media', baja: 'Confianza baja' };
const OPTIONS: { id: Outcome; label: string; icon: 'arrow-undo-outline' | 'arrow-redo-outline' | 'git-compare-outline' }[] = [
  { id: 'refund', label: 'Reembolsar', icon: 'arrow-undo-outline' }, { id: 'release', label: 'Liberar al vendedor', icon: 'arrow-redo-outline' }, { id: 'split', label: 'Dividir', icon: 'git-compare-outline' },
];

export default function AdminDisputa() {
  const auth = useAuth();
  const admin = useIsAdmin(auth);
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  const [d, setD] = useState<AdminDisputeDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<DecideResult | null>(null); // sobrevive a la recarga (el pedido pasa a resuelto)
  const load = useCallback(() => {
    if (admin !== true || !slug) return;
    getDispute(auth, String(slug)).then((x) => { setD(x); setErr(null); }).catch((e) => setErr(userMessage((e as Error).message)));
  }, [admin, slug]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  if (admin === false) return <AdminNotFound />;
  if (!d) return <Screen title="Disputa" back="/admin/disputas">{err ? <ErrorText>{err}</ErrorText> : <><SkeletonCard /><SkeletonCard /><SkeletonCard /></>}</Screen>;
  const dl = deadlineLabel(d.deadline);
  return (
    <Screen title="Disputa" back="/admin/disputas">
      <Card testID="dispute-head" style={{ gap: S.xs }}>
        <Text style={T.title} numberOfLines={2}>{d.product}</Text>
        <Text style={T.moneySm}>{formatCRC(d.price_crc)}{d.amount_usdc != null ? <Text style={T.footnote}>  · {d.amount_usdc} USDC</Text> : null}</Text>
        <View style={s.wrap}>
          <Chip label={STATUS_LABEL[d.status] ?? d.status} tone={d.status === 'resuelto' ? 'success' : 'warn'} />
          <Chip label={d.reason_label} />
          <Chip label={d.delivery_mode === 'cara_a_cara' ? 'Cara a cara' : 'Envío'} tone="muted" />
        </View>
        <Text style={T.footnote}>Pedido {d.slug} · abierta {ageLabel(d.opened_at)} ({shortDate(d.opened_at)}){dl ? ` · ${dl.text}` : ''}</Text>
        <Text style={T.footnote}>Vendedor: {d.seller.name ?? '—'}{d.seller.store_slug ? ` (@${d.seller.store_slug})` : ''} · Comprador: {d.buyer.kind} ·{d.buyer.ref}</Text>
      </Card>

      {d.guest.refund_pending ? <GuestRefund d={d} onDone={load} /> : null}

      <Section title="Qué reportó el comprador">
        <Card style={{ gap: S.sm }}>
          <Text style={[T.body, s.brk]} testID="dispute-description">{d.description || 'Sin descripción.'}</Text>
          {d.evidence.length ? <Photos urls={d.evidence} label="Foto del comprador" /> : <Text style={T.footnote}>Sin fotos.</Text>}
        </Card>
      </Section>

      <Section title="Respuesta del vendedor">
        <Card testID="seller-response" style={{ gap: S.sm }}>
          {!d.responses_available ? <Text style={T.footnote}>La respuesta en la app necesita la migración 027. Mientras tanto, revisa el chat del pedido.</Text>
            : d.response ? <>
              <Text style={T.body}>{d.response.body}</Text>
              {d.response.photo ? <Photos urls={[d.response.photo]} label="Foto del vendedor" /> : null}
              <Text style={T.footnote}>{shortDate(d.response.created_at)}</Text>
            </> : <Text style={T.footnote}>Sin respuesta todavía{d.response_deadline ? ` · plazo: ${shortDate(d.response_deadline)}` : ''}.</Text>}
        </Card>
      </Section>

      <Section title="Línea de tiempo">
        <Card style={{ gap: 6 }} testID="dispute-timeline">
          {d.timeline.map((e, i) => <View key={`${e.kind}-${i}`} style={s.tl}><View style={s.tlDot} /><Text style={[T.footnote, { color: C.text, flex: 1 }]}>{e.label}</Text><Text style={T.footnote}>{shortDate(e.at)}</Text></View>)}
        </Card>
      </Section>

      <Section title="Envío">
        <Card style={{ gap: S.sm }} testID="dispute-ship">
          {d.ship ? <>
            <Text style={T.footnote}>Marcado como enviado: {shortDate(d.ship.shipped_at)}{d.ship.captured_at ? ` · foto tomada ${shortDate(d.ship.captured_at)}` : ''}</Text>
            {d.ship.photo ? <Photos urls={[d.ship.photo]} label="Foto del envío" /> : <Text style={[T.footnote, { color: C.orange }]}>Sin foto del envío.</Text>}
            <Text style={T.footnote}>Guía: {d.ship.note || '—'}</Text>
            <Text style={[T.footnote, s.mono]} selectable>Hash: {d.ship.hash || '—'}</Text>
          </> : <Text style={T.footnote}>{d.delivery_mode === 'cara_a_cara' ? 'Entrega cara a cara: no hay envío.' : 'Nunca se marcó como enviado.'}</Text>}
        </Card>
      </Section>

      <Section title="Chat">
        <Card style={{ gap: S.sm }} testID="dispute-chat">
          {!d.chat.available ? <Text style={T.footnote}>El chat no está disponible.</Text> : <>
            <Transcript title="Chat del pedido" lines={d.chat.order} />
            <Transcript title="Chat de la tienda (mismo comprador y vendedor)" lines={d.chat.store} />
          </>}
        </Card>
      </Section>

      <Section title="On-chain">
        <Card style={{ gap: 6 }} testID="dispute-onchain">
          {d.onchain.error ? <Text style={[T.footnote, { color: C.orange }]}>No se pudo leer el contrato: {d.onchain.error}</Text>
            : d.onchain.contract_id ? <Text style={T.footnote}>En disputa: {yn(d.onchain.disputed)} · Liberado: {yn(d.onchain.released)} · Resuelto: {yn(d.onchain.resolved)}{d.onchain.balance != null ? ` · Saldo: ${d.onchain.balance} USDC` : ''}</Text>
            : <Text style={T.footnote}>Sin contrato.</Text>}
          <View style={s.wrap}>{d.links.map((l) => <Pressable key={l.url} accessibilityRole="link" onPress={() => Linking.openURL(l.url)} style={s.link}><Text style={[T.footnote, { color: C.lilac }]}>{l.label}</Text><Icon name="open-outline" size={12} color={C.lilac} /></Pressable>)}</View>
        </Card>
      </Section>

      {d.status === 'en_disputa' ? <Section title="Sugerencia de las reglas">
        <Card style={{ gap: 4 }} testID="dispute-rule">
          {d.rule ? <>
            <Text style={T.headline}>{d.rule.title}</Text>
            <Text style={T.footnote}>{d.rule.why}</Text>
            <Text style={[T.footnote, { color: C.text }]}>Sugerencia: {OUTCOME_LABEL[d.rule.outcome]} ({d.rule.buyerPct}% al comprador) · regla {d.rule.rule}</Text>
          </> : <Text style={T.footnote}>Ninguna regla aplica: decide con la evidencia{d.ai.available ? ' y el resumen con IA' : ''}.</Text>}
          <Text style={T.footnote}>Auto-resolución: {d.flags.autoResolve ? 'encendida' : 'apagada'} (una persona aprueba).</Text>
        </Card>
      </Section> : null}

      <Ai d={d} />

      {result ? <DecisionResult res={result} /> : d.status === 'en_disputa' ? <Decide d={d} onDone={(r) => { setResult(r); load(); }} /> : null}

      {d.decisions.length ? <Section title="Historial de decisiones">
        <Card style={{ gap: S.sm }} testID="dispute-audit">
          {d.decisions.map((x, i) => <View key={`${x.id}-${i}`} style={{ gap: 2 }}>
            <Text style={[T.footnote, { color: C.text }]}>{OUTCOME_LABEL[x.outcome]} · {x.buyer_pct}% al comprador · {STATUS[x.status] ?? x.status}</Text>
            <Text style={T.footnote}>{x.by} · {shortDate(x.at)}{x.rule_id ? ` · regla ${x.rule_id}` : ''}</Text>
            <Text style={T.footnote}>“{x.note}”</Text>
            {x.error ? <Text style={[T.footnote, { color: C.orange }]}>{x.error}</Text> : null}
            {x.guest_refund === 'devuelto' ? <Text style={[T.footnote, { color: C.success }]}>Devuelto al comprador {shortDate(x.guest_refunded_at)}</Text> : null}
          </View>)}
        </Card>
      </Section> : null}
    </Screen>
  );
}
const STATUS: Record<string, string> = { executed: 'ejecutada', executing: 'ejecutando', failed: 'falló', pending_onchain: 'falta ejecutar on-chain' };
const yn = (v?: boolean) => (v == null ? '—' : v ? 'sí' : 'no');

function Photos({ urls, label }: { urls: string[]; label: string }) {
  return <View style={s.wrap}>{urls.map((u, i) => (
    <Pressable key={u + i} accessibilityRole="link" accessibilityLabel={`${label} ${i + 1}`} onPress={() => Linking.openURL(u)}>
      <Image source={{ uri: u }} style={s.photo} />
    </Pressable>))}</View>;
}
function Transcript({ title, lines }: { title: string; lines: { from: string; body: string; at: string }[] }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={T.caption}>{title} · {lines.length}</Text>
      {lines.length === 0 ? <Text style={T.footnote}>Sin mensajes.</Text> : lines.slice(-80).map((m, i) => (
        <Text key={i} style={[T.footnote, s.brk]}><Text style={{ fontFamily: Fonts.bold, color: m.from === 'vendedor' ? C.lilac : C.orange }}>{m.from === 'vendedor' ? 'Vendedor' : 'Comprador'}</Text> {shortDate(m.at)}: <Text style={{ color: C.text }}>{m.body}</Text></Text>
      ))}
    </View>
  );
}

function Ai({ d }: { d: AdminDisputeDetail }) {
  const auth = useAuth();
  const [r, setR] = useState<AiView | null>(d.ai.cached);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (refresh: boolean) => {
    setBusy(true); setErr(null);
    try { const x = await aiDispute(auth, d.slug, refresh); if (!x.available) setErr('Resumen IA no disponible'); else setR(x.result); }
    catch (e) { setErr(userMessage((e as Error).message)); } finally { setBusy(false); }
  };
  return (
    <Section title="Resumen IA">
      <Card style={{ gap: S.sm }} testID="dispute-ai">
        {!d.ai.available ? <Text style={T.footnote} testID="ai-unavailable">Resumen IA no disponible{d.ai.reason === 'flag_off' ? ' (apagado)' : ''}.</Text>
          : r ? <>
            <Text style={T.body}>{r.summary}</Text>
            <Text style={[T.footnote, { color: C.text }]}>Recomienda: {OUTCOME_LABEL[r.recommendation]}{r.recommendation === 'split' ? ` (${r.buyerPct}% al comprador)` : ''} · {CONF[r.confidence]}</Text>
            {r.reasons.map((x, i) => <Text key={i} style={T.footnote}>• {x}</Text>)}
            <Text style={T.footnote}>{r.model} · {shortDate(r.at)}{d.ai.cache_available ? '' : ' · sin caché (falta 027)'}</Text>
            <PrimaryButton title="Volver a generar" icon="refresh" variant="ghost" loading={busy} onPress={() => run(true)} />
          </> : <PrimaryButton testID="ai-run" title="Generar resumen" icon="sparkles-outline" variant="secondary" loading={busy} onPress={() => run(false)} />}
        {err ? <ErrorText>{err}</ErrorText> : null}
      </Card>
    </Section>
  );
}

function DecisionResult({ res }: { res: DecideResult }) {
  return (
    <Card testID="decide-result" style={{ gap: S.sm }}>
      <View style={s.wrap}><Icon name={res.executed ? 'checkmark-circle' : 'time-outline'} size={20} color={res.executed ? C.success : C.orange} />
        <Text style={T.headline}>{res.executed ? 'Disputa resuelta' : 'Decisión registrada'}</Text></View>
      {res.executed ? <Text style={T.footnote}>Al comprador: {res.toBuyer} USDC · al vendedor: {res.toSeller} USDC. Avisamos a las dos partes.</Text>
        : <><Text style={T.footnote}>Falta ejecutarla on-chain: el servidor no tiene el secreto del dispute resolver. Corre:</Text><Text selectable style={[T.footnote, s.mono, { color: C.text }]}>{res.command}</Text></>}
      {res.guestRefundPending ? <Text style={[T.footnote, { color: C.orange }]}>Comprador invitado: su parte llegó a la wallet de la plataforma. Queda la tarea “pendiente devolver al comprador”.</Text> : null}
    </Card>
  );
}

function Decide({ d, onDone }: { d: AdminDisputeDetail; onDone: (r: DecideResult) => void }) {
  const auth = useAuth();
  const [outcome, setOutcome] = useState<Outcome | null>(d.rule?.outcome ?? null);
  const [pct, setPct] = useState('50');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = Number(pct);
  const pctOk = outcome !== 'split' || (Number.isInteger(n) && n >= 1 && n <= 99);
  const buyerPct = outcome === 'refund' ? 100 : outcome === 'release' ? 0 : n;
  const amount = Number(d.amount_usdc ?? 0);
  const ready = !!outcome && pctOk && note.trim().length >= 3;
  const submit = async () => {
    if (!outcome) return;
    setBusy(true); setErr(null);
    try {
      const r = await decideDispute(auth, d.slug, { outcome, buyer_pct: outcome === 'split' ? n : undefined, note: note.trim(), rule_id: d.rule?.rule ?? null, ai_recommendation: d.ai.cached?.recommendation ?? null });
      haptic.success(); setConfirming(false); onDone(r);
    } catch (e) { haptic.error(); setErr(userMessage((e as Error).message)); } finally { setBusy(false); }
  };
  return (
    <Section title="Decisión">
      <Card style={{ gap: S.sm }} testID="decide">
        <View style={s.wrap} accessibilityRole="radiogroup">
          {OPTIONS.map((o) => {
            const on = outcome === o.id;
            return <Pressable key={o.id} testID={`decide-${o.id}`} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => { haptic.tap(); setOutcome(o.id); setConfirming(false); }}
              style={[s.opt, on && s.optOn]}>
              <Icon name={o.icon} size={18} color={on ? C.orange : C.lilac} /><Text style={[T.footnote, { color: C.text, fontFamily: Fonts.bold }]}>{o.label}</Text>
            </Pressable>;
          })}
        </View>
        {outcome === 'split' ? <View style={s.wrap}>
          <Text style={T.footnote}>Al comprador (%)</Text>
          <TextInput testID="decide-pct" style={[ui.input, { width: 88, textAlign: 'center' }]} keyboardType="number-pad" maxLength={2} value={pct} onChangeText={(v) => { setPct(v.replace(/\D/g, '')); setConfirming(false); }} accessibilityLabel="Porcentaje para el comprador" />
          <Text style={T.footnote}>vendedor {pctOk ? 100 - n : '—'}%</Text>
        </View> : null}
        <TextInput testID="decide-note" style={[ui.input, { minHeight: 80, paddingTop: S.sm + 4, textAlignVertical: 'top' }]} multiline maxLength={1000}
          placeholder="Nota: por qué decides esto (queda en el historial)" placeholderTextColor={C.textDim} value={note} onChangeText={(v) => { setNote(v); setConfirming(false); }} accessibilityLabel="Nota de la decisión" />
        {!d.capabilities.executeOnchain ? <Text style={T.footnote}>El servidor no tiene el secreto del dispute resolver: la decisión queda registrada y te mostramos el comando para ejecutarla.</Text> : null}
        {d.guest.is_guest && buyerPct > 0 ? <Text style={[T.footnote, { color: C.orange }]}>Comprador invitado: su parte va a la wallet de la plataforma y hay que devolvérsela por fuera.</Text> : null}
        {err ? <ErrorText>{err}</ErrorText> : null}
        {confirming ? <View style={{ gap: S.sm }} testID="decide-confirm">
          <Text style={[T.footnote, { color: C.text }]}>{OUTCOME_LABEL[outcome!]}: {buyerPct}% al comprador (≈ {Math.round(amount * buyerPct) / 100} USDC) y {100 - buyerPct}% al vendedor. No se puede deshacer.</Text>
          <PrimaryButton testID="decide-go" title="Sí, confirmar" icon="checkmark" loading={busy} onPress={submit} />
          <PrimaryButton title="Cambiar" variant="ghost" onPress={() => setConfirming(false)} />
        </View> : <PrimaryButton testID="decide-submit" title="Confirmar decisión" icon="hammer-outline" disabled={!ready} onPress={() => setConfirming(true)} />}
      </Card>
    </Section>
  );
}

function GuestRefund({ d, onDone }: { d: AdminDisputeDetail; onDone: () => void }) {
  const auth = useAuth();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card testID="guest-refund" style={{ gap: S.sm, borderWidth: 1, borderColor: C.orange }}>
      <View style={s.wrap}><Icon name="alert-circle" size={18} color={C.orange} /><Text style={T.headline}>Pendiente devolver al comprador</Text></View>
      <Text style={T.footnote}>Compra como invitado: {d.guest.to_buyer ?? '—'} USDC llegaron a la wallet de la plataforma. Devuélveselos por fuera.</Text>
      <Text style={T.footnote}>Contacto: {d.guest.contact ?? 'el invitado no dejó datos; escríbele por el chat del pedido.'}</Text>
      <TextInput style={ui.input} placeholder="Cómo se devolvió (opcional)" placeholderTextColor={C.textDim} value={note} onChangeText={setNote} maxLength={500} accessibilityLabel="Cómo se devolvió" />
      {err ? <ErrorText>{err}</ErrorText> : null}
      <PrimaryButton testID="guest-refund-done" title="Marcar como devuelto" icon="checkmark" variant="secondary" loading={busy}
        onPress={async () => { setBusy(true); setErr(null); try { await markGuestRefunded(auth, d.slug, note.trim()); onDone(); } catch (e) { setErr(userMessage((e as Error).message)); } finally { setBusy(false); } }} />
    </Card>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: S.xs + 2 },
  photo: { width: 96, height: 96, borderRadius: R.sm, backgroundColor: C.lilacBg },
  tl: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  tlDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.lilac },
  link: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 32, paddingRight: S.sm },
  mono: { fontFamily: Platform.select({ web: 'Menlo, Consolas, monospace', ios: 'Menlo', default: 'monospace' }), ...(Platform.OS === 'web' ? ({ wordBreak: 'break-all' } as object) : {}) },
  brk: Platform.OS === 'web' ? ({ wordBreak: 'break-word' } as object) : {},
  opt: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: S.sm + 2, borderRadius: R.md, backgroundColor: C.lilacBg, borderWidth: 1, borderColor: 'transparent', flexGrow: 1 },
  optOn: { borderColor: C.orange, backgroundColor: C.warnBg },
});
