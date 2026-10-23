// Comprador (sin cuenta): pide a un vendedor que publique el artículo. Mismos campos que el vendedor: nombre, precio y
// fotos opcionales. Crea una INVITACIÓN; el vendedor la confirma y manda el link de pago (reservado para este comprador).
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { userMessage } from '@/lib/cavosSession';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useStableWindow } from '@/lib/viewport';
import { ErrorText, Icon, PrimaryButton, Screen, TestnetPill } from '@/components/ds';
import { ui } from '@/components/ui';
import { C, R, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { createInvite } from '@/lib/invites';
import { formatCRC } from '@/lib/orders';
import { formatPriceInput, MAX_PRICE, MIN_PRICE, parsePrice, TITLE_MAX, TITLE_MIN } from '@/lib/listing';
import { track, trackError } from '@/lib/analytics';

const MAX_INVITE_PHOTOS = 4;
interface Pic { key: string; uri: string; width?: number; height?: number }
let seq = 0;

export default function NuevaInvitacion() {
  const auth = useAuth();
  const short = useStableWindow().height < 720;
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [pics, setPics] = useState<Pic[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const priceNum = parsePrice(price);

  async function pick() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: MAX_INVITE_PHOTOS - pics.length, quality: 1 });
    if (res.canceled) return;
    setPics((p) => [...p, ...res.assets.map((a) => ({ key: `i${++seq}`, uri: a.uri, width: a.width, height: a.height }))].slice(0, MAX_INVITE_PHOTOS));
  }

  async function submit() {
    setErr(null);
    const t = title.trim();
    if (t.length < TITLE_MIN) return setErr('Escribe el nombre de lo que quieres comprar.');
    if (!priceNum || priceNum < MIN_PRICE || priceNum > MAX_PRICE) return setErr(`Ingresa un precio válido: mínimo ${formatCRC(MIN_PRICE)}, máximo ${formatCRC(MAX_PRICE)}.`);
    setBusy(true);
    try {
      const photos: string[] = [];
      if (pics.length) { // diferido: compresión y subida solo si hay fotos
        const { compressPhoto, newDraftId, uploadGuestPhoto } = await import('@/lib/photos');
        const draft = newDraftId();
        for (const [i, p] of pics.entries()) photos.push(await uploadGuestPhoto(auth, await compressPhoto(p), draft, i));
      }
      const code = await createInvite(auth, { title: t, price_crc: priceNum, ...(photos.length ? { photos } : {}) });
      track('invite_created', { photos: photos.length });
      router.replace({ pathname: '/i/[code]', params: { code } });
    } catch (e) { trackError('create_invite', e); setErr(userMessage((e as Error).message)); } finally { setBusy(false); }
  }

  return (
    <Screen back="/" title="Invitar a un vendedor" subtitle={short ? undefined : 'Dile qué quieres y a qué precio; él publica y te manda el link.'} right={<TestnetPill />} scroll={false}
      footer={<>{err && <ErrorText>{err}</ErrorText>}<PrimaryButton title="Crear invitación" icon="paper-plane-outline" loading={busy} onPress={submit} /></>}>
      <View style={{ flex: 1, gap: S.sm }}>
        <Text style={T.caption}>Nombre del producto</Text>
        <TextInput style={ui.input} value={title} onChangeText={setTitle} placeholder="Ej. iPhone 13 de 128 GB" placeholderTextColor={C.textDim} maxLength={TITLE_MAX} accessibilityLabel="Nombre del producto" />
        <Text style={T.caption}>Precio acordado en colones</Text>
        <TextInput style={ui.input} value={price} onChangeText={(v) => setPrice(formatPriceInput(v))} inputMode="numeric" keyboardType="number-pad" placeholder="250 000" placeholderTextColor={C.textDim} accessibilityLabel="Precio acordado" />
        <Text style={T.caption}>Fotos (opcional)</Text>
        <View style={s.row}>
          {pics.map((p) => (
            <View key={p.key} style={s.thumb}>
              <Image source={{ uri: p.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              <Pressable accessibilityRole="button" accessibilityLabel="Quitar foto" hitSlop={8} onPress={() => setPics((ps) => ps.filter((x) => x.key !== p.key))} style={s.remove}>
                <Icon name="close" size={14} color={C.text} />
              </Pressable>
            </View>
          ))}
          {pics.length < MAX_INVITE_PHOTOS ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Agregar fotos" onPress={pick} style={[s.thumb, s.add]}>
              <Icon name="camera-outline" size={24} color={C.lilac} />
            </Pressable>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.xs }}><Icon name="information-circle-outline" size={18} color={C.lilac} /><Text style={[T.footnote, { flex: 1 }]}>No necesitas cuenta: tu navegador guarda una llave para que solo tú pagues el link. Beta en testnet: sin dinero real.</Text></View>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: S.sm },
  thumb: { width: 64, height: 64, borderRadius: R.md, overflow: 'hidden', backgroundColor: C.lilacBg },
  add: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: C.lilac },
  remove: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: C.backdrop, alignItems: 'center', justifyContent: 'center' },
});
