// Comprador: "Tengo un problema" -> motivo + descripción + fotos opcionales -> /api/escrow/dispute.
// Pantalla de pago/disputa: sin efectos de fondo (Sheet sólido).
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ErrorText, haptic, Icon, PrimaryButton, Sheet, type IconName } from '@/components/ds';
import { ui } from '@/components/ui';
import { C, R, S, T, TOUCH } from '@/constants/theme';
import { guestApi } from '@/lib/api';
import { useAuth } from '@/lib/cavos';
import { MAX_PHOTOS, newDraftId, uploadPhoto, type PickedPhoto } from '@/lib/photos';

const REASONS: { id: string; label: string; icon: IconName }[] = [
  { id: 'no_llego', label: 'No llegó', icon: 'cube-outline' },
  { id: 'no_funciona', label: 'No funciona', icon: 'construct-outline' },
  { id: 'no_es_lo_descrito', label: 'No es lo descrito', icon: 'help-circle-outline' },
  { id: 'otro', label: 'Otro', icon: 'chatbubble-ellipses-outline' },
];

export function DisputeSheet({ visible, onClose, slug, onOpened }: { visible: boolean; onClose: () => void; slug: string; onOpened: () => void }) {
  const auth = useAuth();
  const [reason, setReason] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pick() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: MAX_PHOTOS - photos.length, quality: 1 });
    if (!res.canceled) setPhotos((p) => [...p, ...res.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height }))].slice(0, MAX_PHOTOS));
  }
  async function submit() {
    if (!reason) return setErr('Elige qué pasó');
    if (reason === 'otro' && !text.trim()) return setErr('Cuéntanos qué pasó');
    setBusy(true); setErr(null);
    try {
      const draft = newDraftId();
      const evidence: string[] = [];
      for (const [i, p] of photos.entries()) evidence.push(await uploadPhoto(auth, p, draft, i));
      await guestApi(auth, '/api/escrow/dispute', { slug, reason, description: text.trim() || null, evidence });
      haptic.success(); onOpened(); onClose();
    } catch (e) { haptic.error(); setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Tengo un problema"
      footer={<>
        {err && <ErrorText>{err}</ErrorText>}
        <PrimaryButton title="Reportar problema" icon="alert-circle" loading={busy} disabled={!reason} onPress={submit} />
      </>}>
      <Text style={T.callout}>Pausamos el pago al vendedor mientras lo revisamos. Respondemos en 24-48 h.</Text>
      <View style={s.grid}>
        {REASONS.map((r) => {
          const on = reason === r.id;
          return (
            <Pressable key={r.id} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => { haptic.tap(); setReason(r.id); }}
              style={[s.reason, on && s.reasonOn]}>
              <Icon name={r.icon} size={22} color={on ? C.orange : C.lilac} />
              <Text style={[T.headline, { fontSize: 15 }]} numberOfLines={1}>{r.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput style={[ui.input, { minHeight: 96, paddingTop: S.sm + 4, textAlignVertical: 'top' }]} multiline maxLength={2000}
        placeholder="Cuéntanos qué pasó (opcional)" placeholderTextColor={C.textDim} value={text} onChangeText={setText} />
      <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
        {photos.map((p, i) => (
          <Pressable key={p.uri} onPress={() => setPhotos((x) => x.filter((_, j) => j !== i))} accessibilityLabel="Quitar foto" style={s.thumb}>
            <Image source={{ uri: p.uri }} style={StyleSheet.absoluteFill} />
          </Pressable>
        ))}
        {auth.isAuthenticated && photos.length < MAX_PHOTOS && (
          <Pressable onPress={pick} style={[s.thumb, s.add]} accessibilityLabel="Agregar foto">
            <Icon name="camera-outline" size={22} color={C.lilac} />
            <Text style={[T.footnote, { color: C.lilac }]}>Fotos ({photos.length}/{MAX_PHOTOS})</Text>
          </Pressable>
        )}
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  reason: { flexBasis: '47%', flexGrow: 1, minHeight: TOUCH + 28, borderRadius: R.md, padding: S.md, gap: S.xs, backgroundColor: C.lilacBg, borderWidth: 1, borderColor: 'transparent' },
  reasonOn: { borderColor: C.orange, backgroundColor: C.warnBg },
  thumb: { width: 76, height: 76, borderRadius: R.md, overflow: 'hidden', backgroundColor: C.surface2 },
  add: { alignItems: 'center', justifyContent: 'center', gap: 2 },
});
