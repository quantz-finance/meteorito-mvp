// "Arma un gran perfil": progreso del perfil + cuenta IBAN para cobrar. Se carga diferido (React.lazy) desde
// Mi cuenta y Mi tienda: no pesa en la bienvenida ni en /p/.
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ErrorText, haptic, Icon, PrimaryButton, Sheet, Skeleton, toast } from '@/components/ds';
import { ui } from '@/components/ui';
import { pressTransition } from '@/constants/motion';
import { C, R, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { getMyStore, type Store } from '@/lib/store';
import { crIbanError, formatIban, getPayout, maskIban, maskPhone, normalizeIban, normalizeSinpe, profilePct, profileSteps, savePayout, type PayoutView } from '@/lib/payout';
import { userMessage } from '@/lib/cavosSession';

const PAYOUT_COPY = 'Aquí te llega el dinero cuando se libere una venta.';

/** Estado compartido de la tarjeta: tienda (nombre/usuario/productos) + cuenta para cobrar. */
function useProfile() {
  const auth = useAuth();
  const [store, setStore] = useState<Store | null>(null);
  const [payout, setPayout] = useState<PayoutView | null | undefined>(undefined);
  const [payoutErr, setPayoutErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getMyStore(auth).then((s) => live && setStore(s)).catch(() => {});
    getPayout(auth).then((p) => live && setPayout(p)).catch((e) => { if (live) { setPayout(null); setPayoutErr(userMessage((e as Error).message)); } });
    return () => { live = false; };
  }, [auth.address]);
  return { store, payout, setPayout, payoutErr };
}

/** Barra de progreso: solo transform (scaleX) con transición suave. */
function Progress({ pct }: { pct: number }) {
  return (
    <View style={s.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
      <View style={[s.fill, { transform: [{ scaleX: Math.max(0.04, pct / 100) }] }, { transitionProperty: 'transform', transitionDuration: '600ms', transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' } as object]} />
    </View>
  );
}

/** Tarjeta completa para Mi cuenta: % del perfil, pasos y la cuenta para cobrar. */
export function ProfileCard({ products = 0 }: { products?: number }) {
  const { store, payout, setPayout, payoutErr } = useProfile();
  const [open, setOpen] = useState(false);
  const steps = profileSteps({ name: store?.display_name, storeSlug: store?.store_slug, payout: !!payout, products: Math.max(products, store?.items.length ?? 0) });
  const pct = profilePct(steps);
  return (
    <View style={s.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
        <View style={s.badge}><Icon name="rocket-outline" size={20} color="#fff" /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={T.caption}>Arma un gran perfil</Text>
          <Text style={T.headline}>{pct === 100 ? '¡Tu perfil está completo!' : `Tu perfil está al ${pct}%`}</Text>
        </View>
      </View>
      <Progress pct={pct} />
      <View style={s.steps}>
        {steps.map((st) => (
          <View key={st.key} style={[s.step, st.done && s.stepDone, st.soon && { opacity: 0.6 }]} accessibilityLabel={`${st.label}: ${st.done ? 'listo' : st.soon ? 'más adelante' : 'pendiente'}`}>
            <Icon name={st.done ? 'checkmark-circle' : st.soon ? 'lock-closed-outline' : 'ellipse-outline'} size={16} color={st.done ? C.success : C.lilac} />
            <Text style={[T.footnote, { color: st.done ? C.text : C.lilac }]} numberOfLines={1}>{st.label}{st.soon ? ' · más adelante' : ''}</Text>
          </View>
        ))}
      </View>
      <PayoutRow payout={payout} error={payoutErr} onPress={() => setOpen(true)} />
      <PayoutSheet visible={open} onClose={() => setOpen(false)} payout={payout ?? null} onSaved={(p) => { setPayout(p); setOpen(false); }} />
    </View>
  );
}

/** Fila compacta (Mi tienda): cuenta enmascarada o botón para agregarla. Abre el formulario. */
export function PayoutEntry() {
  const { payout, setPayout, payoutErr } = useProfile();
  const [open, setOpen] = useState(false);
  return <>
    <PayoutRow payout={payout} error={payoutErr} onPress={() => setOpen(true)} compact />
    <PayoutSheet visible={open} onClose={() => setOpen(false)} payout={payout ?? null} onSaved={(p) => { setPayout(p); setOpen(false); }} />
  </>;
}

function PayoutRow({ payout, error, onPress, compact }: { payout: PayoutView | null | undefined; error: string | null; onPress: () => void; compact?: boolean }) {
  if (payout === undefined) return <Skeleton h={compact ? 56 : 64} r={R.md} />;
  if (error) return <Text style={[T.footnote, { color: C.orange }]}>{error}</Text>;
  const has = !!payout;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={has ? 'Cambiar cuenta para cobrar' : 'Agregar cuenta IBAN para cobrar'}
      onPress={() => { haptic.tap(); onPress(); }}
      style={({ pressed }) => [s.payRow, !has && s.payRowEmpty, compact && { paddingVertical: S.sm }, pressTransition, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
      <View style={[s.payIcon, has && { backgroundColor: C.successBg }]}><Icon name={has ? 'card' : 'add'} size={20} color={has ? C.success : '#fff'} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={T.headline} numberOfLines={1}>{has ? maskIban(payout!.iban_last4) : 'Agrega tu cuenta IBAN'}</Text>
        <Text style={T.footnote} numberOfLines={compact ? 1 : 2}>{has ? `${payout!.holder_name}${payout!.sinpe_last4 ? ` · SINPE ${maskPhone(payout!.sinpe_last4)}` : ''}` : PAYOUT_COPY}</Text>
      </View>
      <Text style={[T.footnote, { color: C.lilac }]}>{has ? 'Cambiar' : ''}</Text>
      <Icon name="chevron-forward" size={18} color={C.lilac} />
    </Pressable>
  );
}

const inputPlain = { flex: 1, minWidth: 0, fontSize: 16, color: C.text, paddingVertical: S.sm, outlineStyle: 'none' } as object;

export function PayoutSheet({ visible, onClose, payout, onSaved }: { visible: boolean; onClose: () => void; payout: PayoutView | null; onSaved: (p: PayoutView) => void }) {
  const auth = useAuth();
  const [iban, setIban] = useState(''); const [holder, setHolder] = useState(''); const [sinpe, setSinpe] = useState('');
  const [touched, setTouched] = useState(false); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) { setIban(''); setHolder(payout?.holder_name ?? ''); setSinpe(''); setTouched(false); setErr(null); } }, [visible]);
  const raw = normalizeIban(iban);
  const ibanErr = crIbanError(raw);
  const showIbanErr = (touched || raw.length >= 22) && raw.length > 0 && ibanErr;
  const sinpeN = normalizeSinpe(sinpe);
  const ok = !ibanErr && holder.trim().length >= 3 && sinpeN !== 'invalid';
  async function save() {
    setTouched(true); if (!ok) return;
    setBusy(true); setErr(null);
    try { const p = await savePayout(auth, { iban: raw, holder_name: holder, sinpe_phone: sinpeN || undefined }); haptic.success(); toast('Cuenta guardada'); onSaved(p); }
    catch (e) { haptic.error(); setErr(userMessage((e as Error).message)); }
    finally { setBusy(false); }
  }
  return (
    <Sheet visible={visible} onClose={onClose} title={payout ? 'Cambiar cuenta para cobrar' : 'Tu cuenta para cobrar'}
      footer={<PrimaryButton title="Guardar cuenta" icon="checkmark" loading={busy} disabled={!ok} onPress={save} />}>
      <Text style={T.callout}>{PAYOUT_COPY}</Text>
      {payout ? <Text style={T.footnote}>Actual: {maskIban(payout.iban_last4)}. Escribe la cuenta completa para cambiarla.</Text> : null}
      <Text style={T.caption}>Cuenta IBAN</Text>
      <View style={[ui.input, s.inRow, showIbanErr ? { borderColor: C.orange } : !ibanErr ? { borderColor: C.success } : null]}>
        <TextInput style={[inputPlain, { fontVariant: ['tabular-nums'], letterSpacing: 0.5 }]} value={formatIban(iban)} onChangeText={(v) => setIban(normalizeIban(v).slice(0, 22))}
          onBlur={() => setTouched(true)} placeholder="CR00 0000 0000 0000 0000 00" placeholderTextColor={C.textDim} autoCapitalize="characters" autoCorrect={false}
          maxLength={27} accessibilityLabel="Cuenta IBAN" autoComplete="off" />
        {!ibanErr ? <Icon name="checkmark-circle" size={20} color={C.success} /> : null}
      </View>
      {showIbanErr ? <ErrorText>{ibanErr}</ErrorText> : <Text style={T.footnote}>CR y 20 números. La encuentras en la app de tu banco.</Text>}
      <Text style={T.caption}>Nombre del titular</Text>
      <TextInput style={ui.input} value={holder} onChangeText={setHolder} maxLength={80} placeholder="Como aparece en el banco" placeholderTextColor={C.textDim}
        autoComplete="name" accessibilityLabel="Nombre del titular" />
      <Text style={T.caption}>SINPE Móvil (opcional)</Text>
      <View style={[ui.input, s.inRow]}>
        <Text style={[T.body, { color: C.textDim }]}>+506</Text>
        <TextInput style={inputPlain} value={sinpe} onChangeText={(v) => setSinpe(v.replace(/[^\d ]/g, '').slice(0, 9))} keyboardType="phone-pad"
          placeholder="8888 1234" placeholderTextColor={C.textDim} accessibilityLabel="SINPE Móvil, opcional" autoComplete="tel-national" />
      </View>
      {sinpeN === 'invalid' && sinpe.replace(/\D/g, '').length >= 8 ? <ErrorText>El SINPE Móvil son 8 dígitos (ej. 8888 1234).</ErrorText> : null}
      {err ? <ErrorText>{err}</ErrorText> : null}
      <Text style={T.footnote}>Beta: por ahora solo registras la cuenta; todavía no enviamos dinero real. Solo tú la ves, y siempre enmascarada. Tu tienda pública nunca la muestra.</Text>
    </Sheet>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: C.purple, borderRadius: R.lg, padding: S.md, gap: S.sm + 4, borderWidth: 1, borderColor: 'rgba(255,138,61,0.35)', overflow: 'hidden' },
  badge: { width: 40, height: 40, borderRadius: 14, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center' },
  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, right: 0, borderRadius: 4, backgroundColor: C.orange, transformOrigin: 'left center' } as object,
  steps: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: R.pill, backgroundColor: 'rgba(255,255,255,0.08)' },
  stepDone: { backgroundColor: C.successBg },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm + 4, backgroundColor: C.surface, borderRadius: R.md, padding: S.sm + 4, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  payRowEmpty: { borderColor: C.orange, borderWidth: 1, borderStyle: 'dashed' },
  payIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center' },
  inRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
});
