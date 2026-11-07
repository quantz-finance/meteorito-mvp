// Vendedor: "Cuéntanos tu versión" en un pedido en disputa (capa D del panel). Foto con la cámara de la app (token
// 'dispute' del vendedor), guía de envío o texto (al menos uno), editable mientras la disputa siga abierta.
// Regla v2 (lib/rules.ts "Respuesta de quien vende en 48 h"): 48 h desde el aviso con cuenta regresiva; sin respuesta se
// reembolsa a quien compró; si responde, una persona del equipo decide. Pedidos anteriores: el plazo sugiere la regla del
// panel como antes. Sin la migración 027 no se muestra (queda el chat del pedido).
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, ErrorText, Icon, PrimaryButton } from '@/components/ds';
import { CameraCapture } from '@/components/CameraCapture';
import { ui } from '@/components/ui';
import { C, R, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { userMessage } from '@/lib/cavosSession';
import type { CapturedPhoto } from '@/lib/capture';
import { deadlineLabel, getSellerResponse, sendSellerResponse, shortDate, type SellerResponseState } from '@/lib/admin';
import { leftLabel, useNow, whenLabel } from '@/lib/ruleTimes';
import { sellerCall } from '@/lib/sellerGuest';

export function SellerDisputeReply({ slug, guest = false }: { slug: string; /** vendedor sin cuenta (sesión del pedido) */ guest?: boolean }) {
  const cavos = useAuth();
  const auth = guest ? ({ ...cavos, getAuthToken: () => null } as typeof cavos) : cavos;
  const [st, setSt] = useState<SellerResponseState | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [guide, setGuide] = useState('');
  const now = useNow();
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [cam, setCam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (guest ? sellerCall<SellerResponseState>('/api/escrow/dispute', { action: 'seller_response_get', slug }) : getSellerResponse(auth, slug)).then((r) => { if (live) setSt(r); }).catch(() => { if (live) setSt(null); });
    return () => { live = false; };
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!st || !st.available) return null;
  const dl = deadlineLabel(st.deadline);
  const v2 = st.rule === 'respuesta_48h';
  if (v2 && st.expired && !st.response) return (
    <Card testID="seller-reply-expired" style={{ gap: S.sm }}>
      <View style={s.row}><Icon name="time-outline" size={18} color={C.orange} /><Text style={[T.headline, { flex: 1 }]}>Pasaron las 48 h</Text></View>
      <Text style={T.callout}>No respondiste a tiempo: el pago se le devuelve a quien compró desde la custodia.</Text>
    </Card>
  );
  if (st.response && !editing) return (
    <Card testID="seller-reply-done" style={{ gap: S.sm }}>
      <View style={s.row}><Icon name="checkmark-circle" size={18} color={C.success} /><Text style={[T.headline, { flex: 1 }]}>Enviaste tu versión</Text></View>
      <Text style={T.body}>{st.response.body}</Text>
      {st.response.photo ? <Image source={{ uri: st.response.photo }} style={s.photo} accessibilityLabel="Foto de tu respuesta" /> : null}
      <Text style={T.footnote}>{shortDate(st.response.created_at)}</Text>
      {st.can_respond ? <Pressable onPress={() => { setText(st.response!.body); setEditing(true); }} accessibilityRole="button" hitSlop={6}>
        <Text style={[T.footnote, { color: C.lilac }]}>Editar mi versión</Text>
      </Pressable> : null}
    </Card>
  );
  if (!st.can_respond) return null;

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const p = photo ? { url: photo.url, token: photo.token } : null, g = guide.trim() || undefined;
      const r = guest ? await sellerCall<{ saved: boolean; response: SellerResponseState['response'] }>('/api/escrow/dispute', { action: 'seller_respond', slug, body: text.trim(), ...(g ? { tracking: g } : {}), ...(p ? { photo: p.url, capture: p.token } : {}) })
        : await sendSellerResponse(auth, slug, text.trim(), p, g);
      setSt({ ...st, response: r.response }); setEditing(false);
    } catch (e) { setErr(userMessage((e as Error).message)); }
    finally { setBusy(false); }
  };
  return (
    <Card testID="seller-reply" style={{ gap: S.sm }}>
      <Text style={T.headline}>Cuéntanos tu versión</Text>
      {v2 ? <>
        <View testID="seller-reply-countdown" style={[s.row, s.count]}>
          <Icon name="timer-outline" size={18} color={C.orange} />
          <Text style={[T.callout, { flex: 1, color: C.text }]}>{st.deadline ? `Tienes hasta el ${whenLabel(st.deadline)} (${leftLabel(st.deadline, now)}) para responder.` : 'Tienes 48 h para responder.'}</Text>
        </View>
        <Text style={T.callout}>Quien compró reportó un problema. Responde con una foto, la guía de envío o un texto. Si no respondes a tiempo, el pago se le devuelve; si respondes, una persona del equipo revisa las dos versiones y decide.</Text>
      </> : <Text style={T.callout}>El comprador reportó un problema. Explica qué pasó y, si puedes, toma una foto (por ejemplo, el comprobante de envío).{dl ? ` Tienes hasta ${shortDate(st.deadline)} (${dl.text}).` : ''}</Text>}
      <TextInput testID="seller-reply-text" style={[ui.input, { minHeight: 96, paddingTop: S.sm + 4, textAlignVertical: 'top' }]} multiline maxLength={1000}
        placeholder="Tu versión de lo que pasó" placeholderTextColor={C.textDim} value={text} onChangeText={setText} accessibilityLabel="Tu versión de lo que pasó" />
      {v2 ? <TextInput testID="seller-reply-guide" style={ui.input} maxLength={80} autoCapitalize="characters" autoCorrect={false}
        placeholder="Guía de envío (opcional)" placeholderTextColor={C.textDim} value={guide} onChangeText={setGuide} accessibilityLabel="Guía de envío" /> : null}
      {photo ? <View style={s.row}>
        <Image source={{ uri: photo.uri }} style={s.thumb} accessibilityLabel="Foto de tu respuesta" />
        <Pressable onPress={() => setPhoto(null)} accessibilityRole="button" hitSlop={6}><Text style={[T.footnote, { color: C.lilac }]}>Quitar foto</Text></Pressable>
      </View> : <Pressable onPress={() => setCam(true)} accessibilityRole="button" accessibilityLabel="Tomar foto para tu respuesta" style={({ pressed }) => [s.take, pressed && { opacity: 0.8 }]}>
        <Icon name="camera-outline" size={20} color={C.lilac} />
        <Text style={[T.footnote, { color: C.lilac, flex: 1 }]}>{v2 ? 'Tomar foto' : 'Tomar foto (opcional)'}</Text>
      </Pressable>}
      {err ? <ErrorText>{err}</ErrorText> : null}
      <PrimaryButton testID="seller-reply-send" title="Enviar mi versión" icon="paper-plane" loading={busy} disabled={v2 ? text.trim().length < 3 && !guide.trim() && !photo : text.trim().length < 3} onPress={submit} />
      <CameraCapture visible={cam} purpose="dispute" refId={slug} asSeller asGuest={guest} title="Foto para tu respuesta" hint="Muestra el comprobante de envío o el producto."
        onClose={() => setCam(false)} onDone={(p) => { setPhoto(p); setCam(false); }} />
    </Card>
  );
}
const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: R.md, backgroundColor: C.lilacBg },
  thumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: C.lilacBg },
  count: { padding: S.sm, borderRadius: R.md, borderWidth: 1, borderColor: C.orange },
  take: { flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: 48, paddingHorizontal: S.md, borderRadius: R.md, borderWidth: 1, borderStyle: 'dashed', borderColor: C.lilac, backgroundColor: C.lilacBg },
});
