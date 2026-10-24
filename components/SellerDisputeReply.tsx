// Vendedor: "Cuéntanos tu versión" en un pedido en disputa (capa D del panel). Texto + foto opcional con la cámara de la
// app (token 'dispute' del vendedor), una vez y editable mientras la disputa siga abierta. Tiene 48 h desde la apertura;
// sin respuesta, la regla sugiere reembolsar al comprador. Sin la migración 027 no se muestra (queda el chat del pedido).
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

export function SellerDisputeReply({ slug }: { slug: string }) {
  const auth = useAuth();
  const [st, setSt] = useState<SellerResponseState | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [cam, setCam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getSellerResponse(auth, slug).then((r) => { if (live) setSt(r); }).catch(() => { if (live) setSt(null); });
    return () => { live = false; };
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!st || !st.available) return null;
  const dl = deadlineLabel(st.deadline);
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
      const r = await sendSellerResponse(auth, slug, text.trim(), photo ? { url: photo.url, token: photo.token } : null);
      setSt({ ...st, response: r.response }); setEditing(false);
    } catch (e) { setErr(userMessage((e as Error).message)); }
    finally { setBusy(false); }
  };
  return (
    <Card testID="seller-reply" style={{ gap: S.sm }}>
      <Text style={T.headline}>Cuéntanos tu versión</Text>
      <Text style={T.callout}>El comprador reportó un problema. Explica qué pasó y, si puedes, toma una foto (por ejemplo, el comprobante de envío).{dl ? ` Tienes hasta ${shortDate(st.deadline)} (${dl.text}).` : ''}</Text>
      <TextInput testID="seller-reply-text" style={[ui.input, { minHeight: 96, paddingTop: S.sm + 4, textAlignVertical: 'top' }]} multiline maxLength={1000}
        placeholder="Tu versión de lo que pasó" placeholderTextColor={C.textDim} value={text} onChangeText={setText} accessibilityLabel="Tu versión de lo que pasó" />
      {photo ? <View style={s.row}>
        <Image source={{ uri: photo.uri }} style={s.thumb} accessibilityLabel="Foto de tu respuesta" />
        <Pressable onPress={() => setPhoto(null)} accessibilityRole="button" hitSlop={6}><Text style={[T.footnote, { color: C.lilac }]}>Quitar foto</Text></Pressable>
      </View> : <Pressable onPress={() => setCam(true)} accessibilityRole="button" accessibilityLabel="Tomar foto para tu respuesta" style={({ pressed }) => [s.take, pressed && { opacity: 0.8 }]}>
        <Icon name="camera-outline" size={20} color={C.lilac} />
        <Text style={[T.footnote, { color: C.lilac, flex: 1 }]}>Tomar foto (opcional)</Text>
      </Pressable>}
      {err ? <ErrorText>{err}</ErrorText> : null}
      <PrimaryButton testID="seller-reply-send" title="Enviar mi versión" icon="paper-plane" loading={busy} disabled={text.trim().length < 3} onPress={submit} />
      <CameraCapture visible={cam} purpose="dispute" refId={slug} asSeller title="Foto para tu respuesta" hint="Muestra el comprobante de envío o el producto."
        onClose={() => setCam(false)} onDone={(p) => { setPhoto(p); setCam(false); }} />
    </Card>
  );
}
const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: R.md, backgroundColor: C.lilacBg },
  thumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: C.lilacBg },
  take: { flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: 48, paddingHorizontal: S.md, borderRadius: R.md, borderWidth: 1, borderStyle: 'dashed', borderColor: C.lilac, backgroundColor: C.lilacBg },
});
