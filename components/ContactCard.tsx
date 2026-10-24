// "Recibe avisos de tu compra": paso OPCIONAL del comprador sin cuenta, después de pagar. Nunca bloquea el pago ni sale
// de la página: WhatsApp o correo se guardan aquí mismo; "Crear cuenta" abre el login de Cavos sobre esta misma URL
// (/p/<slug>) y, al volver (aunque sea por redirect de Google/Apple), vincula la llave de este dispositivo con la cuenta.
// Sin la migración 028 el servidor responde available:false y la tarjeta no aparece.
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ErrorText, haptic, Icon, IconButton, PrimaryButton, toast, type IconName } from '@/components/ds';
import { Fonts } from '@/constants/Colors';
import { C, R, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { track } from '@/lib/analytics';
import {
  clearLinkPending, contactDismissed, dismissContact, getContacts, linkAccount, linkPendingFor, markLinkPending, saveContact, type ContactState,
} from '@/lib/buyerContact';
import { CONTACT_CONSENT_TEXT, DEFAULT_COUNTRY_CODE, normalizeEmail, normalizePhone, type ContactChannel } from '../api/_lib/contactText';

export const CONTACT_TITLE = 'Recibe avisos de tu compra';
const OPTIONS: { id: ContactChannel; label: string; icon: IconName }[] = [
  { id: 'whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp' },
  { id: 'email', label: 'Correo', icon: 'mail-outline' },
  { id: 'account', label: 'Crear cuenta', icon: 'person-circle-outline' },
];
const SAVED: Record<ContactChannel, (m: string) => string> = {
  whatsapp: (m) => `Por WhatsApp a ${m}`,
  email: (m) => `Por correo a ${m}`,
  account: (m) => (m === 'Tu cuenta' ? 'En tu cuenta de Meteorito' : `En tu cuenta (${m})`),
};

export function ContactCard({ slug }: { slug: string }) {
  const auth = useAuth();
  const [state, setState] = useState<ContactState | null>(null);
  const [hidden, setHidden] = useState(() => contactDismissed(slug) && !linkPendingFor(slug));
  const [pick, setPick] = useState<ContactChannel | null>(null);
  const [cc, setCc] = useState(DEFAULT_COUNTRY_CODE);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(() => linkPendingFor(slug));
  const linking = useRef(false);

  const refresh = () => getContacts(auth, slug).then(setState).catch(() => setState({ available: false, contacts: [], email: false }));
  useEffect(() => { if (!hidden) refresh(); }, [slug, hidden]); // eslint-disable-line react-hooks/exhaustive-deps

  // Vuelta del login (mismo /p/<slug>, en esta pestaña o tras el redirect): vincular una sola vez.
  const token = auth.isAuthenticated ? auth.getAuthToken?.() : null;
  useEffect(() => {
    if (!pending || !token || linking.current) return;
    linking.current = true; setBusy(true); setErr(null);
    linkAccount(auth, slug)
      .then((r) => {
        clearLinkPending(); setPending(false);
        if (r.linked) { haptic.success(); toast('Listo: tu compra quedó en tu cuenta'); track('buyer_contact_saved', { channel: 'account' }); refresh(); }
        else setErr('Tu cuenta quedó lista. Por ahora tu compra sigue solo en este navegador.');
      })
      .catch((e) => { setErr((e as Error).message); })
      .finally(() => { linking.current = false; setBusy(false); });
  }, [pending, token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (hidden || !state?.available) return null;
  const saved = state.contacts;
  const have = new Set(saved.map((c) => c.channel));
  const options = OPTIONS.filter((o) => !have.has(o.id));
  const phoneOk = !!normalizePhone(cc, phone), emailOk = !!normalizeEmail(email);
  const valueOk = pick === 'whatsapp' ? phoneOk : pick === 'email' ? emailOk : pick === 'account';
  const authed = auth.isAuthenticated;

  async function submit() {
    if (!pick || !consent || !valueOk) return;
    setErr(null); haptic.tap();
    if (pick === 'account') {
      if (authed && token) { markLinkPending(slug); setPending(true); return; } // ya hay sesión: vincula directo (efecto de arriba)
      markLinkPending(slug); setPending(true); track('buyer_contact_account_started');
      auth.openLogin(); // modal de Cavos sobre esta página; Google/Apple vuelven a esta misma URL
      return;
    }
    setBusy(true);
    try {
      const r = await saveContact(auth, slug, pick === 'whatsapp' ? { channel: 'whatsapp', cc, phone } : { channel: 'email', email });
      haptic.success(); track('buyer_contact_saved', { channel: pick });
      toast(r.emailed ? 'Listo: te enviamos tu link de acceso por correo' : 'Listo: guardamos tu contacto');
      setPick(null); setPhone(''); setEmail(''); setConsent(false);
      setState((s) => (s ? { ...s, contacts: [...s.contacts.filter((c) => c.channel !== r.contact.channel), r.contact] } : s));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <View style={s.card} testID="contact-card">
      <View style={{ flexDirection: 'row', gap: S.sm + 4, alignItems: 'flex-start' }}>
        <View style={s.icon}><Icon name="notifications-outline" size={20} color="#fff" /></View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={T.headline}>{CONTACT_TITLE}</Text>
          <Text style={T.footnote}>{saved.length ? 'Te avisamos cuando cambie tu compra:' : 'Opcional. Si cambias de teléfono o borras este navegador, así vuelves a tu compra.'}</Text>
        </View>
        {!pending ? <IconButton icon="close" label="Ahora no" onPress={() => { dismissContact(slug); setHidden(true); track('buyer_contact_dismissed'); }} /> : null}
      </View>

      {saved.map((c) => (
        <View key={c.channel} style={s.savedRow} testID={`contact-saved-${c.channel}`}>
          <Icon name="checkmark-circle" size={20} color={C.success} />
          <Text style={[T.callout, { flex: 1, minWidth: 0 }]} numberOfLines={2}>{SAVED[c.channel](c.masked)}</Text>
        </View>
      ))}

      {pending ? <View style={{ gap: S.sm }} testID="contact-account-pending">
        <Text style={T.callout}>{busy ? 'Guardando tu compra en tu cuenta…' : 'Termina de entrar con tu cuenta. Tu compra sigue aquí mientras tanto.'}</Text>
        {!busy ? <View style={s.row}>
          <PrimaryButton title="Entrar" icon="log-in-outline" onPress={() => auth.openLogin()} />
          <PrimaryButton title="Cancelar" variant="ghost" onPress={() => { clearLinkPending(); setPending(false); }} />
        </View> : null}
      </View> : options.length ? <>
        <View style={s.options} accessibilityRole="radiogroup">
          {options.map((o) => {
            const on = pick === o.id;
            return <Pressable key={o.id} testID={`contact-opt-${o.id}`} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={o.id === 'account' && authed ? 'Guardar en mi cuenta' : o.label}
              onPress={() => { haptic.tap(); setPick(on ? null : o.id); setErr(null); }} style={({ pressed }) => [s.opt, on && s.optOn, pressed && { opacity: 0.8 }]}>
              <Icon name={o.icon} size={18} color={on ? C.purpleDark : C.lilac} />
              <Text style={[s.optText, on && { color: C.purpleDark }]} numberOfLines={1}>{o.id === 'account' && authed ? 'Mi cuenta' : o.label}</Text>
            </Pressable>;
          })}
        </View>

        {pick === 'whatsapp' ? <View style={s.row}>
          <TextInput testID="contact-cc" style={[s.input, { width: 76, flexGrow: 0 }]} value={cc} onChangeText={(v) => setCc(v.replace(/[^\d+]/g, '').slice(0, 4))}
            inputMode="tel" keyboardType="phone-pad" autoComplete="tel-country-code" accessibilityLabel="Código de país" maxLength={4} />
          <TextInput testID="contact-phone" style={[s.input, { flex: 1 }]} value={phone} onChangeText={(v) => setPhone(v.slice(0, 20))} placeholder="8888 7777" placeholderTextColor={C.textDim}
            inputMode="tel" keyboardType="phone-pad" autoComplete="tel-national" textContentType="telephoneNumber" accessibilityLabel="Número de WhatsApp" />
        </View> : null}
        {pick === 'email' ? <TextInput testID="contact-email" style={s.input} value={email} onChangeText={(v) => setEmail(v.slice(0, 254))} placeholder="tu@correo.com" placeholderTextColor={C.textDim}
          inputMode="email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" accessibilityLabel="Correo" /> : null}
        {pick === 'account' ? <Text style={T.footnote}>{authed ? 'Guardamos esta compra en la cuenta con la que entraste.' : 'Entra con Google, Apple o tu correo sin salir de esta compra. La verás en cualquier teléfono y también sigue en este navegador.'}</Text> : null}

        {pick ? <>
          <Pressable testID="contact-consent" accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => { haptic.tap(); setConsent((v) => !v); }} hitSlop={4} style={s.consent}>
            <Icon name={consent ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={consent ? C.lilac : C.textDim} />
            <Text style={[T.footnote, { flex: 1, color: C.text }]}>{CONTACT_CONSENT_TEXT}</Text>
          </Pressable>
          {err ? <ErrorText>{err}</ErrorText> : null}
          <PrimaryButton testID="contact-save" title={pick === 'account' ? (authed ? 'Guardar en mi cuenta' : 'Crear cuenta') : 'Guardar'} icon={pick === 'account' ? 'person-circle-outline' : 'checkmark'}
            loading={busy} disabled={!consent || !valueOk} onPress={submit} />
        </> : null}
      </> : null}
      {!pick && err ? <ErrorText>{err}</ErrorText> : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { gap: S.sm + 2, backgroundColor: C.surface, borderRadius: R.lg, padding: S.sm + 4, borderWidth: 1, borderColor: C.line },
  icon: { width: 40, height: 40, borderRadius: 14, backgroundColor: C.lilac, alignItems: 'center', justifyContent: 'center' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: R.md, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line, flexGrow: 1, justifyContent: 'center' },
  optOn: { backgroundColor: C.lilacBg, borderColor: C.lilac },
  optText: { fontFamily: Fonts.bold, fontSize: 15, color: C.text },
  row: { flexDirection: 'row', gap: S.sm, alignItems: 'center', flexWrap: 'wrap' },
  input: { backgroundColor: C.surface2, borderRadius: R.md, paddingHorizontal: S.md, minHeight: 48, color: C.text, fontFamily: Fonts.regular, fontSize: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, minWidth: 0 },
  savedRow: { flexDirection: 'row', gap: S.sm, alignItems: 'center' },
  consent: { flexDirection: 'row', gap: S.sm, alignItems: 'flex-start', minHeight: 44, paddingVertical: 4 },
});
