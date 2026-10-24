// Vendedor: "Ya lo envié" en un toque (evidencia {at, photo?, note?} -> hash en Supabase y en TW) e "Ingresar PIN del comprador".
// La foto (paquete o comprobante de Correos de Costa Rica) y el número de guía son opcionales.
import { useState } from 'react';
import { userMessage } from '@/lib/cavosSession';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ErrorText, Icon, PrimaryButton, SuccessCheck } from '@/components/ds';
import { compressPhoto, newDraftId, uploadCompressed } from '@/lib/photos';
import { ui } from '@/components/ui';
import { C, S, T } from '@/constants/theme';
import { Fonts } from '@/constants/Colors';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/cavos';

export function SellerActions({ slug, status, onChange }: { slug: string; status: string; onChange: () => void }) {
  const auth = useAuth();
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [photo, setPhoto] = useState<{ uri: string; blob: Blob | null } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const pickPhoto = async () => {
    setErr(null);
    const ImagePicker = await import('expo-image-picker');
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1 });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setPhoto({ uri: a.uri, blob: null }); setPhotoBusy(true);
    try { const blob = await compressPhoto({ uri: a.uri, width: a.width, height: a.height }); setPhoto({ uri: a.uri, blob }); }
    catch { setPhoto(null); setErr('No pudimos usar esa foto. Elige otra o envía sin foto.'); }
    finally { setPhotoBusy(false); }
  };
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (f: () => Promise<void>, ok: string) => { setBusy(true); setErr(null); try { await f(); setDone(ok); onChange(); } catch (e) { setErr(userMessage((e as Error).message)); } finally { setBusy(false); } };

  if (done) return <View style={{ gap: S.md, alignItems: 'center', paddingVertical: S.md }}>
    <SuccessCheck celebrate={done.startsWith('¡Cobrado')} />
    <Text style={[T.headline, { textAlign: 'center' }]}>{done}</Text>
  </View>;

  if (status === 'fondeado') return <View style={{ gap: S.sm }}>
    <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center' }}>
      {photo ? <View>
        <Image testID="ship-photo-preview" source={{ uri: photo.uri }} style={st.thumb} resizeMode="cover" accessibilityLabel="Foto del envío" />
        {photoBusy ? <View style={[StyleSheet.absoluteFill, st.busy]}><ActivityIndicator color="#fff" /></View> : null}
      </View> : null}
      <Pressable onPress={photo ? () => setPhoto(null) : pickPhoto} disabled={busy} accessibilityRole="button"
        accessibilityLabel={photo ? 'Quitar la foto del envío' : 'Agregar foto del envío'} style={({ pressed }) => [st.link, pressed && { opacity: 0.7 }]}>
        <Icon name={photo ? 'close-circle-outline' : 'camera-outline'} size={20} color={C.lilac} />
        <Text style={[T.callout, { color: C.lilac, flexShrink: 1 }]}>{photo ? 'Quitar foto' : 'Foto del paquete o comprobante (opcional)'}</Text>
      </Pressable>
    </View>
    {noteOpen
      ? <TextInput style={ui.input} placeholder="Número de guía (opcional)" placeholderTextColor={C.textDim} value={note} onChangeText={setNote} maxLength={200} autoFocus />
      : <Pressable onPress={() => setNoteOpen(true)} accessibilityRole="button" style={({ pressed }) => [st.link, pressed && { opacity: 0.7 }]}>
          <Icon name="document-text-outline" size={20} color={C.textDim} />
          <Text style={[T.footnote]}>Agregar número de guía (opcional)</Text>
        </Pressable>}
    <PrimaryButton title="Ya lo envié" icon="paper-plane" loading={busy} disabled={photoBusy}
      onPress={() => run(async () => {
        const evidence: { photo?: string; note?: string } = {};
        if (photo?.blob) evidence.photo = await uploadCompressed(auth, photo.blob, newDraftId(), 0);
        if (note.trim()) evidence.note = note.trim();
        const r = await api(auth, '/api/escrow/ship', { slug, evidence });
        if (r.unsignedXdr) await api(auth, '/api/tx/submit', { slug, action: 'ship', signedXdr: await auth.signXdr(r.unsignedXdr) });
      }, 'Marcado como enviado')} />
    {err && <ErrorText>{err}</ErrorText>}
  </View>;

  if (status === 'enviado') return <View style={{ gap: S.sm }}>
    <Text style={T.caption}>Código de entrega del comprador (PIN)</Text>
    <TextInput style={[ui.input, { fontFamily: Fonts.black, fontSize: 28, letterSpacing: 8, textAlign: 'center', fontVariant: ['tabular-nums'] }]}
      placeholder="••••••" keyboardType="number-pad" maxLength={6} value={pin} onChangeText={setPin} placeholderTextColor={C.textDim} />
    <PrimaryButton title="Confirmar PIN y cobrar" icon="lock-open" loading={busy} disabled={pin.length !== 6}
      onPress={() => run(async () => { await api(auth, '/api/escrow/confirm', { slug, reason: 'pin', pin }); }, '¡Cobrado! El pago fue liberado')} />
    {err && <ErrorText>{err}</ErrorText>}
  </View>;
  return null;
}

const st = StyleSheet.create({
  thumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: C.lilacBg },
  busy: { backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  link: { flexDirection: 'row', alignItems: 'center', gap: S.xs + 2, minHeight: 44, flexShrink: 1 },
});
