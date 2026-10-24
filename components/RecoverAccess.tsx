// Otro dispositivo, sin acceso a la compra: pedir un link nuevo al correo guardado. La respuesta es siempre la misma
// (no revela si el correo está o no en la compra).
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { ErrorText, PrimaryButton } from '@/components/ds';
import { Fonts } from '@/constants/Colors';
import { C, R, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { requestAccess } from '@/lib/buyerContact';
import { normalizeEmail } from '../api/_lib/contactText';

export function RecoverAccess({ slug }: { slug: string }) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!open) return <PrimaryButton testID="recover-open" title="¿Pagaste tú? Recupera tu acceso" icon="key-outline" variant="ghost" onPress={() => setOpen(true)} />;
  if (done) return <Text testID="recover-done" style={[T.footnote, { textAlign: 'center' }]}>Si ese correo está en esta compra, te enviamos un link de acceso. Revisa tu bandeja y el spam.</Text>;
  return (
    <View style={{ gap: S.sm }} testID="recover-form">
      <Text style={T.footnote}>Escribe el correo que guardaste al pagar y te enviamos un link para abrir tu compra aquí.</Text>
      <TextInput testID="recover-email" style={s.input} value={email} onChangeText={(v) => setEmail(v.slice(0, 254))} placeholder="tu@correo.com" placeholderTextColor={C.textDim}
        inputMode="email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" accessibilityLabel="Correo" />
      {err ? <ErrorText>{err}</ErrorText> : null}
      <PrimaryButton title="Enviarme el link" icon="mail-outline" loading={busy} disabled={!normalizeEmail(email)}
        onPress={async () => { setBusy(true); setErr(null); try { await requestAccess(auth, slug, email); setDone(true); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }} />
    </View>
  );
}
const s = StyleSheet.create({
  input: { backgroundColor: C.surface2, borderRadius: R.md, paddingHorizontal: S.md, minHeight: 48, color: C.text, fontFamily: Fonts.regular, fontSize: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
});
