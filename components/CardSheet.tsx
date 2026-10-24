// Pago con tarjeta con NUESTRO formulario (sin widget de terceros). Ver docs/lendara-card.md.
// - El número y el CVC se quedan en este componente: nunca van en requests, logs ni analítica (al servidor solo va
//   nombre, correo y el resultado de la tarjeta). Al cerrar la hoja se borran.
// - iOS: autocomplete cc-* para autollenar tarjeta, teclado numérico (inputMode), letra ≥16 px (sin zoom al enfocar).
// - PostHog: los campos llevan data-ph-no-autocapture y el contenedor ph-no-capture / ph-sensitive (autocapture y
//   grabación ya están apagados en lib/analytics.ts; esto es defensa extra).
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { ErrorText, Icon, PrimaryButton, Sheet } from '@/components/ds';
import { LivelyMascot } from '@/components/space';
import { Fonts } from '@/constants/Colors';
import { C, R, S, T, TOUCH } from '@/constants/theme';
import { cardBrand, digits, formatCardNumber, formatExpiry, scenarioFor, validateCard, type CardErrors, type CardForm, type CardScenario } from '@/lib/card';
import { formatCRC } from '@/lib/orders';

const WEB = Platform.OS === 'web';
const EMPTY: CardForm = { name: '', email: '', number: '', expiry: '', cvc: '' };
export type CardPayInput = { name: string; email: string; scenario: CardScenario };

export function CardSheet({ visible, amountCrc, onClose, onPay, onSinpe }: {
  visible: boolean; amountCrc: number; onClose: () => void;
  /** Cobra (servidor) y espera la confirmación. Lanza Error con el mensaje para la persona si no se pudo. */
  onPay: (p: CardPayInput) => Promise<void>;
  onSinpe: () => void;
}) {
  const [f, setF] = useState<CardForm>(EMPTY);
  const [errs, setErrs] = useState<CardErrors>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const wrap = useRef<View>(null);
  // Al cerrar: fuera número, vencimiento y CVC (nombre y correo se quedan para reintentar).
  useEffect(() => { if (!visible) { setF((x) => ({ ...EMPTY, name: x.name, email: x.email })); setErrs({}); setMsg(null); setProcessing(false); } }, [visible]);
  useEffect(() => {
    if (!WEB || !visible) return;
    const el = wrap.current as unknown as HTMLElement | null;
    el?.classList?.add('ph-no-capture', 'ph-sensitive'); // estilo fijo: react-native-web no reescribe su className
  }, [visible, processing]);

  const set = (k: keyof CardForm) => (v: string) => {
    setF((x) => ({ ...x, [k]: k === 'number' ? formatCardNumber(v) : k === 'expiry' ? formatExpiry(v, x.expiry) : k === 'cvc' ? digits(v).slice(0, 4) : v }));
    if (errs[k]) setErrs((e) => ({ ...e, [k]: undefined }));
    setMsg(null);
  };
  const brand = cardBrand(f.number);

  async function submit() {
    const e = validateCard(f);
    const first = (['number', 'expiry', 'cvc', 'name', 'email'] as const).find((k) => e[k]);
    if (first) { setErrs(e); setMsg(e[first]!); return; }
    const scenario = scenarioFor(f.number)!;
    setProcessing(true); setMsg(null);
    try { await onPay({ name: f.name.replace(/\s+/g, ' ').trim(), email: f.email.trim(), scenario }); }
    catch (x) { setMsg((x as Error).message); setF((y) => ({ ...y, cvc: '' })); }
    finally { setProcessing(false); }
  }

  if (processing) return (
    <Sheet visible={visible} onClose={() => {}}>
      <View style={s.processing} accessibilityLiveRegion="polite" testID="card-processing">
        <LivelyMascot size={120} parallax={0} />
        <Text style={[T.headline, { textAlign: 'center' }]}>Estamos confirmando tu pago…</Text>
        <Text style={[T.callout, { textAlign: 'center' }]}>Puede tardar unos segundos. No cierres esta pantalla.</Text>
      </View>
    </Sheet>
  );

  return (
    <Sheet visible={visible} onClose={onClose} title="Pagar con tarjeta"
      footer={<>
        {msg && <ErrorText>{msg}</ErrorText>}
        <PrimaryButton title={`Pagar ${formatCRC(amountCrc)}`} icon="lock-closed" onPress={submit} testID="card-pay" />
        <PrimaryButton title="Pagar por SINPE Móvil" icon="phone-portrait-outline" variant="ghost" onPress={onSinpe} />
      </>}>
      <View ref={wrap} style={s.form} {...(WEB ? { dataSet: { phNoAutocapture: 'true', cardForm: '1' } } : {})}>
        <Field label="Número de tarjeta" err={!!errs.number} right={<Brand b={brand} />}
          value={f.number} onChangeText={set('number')} placeholder="1234 1234 1234 1234" autoComplete="cc-number" inputMode="numeric"
          keyboardType="number-pad" name="cardnumber" testID="card-number" maxLength={23} />
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <View style={{ flex: 1 }}>
            <Field label="Vencimiento" err={!!errs.expiry} value={f.expiry} onChangeText={set('expiry')} placeholder="MM/AA"
              autoComplete="cc-exp" inputMode="numeric" keyboardType="number-pad" name="cc-exp" testID="card-exp" maxLength={5} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="CVC" err={!!errs.cvc} value={f.cvc} onChangeText={set('cvc')} placeholder={brand === 'amex' ? '4 dígitos' : '3 dígitos'}
              autoComplete="cc-csc" inputMode="numeric" keyboardType="number-pad" name="cvc" testID="card-cvc" maxLength={4} secureTextEntry={false} />
          </View>
        </View>
        <Field label="Nombre en la tarjeta" err={!!errs.name} value={f.name} onChangeText={set('name')} placeholder="Como aparece en la tarjeta"
          autoComplete="cc-name" autoCapitalize="words" autoCorrect={false} name="ccname" testID="card-name" maxLength={80} />
        <Field label="Correo" err={!!errs.email} value={f.email} onChangeText={set('email')} placeholder="tu@correo.com"
          autoComplete="email" inputMode="email" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} name="email" testID="card-email" maxLength={254} />
        <View style={s.note}>
          <Icon name="shield-checkmark" size={16} color={C.lilac} />
          <Text style={[T.footnote, { flex: 1 }]}>Tu pago queda en custodia hasta que recibes el producto.</Text>
        </View>
      </View>
    </Sheet>
  );
}

function Field({ label, err, right, name, testID, ...p }: TextInputProps & { label: string; err: boolean; right?: React.ReactNode; name: string; testID: string }) {
  const ref = useRef<TextInput>(null);
  useEffect(() => { // atributos que react-native-web no pasa: name (autollenado de iOS/Chrome)
    const el = ref.current as unknown as HTMLInputElement | null;
    if (WEB && el?.setAttribute) { el.setAttribute('name', name); el.setAttribute('autocorrect', 'off'); el.setAttribute('spellcheck', 'false'); }
  }, [name]);
  return (
    <View style={{ gap: S.xs }}>
      <Text style={s.label}>{label}</Text>
      <View style={[s.inputWrap, err && s.inputErr]}>
        <TextInput ref={ref} {...p} testID={testID} accessibilityLabel={label} placeholderTextColor={C.textDim} style={s.input}
          {...(WEB ? { dataSet: { phNoAutocapture: 'true' } } : {})} />
        {right}
      </View>
    </View>
  );
}

const BRAND_LABEL: Record<string, string> = { visa: 'VISA', mastercard: 'Mastercard', amex: 'AMEX' };
function Brand({ b }: { b: ReturnType<typeof cardBrand> }) {
  if (b === 'unknown') return <View style={s.brandSlot}><Icon name="card" size={22} color={C.textDim} /></View>;
  return <View style={s.brandSlot} accessibilityLabel={BRAND_LABEL[b]}><View style={s.brand}><Text style={s.brandText}>{BRAND_LABEL[b]}</Text></View></View>;
}

const s = StyleSheet.create({
  form: { gap: S.sm + 4 },
  label: { fontFamily: Fonts.bold, fontSize: 12, lineHeight: 16, color: C.textDim },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg, borderRadius: R.md, borderWidth: 1, borderColor: C.line, minHeight: TOUCH + 4 },
  inputErr: { borderColor: C.orange },
  input: { flex: 1, minWidth: 0, minHeight: TOUCH + 4, paddingHorizontal: S.md, color: C.text, fontFamily: Fonts.regular, fontSize: 17, ...(WEB ? { outlineStyle: 'none' } as object : {}) },
  brandSlot: { paddingRight: S.sm + 4, alignItems: 'center', justifyContent: 'center' },
  brand: { backgroundColor: C.white, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  brandText: { fontFamily: Fonts.black, fontSize: 11, color: C.purple, letterSpacing: 0.5 },
  note: { flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingTop: S.xs },
  processing: { alignItems: 'center', gap: S.md, paddingVertical: S.lg },
});
