// "Arma un gran perfil": progreso del perfil + dónde cobrar (Cuenta IBAN o wallet Stellar, 029) + WhatsApp de contacto (opcional). Se carga diferido (React.lazy) desde
// Mi cuenta y Mi tienda: no pesa en la bienvenida ni en /p/.
import { COPY } from '@/lib/copy';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { ErrorText, haptic, Icon, PrimaryButton, Sheet, Skeleton, toast } from '@/components/ds';
import { ui } from '@/components/ui';
import { pressTransition } from '@/constants/motion';
import { C, R, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { getMyStore, updateMyStore, type Store } from '@/lib/store';
import { contactPhoneError, formatContactPhone, normalizeContactPhone } from '../api/_lib/contact';
import { StoreAvatar } from '@/components/StoreAvatar';
import { checkPayoutWallet, crIbanError, formatIban, getPayoutState, maskIban, maskPhone, normalizeIban, normalizeSinpe, profilePct, profileSteps, savePayout, savePayoutWallet, shortStellar, stellarAddressError, type PayoutView, type WalletCheck } from '@/lib/payout';
import { userMessage } from '@/lib/cavosSession';

const PAYOUT_COPY = 'Aquí te llega el dinero cuando se libere una venta.';

/** Estado compartido de la tarjeta: tienda (nombre/usuario/productos) + cuenta para cobrar. */
function useProfile() {
  const auth = useAuth();
  const [store, setStore] = useState<Store | null>(null);
  const [payout, setPayout] = useState<PayoutView | null | undefined>(undefined);
  const [payoutErr, setPayoutErr] = useState<string | null>(null);
  const [choice, setChoice] = useState(false); // ¿puede elegir wallet o Cuenta IBAN? (migración 029)
  useEffect(() => {
    let live = true;
    getMyStore(auth).then((s) => live && setStore(s)).catch(() => {});
    getPayoutState(auth).then((p) => { if (live) { setPayout(p.payout); setChoice(p.choice); } }).catch((e) => { if (live) { setPayout(null); setPayoutErr(userMessage((e as Error).message)); } });
    return () => { live = false; };
  }, [auth.address]);
  return { store, setStore, payout, setPayout, payoutErr, choice };
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
  const { store, setStore, payout, setPayout, payoutErr, choice } = useProfile();
  const [open, setOpen] = useState(false); const [contactOpen, setContactOpen] = useState(false);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const steps = profileSteps({ name: store?.display_name, storeSlug: store?.store_slug, payout: !!payout, products: Math.max(products, store?.items.length ?? 0) });
  const pct = profilePct(steps);
  return (
    <View style={s.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
        {store ? <StoreAvatar store={store} size={40} editable onChange={setStore} onError={setPhotoErr} />
          : <View style={s.badge}><Icon name="rocket-outline" size={20} color="#fff" /></View>}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={T.caption}>Arma un gran perfil</Text>
          <Text style={T.headline}>{pct === 100 ? '¡Tu perfil está completo!' : `Tu perfil está al ${pct}%`}</Text>
        </View>
      </View>
      {photoErr ? <ErrorText>{photoErr}</ErrorText> : null}
      <Progress pct={pct} />
      <View style={s.steps}>
        {steps.map((st) => (
          <View key={st.key} style={[s.step, st.done && s.stepDone, st.soon && { opacity: 0.6 }]} accessibilityLabel={`${st.label}: ${st.done ? 'listo' : st.soon ? 'próximamente' : 'pendiente'}`}>
            <Icon name={st.done ? 'checkmark-circle' : st.soon ? 'lock-closed-outline' : 'ellipse-outline'} size={16} color={st.done ? C.success : C.lilac} />
            <Text style={[T.footnote, { color: st.done ? C.text : C.lilac }]} numberOfLines={1}>{st.label}{st.soon ? ' · próximamente' : ''}</Text>
          </View>
        ))}
      </View>
      <PayoutRow payout={payout} error={payoutErr} choice={choice} onPress={() => setOpen(true)} />
      <PayoutSheet visible={open} onClose={() => setOpen(false)} payout={payout ?? null} choice={choice} onSaved={(p) => { setPayout(p); setOpen(false); }} />
      {store ? <ContactRow phone={store.contact_phone ?? null} onPress={() => setContactOpen(true)} /> : null}
      {store ? <LastSeenRow show={store.show_last_seen === true} onSaved={(v) => setStore((cur) => (cur ? { ...cur, show_last_seen: v } : cur))} /> : null}
      <ContactSheet visible={contactOpen} onClose={() => setContactOpen(false)} phone={store?.contact_phone ?? null} isPublic={!!store?.whatsapp_public}
        onSaved={(st) => { setStore((cur) => (cur ? { ...cur, contact_phone: st.contact_phone ?? null, whatsapp_public: !!st.whatsapp_public } : st)); setContactOpen(false); }} />
    </View>
  );
}

/** Última conexión pública (estilo P2P): "En línea" / "Activo hace…". Apagada por defecto: solo con consentimiento (cada cambio queda registrado). */
function LastSeenRow({ show, onSaved }: { show: boolean; onSaved: (v: boolean) => void }) {
  const auth = useAuth();
  const [on, setOn] = useState(show); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => setOn(show), [show]);
  async function change(v: boolean) {
    haptic.tap(); setOn(v); setErr(null); setBusy(true);
    try { const st = await updateMyStore(auth, { show_last_seen: v }); onSaved(st.show_last_seen === true); }
    catch (e) { setOn(!v); setErr(userMessage((e as Error).message)); }
    finally { setBusy(false); }
  }
  return (
    <View style={{ gap: S.xs }}>
      <View style={s.pubRow}>
        <Icon name="time-outline" size={20} color={C.lilac} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={T.body}>{COPY.activity.toggle}</Text>
          <Text style={T.footnote}>{on ? COPY.activity.toggleOn : COPY.activity.toggleOff}</Text>
        </View>
        <Switch value={on} onValueChange={change} disabled={busy} accessibilityLabel={COPY.activity.toggle}
          trackColor={{ true: C.success, false: C.surface2 }} thumbColor={C.white} {...({ activeThumbColor: C.white } as object)} testID="last-seen-switch" />
      </View>
      {err ? <ErrorText>{err}</ErrorText> : null}
    </View>
  );
}

const CONTACT_HINT = 'Agrega tu WhatsApp para que tus compradores te contacten';
/** WhatsApp o teléfono de contacto: sugerencia discreta si falta; si está, el número y "Cambiar". */
function ContactRow({ phone, onPress }: { phone: string | null; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={phone ? 'Cambiar tu WhatsApp de contacto' : CONTACT_HINT} testID="contact-row"
      onPress={() => { haptic.tap(); onPress(); }}
      style={({ pressed }) => [s.contactRow, pressTransition, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
      <Icon name="logo-whatsapp" size={20} color={phone ? C.success : C.lilac} />
      <Text style={[T.footnote, { flex: 1, color: phone ? C.text : C.lilac }]} numberOfLines={2}>
        {phone ? `${formatContactPhone(phone)} · lo ven tus compradores después de pagar` : CONTACT_HINT}
      </Text>
      <Text style={[T.footnote, { color: C.lilac }]}>{phone ? 'Cambiar' : ''}</Text>
      <Icon name="chevron-forward" size={16} color={C.lilac} />
    </Pressable>
  );
}

function ContactSheet({ visible, onClose, phone, isPublic, onSaved }: { visible: boolean; onClose: () => void; phone: string | null; isPublic: boolean; onSaved: (s: Store) => void }) {
  const auth = useAuth();
  const [v, setV] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [pub, setPub] = useState(false); // whatsapp_public: mostrarlo en el perfil público (opt-in)
  useEffect(() => { if (visible) { setV(phone ? formatContactPhone(phone).replace(/^\+506 /, '') : ''); setPub(isPublic); setErr(null); } }, [visible]);
  const n = normalizeContactPhone(v);
  const bad = n === 'invalid' && v.replace(/\D/g, '').length >= 8 ? contactPhoneError(v) : null;
  async function save(next: string | null) {
    setBusy(true); setErr(null);
    try {
      const st = await updateMyStore(auth, next ? { contact_phone: next, whatsapp_public: pub } : { contact_phone: null });
      haptic.success(); toast(next ? 'WhatsApp guardado' : 'WhatsApp quitado');
      onSaved({ ...st, contact_phone: st.contact_phone ?? next, whatsapp_public: !!next && (st.whatsapp_public ?? pub) });
    }
    catch (e) { haptic.error(); setErr(userMessage((e as Error).message)); }
    finally { setBusy(false); }
  }
  return (
    <Sheet visible={visible} onClose={onClose} title="WhatsApp o teléfono"
      footer={<>
        <PrimaryButton title="Guardar" icon="checkmark" loading={busy} disabled={n === null || n === 'invalid'} onPress={() => save(n as string)} />
        {phone ? <PrimaryButton title="Quitar" variant="ghost" disabled={busy} onPress={() => save(null)} /> : null}
      </>}>
      <Text style={T.callout}>Tus compradores lo ven después de pagar, para coordinar el envío o escribirte si algo sale mal.</Text>
      <Text style={T.caption}>WhatsApp o teléfono (opcional)</Text>
      <View style={[ui.input, s.inRow, bad ? { borderColor: C.orange } : n && n !== 'invalid' ? { borderColor: C.success } : null]}>
        <Text style={[T.body, { color: C.textDim }]}>+506</Text>
        <TextInput style={inputPlain} value={v} onChangeText={(x) => setV(x.replace(/^\s*\(?\+506\)?\s*/, '').replace(/[^\d +\-]/g, '').slice(0, 16))} keyboardType="phone-pad" inputMode="tel"
          placeholder="8888 1234" placeholderTextColor={C.textDim} accessibilityLabel="WhatsApp o teléfono, opcional" autoComplete="tel-national" testID="contact-phone-input"
          onSubmitEditing={() => { if (n && n !== 'invalid') save(n); }} />
        {n && n !== 'invalid' ? <Icon name="checkmark-circle" size={20} color={C.success} /> : null}
      </View>
      {bad ? <ErrorText>{bad}</ErrorText> : null}
      {err ? <ErrorText>{err}</ErrorText> : null}
      <View style={s.pubRow}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={T.body}>{COPY.whatsappPublic.label}</Text>
          <Text style={T.footnote}>{pub ? COPY.whatsappPublic.on : COPY.whatsappPublic.off}</Text>
        </View>
        <Switch value={pub} onValueChange={(x) => { haptic.tap(); setPub(x); }} disabled={busy || !(n && n !== 'invalid')} accessibilityLabel={COPY.whatsappPublic.a11y}
          trackColor={{ true: C.purple, false: C.surface2 }} thumbColor={C.white} testID="whatsapp-public-switch" />
      </View>
    </Sheet>
  );
}

/** Fila compacta (Mi tienda): cuenta enmascarada o botón para agregarla. Abre el formulario. */
export function PayoutEntry() {
  const { payout, setPayout, payoutErr, choice } = useProfile();
  const [open, setOpen] = useState(false);
  return <>
    <PayoutRow payout={payout} error={payoutErr} choice={choice} onPress={() => setOpen(true)} compact />
    <PayoutSheet visible={open} onClose={() => setOpen(false)} payout={payout ?? null} choice={choice} onSaved={(p) => { setPayout(p); setOpen(false); }} />
  </>;
}

function PayoutRow({ payout, error, onPress, compact, choice }: { payout: PayoutView | null | undefined; error: string | null; onPress: () => void; compact?: boolean; choice?: boolean }) {
  if (payout === undefined) return <Skeleton h={compact ? 56 : 64} r={R.md} />;
  if (error) return <Text style={[T.footnote, { color: C.orange }]}>{error}</Text>;
  const has = !!payout;
  const wallet = payout?.method === 'wallet' && !!payout.stellar_address;
  // Pantalla principal (Mi tienda): sin la palabra "wallet" ni "USDC"; el detalle está en la hoja.
  const title = !has ? (choice ? 'Elige dónde cobrar' : 'Agrega tu cuenta IBAN') : wallet ? `Stellar ${shortStellar(payout!.stellar_address)}` : payout!.iban_last4 ? maskIban(payout!.iban_last4) : 'Agrega tu cuenta IBAN';
  const sub = !has ? PAYOUT_COPY : wallet ? 'Cobras en Stellar al liberarse cada venta' : `${payout!.holder_name ?? ''}${payout!.sinpe_last4 ? ` · SINPE ${maskPhone(payout!.sinpe_last4)}` : ''}`;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={has ? 'Cambiar dónde cobrar' : choice ? 'Elegir dónde cobrar' : 'Agregar cuenta IBAN para cobrar'} testID="payout-row"
      onPress={() => { haptic.tap(); onPress(); }}
      style={({ pressed }) => [s.payRow, !has && s.payRowEmpty, compact && { paddingVertical: S.sm }, pressTransition, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
      <View style={[s.payIcon, has && { backgroundColor: C.successBg }]}><Icon name={has ? (wallet ? 'swap-horizontal' : 'card') : 'add'} size={20} color={has ? C.success : '#fff'} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={T.headline} numberOfLines={1}>{title}</Text>
        <Text style={T.footnote} numberOfLines={compact ? 1 : 2}>{sub}</Text>
      </View>
      <Text style={[T.footnote, { color: C.lilac }]}>{has ? 'Cambiar' : ''}</Text>
      <Icon name="chevron-forward" size={18} color={C.lilac} />
    </Pressable>
  );
}

const inputPlain = { flex: 1, minWidth: 0, fontSize: 16, color: C.text, paddingVertical: S.sm, outlineStyle: 'none' } as object;

type Method = 'iban' | 'wallet';
const METHOD_LABEL: Record<Method, string> = { iban: 'Cuenta IBAN', wallet: 'Wallet Stellar' };
export const PAYOUT_TEXT = {
  ibanTitle: 'Recibir en tu cuenta (IBAN)',
  walletTitle: 'Recibir USDC en tu wallet Stellar',
  ibanManual: 'Al liberarse una venta, te transferimos a esta cuenta. Lo hacemos a mano, en días hábiles.',
  ibanOnlyRegister: 'Por ahora solo registras la cuenta. Solo tú la ves, y siempre enmascarada. Tu tienda pública nunca la muestra.',
  ibanPrivate: 'Solo tú la ves, enmascarada.',
  walletNote: 'Al liberarse la venta, el USDC llega directo a esta dirección. Revisa bien: un envío a otra dirección no se puede revertir.',
  walletReady: 'Lista para recibir USDC.',
  walletNoTrust: 'Tu wallet todavía no acepta USDC. Agrega USDC (trustline) en tu wallet; mientras tanto, cobras en tu cuenta de Meteorito.',
  walletNoAccount: 'Esa wallet todavía no existe en Stellar. Actívala con un poco de XLM y vuelve a intentar.',
  fromNow: 'Aplica a las ventas que se paguen desde ahora.',
};

export function PayoutSheet({ visible, onClose, payout, onSaved, choice = false }: { visible: boolean; onClose: () => void; payout: PayoutView | null; onSaved: (p: PayoutView) => void; choice?: boolean }) {
  const auth = useAuth();
  const [method, setMethod] = useState<Method>('iban');
  const [iban, setIban] = useState(''); const [holder, setHolder] = useState(''); const [sinpe, setSinpe] = useState('');
  const [addr, setAddr] = useState(''); const [check, setCheck] = useState<WalletCheck | 'checking' | null>(null);
  const [touched, setTouched] = useState(false); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setMethod(choice && payout?.method === 'wallet' ? 'wallet' : 'iban');
    setIban(''); setHolder(payout?.holder_name ?? ''); setSinpe(''); setAddr(payout?.stellar_address ?? ''); setCheck(null); setTouched(false); setErr(null);
  }, [visible]);
  const raw = normalizeIban(iban);
  const ibanErr = crIbanError(raw);
  const showIbanErr = (touched || raw.length >= 22) && raw.length > 0 && ibanErr;
  const sinpeN = normalizeSinpe(sinpe);
  const okIban = !ibanErr && holder.trim().length >= 3 && sinpeN !== 'invalid';
  const a = addr.trim().toUpperCase();
  const addrErr = stellarAddressError(a);
  const showAddrErr = a.length > 0 && (a.length >= 56 || touched) && addrErr;
  // Revisa la wallet en Stellar (cuenta + trustline USDC) en cuanto la dirección está completa.
  useEffect(() => {
    if (method !== 'wallet' || addrErr) { setCheck(null); return; }
    let live = true; setCheck('checking');
    checkPayoutWallet(auth, a).then((st) => live && setCheck(st)).catch((e) => { if (live) { setCheck(null); setErr(userMessage((e as Error).message)); } });
    return () => { live = false; };
  }, [a, method]); // eslint-disable-line react-hooks/exhaustive-deps
  const okWallet = !addrErr && (check === 'ready' || check === 'no_trustline');
  const ok = method === 'wallet' ? okWallet : okIban;
  async function save() {
    setTouched(true); if (!ok) return;
    setBusy(true); setErr(null);
    try {
      const p = method === 'wallet' ? (await savePayoutWallet(auth, a)).payout : await savePayout(auth, { iban: raw, holder_name: holder, sinpe_phone: sinpeN || undefined });
      haptic.success(); toast(method === 'wallet' ? 'Wallet guardada' : 'Cuenta guardada'); onSaved(p);
    }
    catch (e) { haptic.error(); setErr(userMessage((e as Error).message)); }
    finally { setBusy(false); }
  }
  return (
    <Sheet visible={visible} onClose={onClose} title={choice ? 'Dónde cobrar' : payout ? 'Cambiar cuenta para cobrar' : 'Tu cuenta para cobrar'}
      footer={<PrimaryButton title={method === 'wallet' ? 'Guardar wallet' : 'Guardar cuenta'} icon="checkmark" loading={busy} disabled={!ok} onPress={save} />}>
      {choice ? <View style={s.seg} accessibilityRole="tablist">
        {(['iban', 'wallet'] as Method[]).map((m) => {
          const on = m === method;
          return (
            <Pressable key={m} testID={`payout-${m}`} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={m === 'iban' ? PAYOUT_TEXT.ibanTitle : PAYOUT_TEXT.walletTitle}
              onPress={() => { haptic.tap(); setMethod(m); setErr(null); setTouched(false); }}
              style={({ pressed }) => [s.segBtn, on && s.segOn, pressTransition, pressed && { opacity: 0.85 }]}>
              <Icon name={m === 'iban' ? 'card' : 'swap-horizontal'} size={18} color={on ? C.purple : C.lilac} />
              <Text style={[T.headline, { color: on ? C.purple : C.text }]} numberOfLines={1}>{METHOD_LABEL[m]}</Text>
            </Pressable>
          );
        })}
      </View> : null}
      {method === 'wallet' ? <>
        <Text style={T.callout}>{PAYOUT_TEXT.walletTitle}</Text>
        <Text style={T.caption}>Dirección de tu wallet</Text>
        <View style={[ui.input, s.inRow, showAddrErr || check === 'no_account' ? { borderColor: C.orange } : check === 'ready' ? { borderColor: C.success } : null]}>
          <TextInput style={[inputPlain, { fontVariant: ['tabular-nums'] }]} value={addr} onChangeText={(v) => setAddr(v.replace(/\s/g, '').toUpperCase().slice(0, 56))}
            onBlur={() => setTouched(true)} placeholder="G…" placeholderTextColor={C.textDim} autoCapitalize="characters" autoCorrect={false} autoComplete="off"
            accessibilityLabel="Dirección de tu wallet Stellar" testID="payout-address" />
          {check === 'ready' ? <Icon name="checkmark-circle" size={20} color={C.success} /> : null}
        </View>
        {showAddrErr ? <ErrorText>{addrErr}</ErrorText>
          : check === 'checking' ? <Text style={T.footnote}>Revisando la wallet…</Text>
          : check === 'ready' ? <Text testID="payout-check" style={[T.footnote, { color: C.success }]}>{PAYOUT_TEXT.walletReady}</Text>
          : check === 'no_trustline' ? <Text testID="payout-check" style={[T.footnote, { color: C.orange }]}>{PAYOUT_TEXT.walletNoTrust}</Text>
          : check === 'no_account' ? <ErrorText>{PAYOUT_TEXT.walletNoAccount}</ErrorText>
          : <Text style={T.footnote}>Empieza con G y tiene 56 caracteres. Cópiala desde tu wallet.</Text>}
        {err ? <ErrorText>{err}</ErrorText> : null}
        <Text style={T.footnote}>{PAYOUT_TEXT.walletNote} {PAYOUT_TEXT.fromNow}</Text>
      </> : <>
        <Text style={T.callout}>{choice ? PAYOUT_TEXT.ibanTitle : PAYOUT_COPY}</Text>
        {payout?.iban_last4 ? <Text style={T.footnote}>Actual: {maskIban(payout.iban_last4)}. Escribe la cuenta completa para cambiarla.</Text> : null}
        <Text style={T.caption}>Cuenta IBAN</Text>
        <View style={[ui.input, s.inRow, showIbanErr ? { borderColor: C.orange } : !ibanErr ? { borderColor: C.success } : null]}>
          <TextInput style={[inputPlain, { fontVariant: ['tabular-nums'], letterSpacing: 0.5 }]} value={formatIban(iban)} onChangeText={(v) => setIban(normalizeIban(v).slice(0, 22))}
            onBlur={() => setTouched(true)} placeholder="CR00 0000 0000 0000 0000 00" placeholderTextColor={C.textDim} autoCapitalize="characters" autoCorrect={false}
            maxLength={27} accessibilityLabel="Cuenta IBAN" autoComplete="off" />
          {!ibanErr ? <Icon name="checkmark-circle" size={20} color={C.success} /> : null}
        </View>
        {showIbanErr ? <ErrorText>{ibanErr}</ErrorText> : <Text style={T.footnote}>CR y 20 números. La ves en los datos de tu cuenta.</Text>}
        <Text style={T.caption}>Nombre del titular</Text>
        <TextInput style={ui.input} value={holder} onChangeText={setHolder} maxLength={80} placeholder="Como aparece en tu cuenta" placeholderTextColor={C.textDim}
          autoComplete="name" accessibilityLabel="Nombre del titular" />
        <Text style={T.caption}>SINPE Móvil (opcional)</Text>
        <View style={[ui.input, s.inRow]}>
          <Text style={[T.body, { color: C.textDim }]}>+506</Text>
          <TextInput style={inputPlain} value={sinpe} onChangeText={(v) => setSinpe(v.replace(/[^\d ]/g, '').slice(0, 9))} keyboardType="phone-pad"
            placeholder="8888 1234" placeholderTextColor={C.textDim} accessibilityLabel="SINPE Móvil, opcional" autoComplete="tel-national" />
        </View>
        {sinpeN === 'invalid' && sinpe.replace(/\D/g, '').length >= 8 ? <ErrorText>El SINPE Móvil son 8 dígitos (ej. 8888 1234).</ErrorText> : null}
        {err ? <ErrorText>{err}</ErrorText> : null}
        <Text style={T.footnote}>{choice ? `${PAYOUT_TEXT.ibanManual} ${PAYOUT_TEXT.ibanPrivate}` : PAYOUT_TEXT.ibanOnlyRegister}</Text>
      </>}
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
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: S.xs, minHeight: 44 },
  inRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  pubRow: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.xs },
  seg: { flexDirection: 'row', gap: S.xs },
  segBtn: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  segOn: { backgroundColor: C.white, borderColor: C.white },
});
