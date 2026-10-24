// Vendedor: "Ya lo envié" (evidencia {at, photo, captured_at, token_id, purpose, note?} -> hash en Supabase y en TW) e
// "Ingresar PIN del comprador". La FOTO del paquete o del comprobante de Correos es OBLIGATORIA y solo con la cámara de la
// app en ese momento (CameraCapture + token de captura de un uso); nunca del carrete. El número de guía sigue opcional.
// Cara a cara: no hay "Ya lo envié" ni foto; en 'fondeado' el vendedor ingresa el PIN del comprador y cobra al instante.
// Con el plazo corriendo, "Pedir más tiempo" / responder la solicitud del comprador (ExtensionBox).
import { useState } from 'react';
import { userMessage } from '@/lib/cavosSession';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ErrorText, Icon, PrimaryButton, SuccessCheck } from '@/components/ds';
import { CameraCapture } from '@/components/CameraCapture';
import type { CapturedPhoto } from '@/lib/capture';
import { ui } from '@/components/ui';
import { C, R, S, T } from '@/constants/theme';
import { Fonts } from '@/constants/Colors';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/cavos';
import { ExtensionBox } from '@/components/ExtensionBox';

/** "Ya lo envié" solo se puede tocar con la foto de la cámara ya subida. */
export const canShip = (photo: CapturedPhoto | null) => !!photo?.url && !!photo.token;

export function SellerActions({ slug, status, order, onChange }: { slug: string; status: string; onChange: () => void;
  /** Pedido público (acuerdo de entrega y extensión pendiente). Sin él: envío. */
  order?: { status: string; delivery_mode?: string | null; release_ext?: any } | null }) {
  const f2f = order?.delivery_mode === 'cara_a_cara';
  const auth = useAuth();
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [camOpen, setCamOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (f: () => Promise<void>, ok: string) => { setBusy(true); setErr(null); try { await f(); setDone(ok); onChange(); } catch (e) { setErr(userMessage((e as Error).message)); } finally { setBusy(false); } };

  if (done) return <View style={{ gap: S.md, alignItems: 'center', paddingVertical: S.md }}>
    <SuccessCheck celebrate={done.startsWith('¡Cobrado')} />
    <Text style={[T.headline, { textAlign: 'center' }]}>{done}</Text>
  </View>;

  const ext = order && order.status === status
    ? <ExtensionBox order={order} role="seller" onChange={onChange} call={(b) => api(auth, '/api/escrow/confirm', { slug, ...b })} /> : null;
  const pinForm = (hint?: string) => <View style={{ gap: S.sm }}>
    {hint ? <Text style={T.callout}>{hint}</Text> : null}
    <Text style={T.caption}>Código de entrega del comprador (PIN)</Text>
    <TextInput style={[ui.input, { fontFamily: Fonts.black, fontSize: 28, letterSpacing: 8, textAlign: 'center', fontVariant: ['tabular-nums'] }]}
      placeholder="••••••" keyboardType="number-pad" maxLength={6} value={pin} onChangeText={setPin} placeholderTextColor={C.textDim} accessibilityLabel="Código de entrega del comprador" />
    <PrimaryButton title="Confirmar PIN y cobrar" icon="lock-open" loading={busy} disabled={pin.length !== 6}
      onPress={() => run(async () => { await api(auth, '/api/escrow/confirm', { slug, reason: 'pin', pin }); }, '¡Cobrado! El pago fue liberado')} />
    {err && <ErrorText>{err}</ErrorText>}
    {ext}
  </View>;

  if (status === 'fondeado' && f2f) return pinForm('Cara a cara: cuando el comprador revise el producto, pídele su código.');

  if (status === 'fondeado') return <View style={{ gap: S.sm }}>
    {photo ? <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center' }}>
      <Image testID="ship-photo-preview" source={{ uri: photo.uri }} style={st.thumb} resizeMode="cover" accessibilityLabel="Foto del envío" />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[T.headline, { fontSize: 15 }]} numberOfLines={1}>Foto del envío lista</Text>
        <Pressable onPress={() => { setErr(null); setCamOpen(true); }} disabled={busy} accessibilityRole="button" accessibilityLabel="Tomar otra foto del envío" hitSlop={6}>
          <Text style={[T.footnote, { color: C.lilac }]}>Tomar otra</Text>
        </Pressable>
      </View>
    </View> : <Pressable onPress={() => { setErr(null); setCamOpen(true); }} disabled={busy} accessibilityRole="button" accessibilityLabel="Tomar foto del envío"
      style={({ pressed }) => [st.take, pressed && { opacity: 0.8 }]}>
      <Icon name="camera" size={22} color={C.lilac} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[T.headline, { color: C.lilac, fontSize: 15 }]} numberOfLines={1}>Tomar foto del paquete</Text>
        <Text style={T.footnote} numberOfLines={2}>Obligatoria: el paquete o el comprobante, con la cámara en este momento.</Text>
      </View>
    </Pressable>}
    {noteOpen
      ? <TextInput style={ui.input} placeholder="Número de guía (opcional)" placeholderTextColor={C.textDim} value={note} onChangeText={setNote} maxLength={200} autoFocus />
      : <Pressable onPress={() => setNoteOpen(true)} accessibilityRole="button" style={({ pressed }) => [st.link, pressed && { opacity: 0.7 }]}>
          <Icon name="document-text-outline" size={20} color={C.textDim} />
          <Text style={[T.footnote]}>Agregar número de guía (opcional)</Text>
        </Pressable>}
    <PrimaryButton title="Ya lo envié" icon="paper-plane" loading={busy} disabled={!canShip(photo)}
      onPress={() => run(async () => {
        if (!photo) throw new Error('Toma la foto del envío con la cámara.');
        const evidence: Record<string, string> = { photo: photo.url, capture_token: photo.token, captured_at: photo.captured_at };
        if (note.trim()) evidence.note = note.trim();
        const r = await api(auth, '/api/escrow/ship', { slug, evidence });
        if (r.unsignedXdr) await api(auth, '/api/tx/submit', { slug, action: 'ship', signedXdr: await auth.signXdr(r.unsignedXdr) });
      }, 'Marcado como enviado')} />
    {!photo && !err ? <Text testID="ship-photo-required" style={[T.footnote, { textAlign: 'center' }]}>Toma la foto para poder marcarlo como enviado.</Text> : null}
    {err && <ErrorText>{err}</ErrorText>}
    <CameraCapture visible={camOpen} purpose="ship" refId={slug} onClose={() => setCamOpen(false)} onDone={(p) => { setPhoto(p); setCamOpen(false); }} />
  </View>;

  if (status === 'enviado') return pinForm();
  return null;
}

const st = StyleSheet.create({
  thumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: C.lilacBg },
  take: { flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: 56, paddingHorizontal: S.md, paddingVertical: S.sm, borderRadius: R.md, borderWidth: 1, borderStyle: 'dashed', borderColor: C.lilac, backgroundColor: C.lilacBg },
  link: { flexDirection: 'row', alignItems: 'center', gap: S.xs + 2, minHeight: 44, flexShrink: 1 },
});
