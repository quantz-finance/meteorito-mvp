// Vendedor SIN cuenta (opción A, solo testnet): resumen exacto del acuerdo, aviso de beta, cobro simulado y aceptación con
// un código por correo. Todo lo que se verifica se explica ANTES de aceptar. "O entra con tu cuenta" sigue el camino de Cavos.
// También: recuperar el acceso (otro navegador) y el panel del pedido ya aceptado (envío, PIN, disputa) con la sesión del pedido.
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Card, Chip, ErrorText, Icon, MoneyTimeline, PrimaryButton } from '@/components/ds';
import { LegalRuleRows } from '@/components/LegalRules';
import { SellerActions } from '@/components/SellerActions';
import { SellerDisputeReply } from '@/components/SellerDisputeReply';
import { ui } from '@/components/ui';
import { C, R, S, T } from '@/constants/theme';
import { Fonts } from '@/constants/Colors';
import { userMessage } from '@/lib/cavosSession';
import { formatCRC } from '@/lib/orders';
import { currentLegalRules } from '@/lib/rules';
import type { Invite, SellerOrderView } from '@/lib/invites';
import { acceptAsSeller, recoverSeller, requestRecoverCode, requestSellerCode, sellerCall } from '@/lib/sellerGuest';
import { protectionLabel, DELIVERY_LABEL, type DeliveryMode } from '../api/_lib/agreement';
import { IBAN_PLACEHOLDER } from '../api/_lib/payout';
import { SELLER_GUEST_BETA, SELLER_GUEST_CONSENT_TEXT, SELLER_GUEST_CUSTODY, SELLER_GUEST_EXCEPTION, SELLER_GUEST_PAYOUT, SELLER_GUEST_RECEIPT, SELLER_GUEST_VERIFY,
  protectionText } from '../api/_lib/sellerGuestText';
import { LEGAL } from '@/lib/legal';

export function BetaBox() {
  return <View testID="seller-guest-beta" accessibilityRole="alert" style={st.beta}>
    <Icon name="flask-outline" size={18} color={C.orange} />
    <Text style={[T.callout, { flex: 1, color: C.text }]}>{SELLER_GUEST_BETA}</Text>
  </View>;
}

/** Excepción visible: en esta prueba el pago liberado NO llega a la wallet del vendedor (revisión de Harvey). */
export function ExceptionBox() {
  return <View testID="seller-guest-exception" style={st.exc}>
    <Text style={[T.footnote, { color: C.text }]}>{SELLER_GUEST_EXCEPTION}</Text>
    <Text style={T.footnote}>{SELLER_GUEST_CUSTODY}</Text>
  </View>;
}

/** Link al aviso de privacidad del vendedor sin cuenta (/legal/vendedor). En la web abre otra pestaña: no se pierde el formulario. */
function openNotice() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') { window.open('/legal/vendedor', '_blank', 'noopener'); return; }
  router.push({ pathname: '/legal/[doc]', params: { doc: 'vendedor' } });
}
export function PrivacyConsent({ checked, onToggle, disabled }: { checked: boolean; onToggle: () => void; disabled?: boolean }) {
  return <View style={{ gap: S.xs }}>
    <Pressable testID="seller-guest-privacy-link" accessibilityRole="link" onPress={openNotice} hitSlop={6} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={[T.callout, { color: C.lilac, textDecorationLine: 'underline' }]}>Lee el {LEGAL.vendedor.title.charAt(0).toLowerCase() + LEGAL.vendedor.title.slice(1)}</Text>
    </Pressable>
    <Pressable testID="seller-guest-consent" accessibilityRole="checkbox" accessibilityState={{ checked, disabled: !!disabled }} disabled={disabled}
      onPress={onToggle} hitSlop={4} style={st.consent}>
      <Icon name={checked ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={checked ? C.lilac : C.textDim} />
      <Text style={[T.footnote, { flex: 1, color: C.text }]}>{SELLER_GUEST_CONSENT_TEXT}</Text>
    </Pressable>
  </View>;
}

/** Resumen exacto + formulario. available=false: solo el resumen (el camino con cuenta sigue en el pie). */
export function SellerGuestAccept({ inv, onAccepted, onLogin }: { inv: Invite; onAccepted: () => void; onLogin: () => void }) {
  const g = inv.seller_guest;
  const [mode, setMode] = useState<DeliveryMode>('envio');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [consent, setConsent] = useState(false); // nunca marcada de antemano
  const [ch, setCh] = useState<{ id: string; to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const a = g?.agreements?.[mode];
  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(null); try { await f(); } catch (e) { setErr(userMessage((e as Error).message)); } finally { setBusy(false); } };

  return <View style={{ gap: S.md }}>
    <Card testID="seller-guest-summary" style={{ gap: S.sm }}>
      <Text style={T.caption}>Lo que aceptas</Text>
      <Row k="Producto" v={`${inv.brand} ${inv.model}`.trim()} />
      <Row k="Recibes" v={`${formatCRC(inv.price_crc)} (en USDC de prueba)`} strong />
      <Text style={T.caption}>Entrega</Text>
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        {(['envio', 'cara_a_cara'] as DeliveryMode[]).map((m) => (
          <Pressable key={m} testID={`seller-guest-mode-${m}`} accessibilityRole="radio" accessibilityState={{ selected: mode === m }} disabled={!!ch}
            onPress={() => { setMode(m); setErr(null); }} style={[st.mode, mode === m && st.modeOn, !!ch && { opacity: 0.6 }]}>
            <Text style={[T.headline, { fontSize: 15, color: mode === m ? C.lilac : C.text }]}>{DELIVERY_LABEL[m]}</Text>
          </Pressable>
        ))}
      </View>
      <Row k="Plazo de reclamo" v={a ? protectionLabel(a.protection_minutes) : protectionLabel(mode === 'envio' ? 10080 : 1440)} />
      <Text style={T.footnote}>{protectionText(mode)}</Text>
      <LegalRuleRows rules={currentLegalRules(mode)} heading="Reglas de esta venta" />
      <Text style={T.footnote} testID="seller-guest-rules-timing">Los plazos se revisan una vez al día: un reembolso automático puede aplicarse hasta un día después de vencido el plazo.</Text>
      <View style={st.exc} testID="seller-guest-soon">
        <Text style={[T.headline, { fontSize: 15 }]}>Próximamente sin cuenta</Text>
        <Text style={T.footnote}>Responder desde este link a un reporte hecho después de liberado el pago, y ver tu historial de ventas. Hoy eso solo está disponible con cuenta.</Text>
      </View>
    </Card>

    <Card testID="seller-guest-payout" style={{ gap: S.xs }}>
      <Text style={T.caption}>Dónde cobras</Text>
      <View style={[st.mode, st.modeOn, { flexDirection: 'row', alignItems: 'center', gap: S.sm }]} accessibilityRole="radio" accessibilityState={{ selected: true }}>
        <Icon name="radio-button-on" size={18} color={C.lilac} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[T.headline, { fontSize: 15 }]}>Cuenta bancaria (IBAN) · simulación</Text>
          <Text style={T.footnote}>Cuenta de ejemplo {IBAN_PLACEHOLDER}. No te pedimos ni guardamos tu IBAN real.</Text>
        </View>
      </View>
      <Text style={T.footnote}>{SELLER_GUEST_PAYOUT}</Text>
      <ExceptionBox />
    </Card>

    <BetaBox />

    {g?.available && a ? <Card testID="seller-guest-form" style={{ gap: S.sm }}>
      <Text style={T.caption}>Acepta sin crear cuenta</Text>
      <Text testID="seller-guest-verify" style={T.callout}>{SELLER_GUEST_VERIFY}</Text>
      {!ch ? <>
        <TextInput testID="seller-guest-email" style={ui.input} placeholder="tu@correo.com" placeholderTextColor={C.textDim} value={email} onChangeText={setEmail}
          keyboardType="email-address" autoCapitalize="none" autoComplete="email" inputMode="email" accessibilityLabel="Tu correo" maxLength={254} />
        <PrivacyConsent checked={consent} onToggle={() => setConsent((v) => !v)} />
        <PrimaryButton testID="seller-guest-send" title="Enviarme el código" icon="mail-outline" loading={busy} disabled={!consent || !/\S+@\S+\.\S+/.test(email)}
          onPress={() => run(async () => { const r = await requestSellerCode(inv.code, email.trim(), mode, a.hash); setCh({ id: r.challenge_id, to: r.sent_to }); })} />
      </> : <>
        <Text style={T.footnote}>Te mandamos el código a {ch.to}. Vence en 10 minutos.</Text>
        <TextInput testID="seller-guest-otp" style={[ui.input, { fontFamily: Fonts.black, fontSize: 26, letterSpacing: 8, textAlign: 'center' }]} placeholder="••••••"
          placeholderTextColor={C.textDim} value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} accessibilityLabel="Código de 6 dígitos" />
        <View style={st.exc} testID="seller-guest-final-summary">
          <Text style={T.caption}>Vas a aceptar</Text>
          <Row k="Producto" v={`${inv.brand} ${inv.model}`.trim()} />
          <Row k="Precio" v={formatCRC(inv.price_crc)} strong />
          <Row k="Entrega" v={DELIVERY_LABEL[mode]} />
          <Row k="Plazo de reclamo" v={protectionLabel(a.protection_minutes)} />
          <Text style={T.footnote}>El detalle completo y las reglas están más arriba, en «Lo que aceptas».</Text>
        </View>
        <PrimaryButton testID="seller-guest-accept" title="Acepto este acuerdo" icon="checkmark-circle" loading={busy} disabled={otp.length !== 6}
          onPress={() => run(async () => { await acceptAsSeller(inv.code, ch.id, otp, mode, a.hash); onAccepted(); })} />
        <PrimaryButton title="Usar otro correo" variant="ghost" onPress={() => { setCh(null); setOtp(''); setErr(null); }} />
      </>}
      {err ? <ErrorText>{err}</ErrorText> : null}
    </Card> : null}

    <Pressable testID="seller-guest-login" accessibilityRole="link" onPress={onLogin} hitSlop={8} style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center' }}>
      <Text style={[T.callout, { color: C.lilac }]}>{g?.available ? 'o entra con tu cuenta' : 'Entra con tu cuenta para aceptar'}</Text>
    </Pressable>
  </View>;
}

/** Otro navegador: código al correo con el que aceptó. La sesión anterior queda revocada. */
export function SellerGuestRecover({ code, onDone }: { code: string; onDone: () => void }) {
  const [email, setEmail] = useState(''); const [otp, setOtp] = useState(''); const [ch, setCh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [sent, setSent] = useState(false);
  const [consent, setConsent] = useState(false);
  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(null); try { await f(); } catch (e) { setErr(userMessage((e as Error).message)); } finally { setBusy(false); } };
  return <Card testID="seller-guest-recover" style={{ gap: S.sm }}>
    <Text style={T.caption}>¿Vendiste tú? Recupera tu acceso</Text>
    {!sent ? <>
      <TextInput style={ui.input} placeholder="El correo con el que aceptaste" placeholderTextColor={C.textDim} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" accessibilityLabel="Tu correo" />
      <PrivacyConsent checked={consent} onToggle={() => setConsent((v) => !v)} />
      <PrimaryButton testID="seller-guest-recover-send" title="Enviarme un código" variant="secondary" loading={busy} disabled={!consent || !/\S+@\S+\.\S+/.test(email)} onPress={() => run(async () => { const r = await requestRecoverCode(code, email.trim()); setCh(r.challenge_id); setSent(true); })} />
    </> : <>
      <Text style={T.footnote}>Si ese correo es el de la venta, te llegó un código.</Text>
      <TextInput style={ui.input} placeholder="Código de 6 dígitos" placeholderTextColor={C.textDim} value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" accessibilityLabel="Código de 6 dígitos" />
      <PrimaryButton title="Recuperar acceso" loading={busy} disabled={otp.length !== 6 || !ch} onPress={() => run(async () => { await recoverSeller(code, ch!, otp); onDone(); })} />
    </>}
    {err ? <ErrorText>{err}</ErrorText> : null}
  </Card>;
}

const STATUS_TEXT: Record<string, string> = {
  creado: 'Aceptaste. Esperando que quien compra pague.', escrow_creado: 'Quien compra está pagando. Todavía no hay fondos en custodia.',
  fondeado: 'Fondos en custodia', enviado: 'Enviado. Esperando la confirmación de quien compra.', entregado: 'Entregado. Liberando el pago.',
  liberado: 'Pago liberado a una wallet de la plataforma (simulación). No hay transferencia bancaria ni dinero real.', en_disputa: 'En disputa: el pago sigue en custodia.',
  resuelto: 'Disputa resuelta.', cancelado: 'Venta cancelada.',
};
/** Panel del vendedor sin cuenta para su pedido. "Fondos en custodia" SOLO con el depósito confirmado on-chain (funds_in_custody). */
export function SellerGuestOrder({ o, onChange }: { o: SellerOrderView; onChange: () => void }) {
  const funded = o.funds_in_custody;
  const label = o.status === 'fondeado' && !funded ? STATUS_TEXT.escrow_creado : STATUS_TEXT[o.status] ?? o.status;
  return <View style={{ gap: S.md }}>
    <Card testID="seller-guest-order" style={{ gap: S.sm }}>
      <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
        <Chip label={funded ? 'Fondos en custodia' : o.released ? 'Liberado' : 'Sin fondos todavía'} tone={funded ? 'success' : o.released ? 'lilac' : 'warn'} />
        <Chip label={DELIVERY_LABEL[o.delivery_mode]} />
      </View>
      <Text testID="seller-guest-status" style={T.headline}>{label}</Text>
      <View style={st.exc} testID="seller-guest-sim">
        <Text style={[T.headline, { fontSize: 15 }]}>Simulación de cobro</Text>
        <Row k="Monto de prueba" v={formatCRC(o.price_crc)} />
        <Row k="Destino" v="IBAN de ejemplo" />
        <Text style={T.footnote}>Es una prueba sin dinero real: nadie te va a transferir este monto.</Text>
      </View>
      <MoneyTimeline status={o.status} compact shipped={!!o.shipped_at} mode={o.delivery_mode} />
      {funded ? <SellerActions slug={o.slug} status={o.status} order={o} onChange={onChange} call={sellerCall} asGuest /> : null}
      <ExceptionBox />
      <Text style={T.footnote}>{SELLER_GUEST_RECEIPT}</Text>
    </Card>
    {o.status === 'en_disputa' ? <SellerDisputeReply slug={o.slug} guest /> : null}
    <BetaBox />
  </View>;
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.sm }}>
    <Text style={T.callout}>{k}</Text>
    <Text style={[strong ? T.money : T.headline, { flexShrink: 1, textAlign: 'right' }]}>{v}</Text>
  </View>;
}

const st = StyleSheet.create({
  beta: { flexDirection: 'row', alignItems: 'flex-start', gap: S.sm, padding: S.sm + 2, borderRadius: R.md, borderWidth: 1, borderColor: C.orange, backgroundColor: C.warnBg },
  mode: { flex: 1, minHeight: 48, paddingHorizontal: S.md, paddingVertical: S.sm, borderRadius: R.md, borderWidth: 1, borderColor: C.line, justifyContent: 'center' },
  exc: { gap: S.xs, padding: S.sm, borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface2 },
  consent: { flexDirection: 'row', gap: S.sm, alignItems: 'flex-start', minHeight: 44, paddingVertical: 4 },
  modeOn: { borderColor: C.lilac, backgroundColor: C.lilacBg },
});
