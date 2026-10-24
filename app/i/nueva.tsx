// Comprador (sin cuenta): pide a un vendedor que publique el artículo. Mismos campos que el vendedor: nombre, precio y
// fotos opcionales. Crea una INVITACIÓN; el vendedor la confirma y manda el link de pago (reservado para este comprador).
// "Importar de Facebook" (caso más común: el comprador vio el artículo en Marketplace): pega el link del anuncio y se
// precargan nombre, precio y foto (mismo /api/store import_facebook que Vender, con su llave de invitado). El link del
// anuncio queda en la invitación como referencia para el vendedor. Nada se crea sin que el comprador revise.
// Fotos propias: SOLO con la cámara de la app en el momento (CameraCapture, token 'listing' con su llave de invitado).
// La foto del anuncio importado la guarda el servidor (photo_urls). No hay carrete ni input de archivo.
import { router, useLocalSearchParams } from 'expo-router';
import { userMessage } from '@/lib/cavosSession';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useStableWindow } from '@/lib/viewport';
import { Card, ErrorText, haptic, Icon, PrimaryButton, Screen, Sheet } from '@/components/ds';
import { ui } from '@/components/ui';
import { C, R, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { createInvite } from '@/lib/invites';
import { formatCRC } from '@/lib/orders';
import { formatPriceInput, MAX_PRICE, MIN_PRICE, parsePrice, TITLE_MAX, TITLE_MIN } from '@/lib/listing';
import { checkFacebookUrl, fbImportNotice, fbImportProps, importFromFacebookAsBuyer, type FbImport } from '@/lib/fbImport';
import { CameraCapture } from '@/components/CameraCapture';
import { track, trackError } from '@/lib/analytics';

const MAX_INVITE_PHOTOS = 4;
/** Foto ya subida (cámara de la app o anuncio de Facebook guardado por el servidor). */
interface Pic { key: string; uri: string; url: string }
let seq = 0;
const FAILED: FbImport = { result: 'failed', title: null, price_crc: null, price_source: null, converted: false, description: null, photos: [], missing: ['title', 'price', 'photos'] };

export default function NuevaInvitacion() {
  const auth = useAuth();
  const short = useStableWindow().height < 720;
  const { fb } = useLocalSearchParams<{ fb?: string }>();
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [pics, setPics] = useState<Pic[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [fbOpen, setFbOpen] = useState(fb === '1');
  const [fbUrl, setFbUrl] = useState('');
  const [fbBusy, setFbBusy] = useState(false);
  const [fbErr, setFbErr] = useState<string | null>(null);
  const [fbNotice, setFbNotice] = useState<{ title: string; body: string; failed: boolean } | null>(null);
  const [source, setSource] = useState<string | null>(null); // link del anuncio (referencia para el vendedor)
  const priceNum = parsePrice(price);

  const [camOpen, setCamOpen] = useState(false);
  /** Foto del anuncio: la data URL se muestra ya; la copia guardada por el servidor (photo_urls) es la que se usa. */
  function addImportedPhoto(src: string, url: string | null | undefined) {
    if (!url) return;
    setPics((p) => (p.length >= MAX_INVITE_PHOTOS ? p : [...p, { key: `i${++seq}`, uri: src, url }]));
  }

  async function runImport() {
    const chk = checkFacebookUrl(fbUrl);
    if (!chk.ok) { setFbErr(chk.error); haptic.error(); return; }
    setFbErr(null); setFbBusy(true);
    let r: FbImport | null = null;
    try { r = await importFromFacebookAsBuyer(auth, chk.url); }
    catch (e: any) {
      track('facebook_import', { ...fbImportProps(null, e?.code), context: 'invite' });
      // Demasiados intentos, llave de invitado perdida o link inválido: se avisa en la hoja. Otra falla: completar a mano.
      if (e?.status === 401 || e?.status === 429 || e?.code === 'fb_url_invalid') { setFbErr(userMessage((e as Error).message)); setFbBusy(false); haptic.error(); return; }
    }
    const res = r ?? FAILED;
    if (res.title) setTitle(res.title.slice(0, TITLE_MAX));
    if (res.price_crc) setPrice(String(res.price_crc));
    setSource(chk.url); setErr(null);
    if (r) track('facebook_import', { ...fbImportProps(res), context: 'invite' });
    setFbNotice({ ...fbImportNotice(res), body: noticeBody(res), failed: res.result === 'failed' });
    setFbBusy(false); setFbOpen(false); setFbUrl('');
    res.result === 'failed' ? haptic.error() : haptic.success();
    res.photos.slice(0, Math.max(0, MAX_INVITE_PHOTOS - pics.length)).forEach((src, i) => addImportedPhoto(src, res.photo_urls?.[i]));
  }

  async function submit() {
    setErr(null);
    const t = title.trim();
    if (t.length < TITLE_MIN) return setErr('Escribe el nombre de lo que quieres comprar.');
    if (!priceNum || priceNum < MIN_PRICE || priceNum > MAX_PRICE) return setErr(`Ingresa un precio válido: mínimo ${formatCRC(MIN_PRICE)}, máximo ${formatCRC(MAX_PRICE)}.`);
    setBusy(true);
    try {
      const photos = pics.map((p) => p.url); // ya subidas al tomarlas (cámara) o guardadas por el servidor (Facebook)
      const code = await createInvite(auth, { title: t, price_crc: priceNum, ...(photos.length ? { photos } : {}), ...(source ? { source_url: source } : {}) });
      track('invite_created', { photos: photos.length, from_facebook: !!source });
      router.replace({ pathname: '/i/[code]', params: { code } });
    } catch (e) { trackError('create_invite', e); setErr(userMessage((e as Error).message)); } finally { setBusy(false); }
  }

  return (
    <Screen back="/comprar" title="Invitar a un vendedor" subtitle={short ? undefined : 'Dile qué quieres y a qué precio; él publica y te manda el link.'} scroll={false}
      footer={<>{err && <ErrorText>{err}</ErrorText>}<PrimaryButton title="Crear invitación" icon="paper-plane-outline" loading={busy} onPress={submit} /></>}>
      <View style={{ flex: 1, gap: S.sm }}>
        {fbNotice ? (
          <Card style={[s.fbNotice, fbNotice.failed && { borderColor: C.orange }]}>
            <View style={[s.fbIcon, fbNotice.failed && { backgroundColor: C.warnBg }]}><Icon name={fbNotice.failed ? 'alert-circle' : 'logo-facebook'} size={20} color={fbNotice.failed ? C.orange : C.lilac} /></View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={[T.headline, { fontSize: 15 }]} numberOfLines={2}>{fbNotice.title}</Text>
              <Text style={T.footnote} numberOfLines={2}>{fbNotice.body}</Text>
            </View>
            <Pressable onPress={() => { haptic.tap(); setFbNotice(null); setSource(null); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Quitar anuncio de Facebook" style={s.fbClose}><Icon name="close" size={18} color={C.textDim} /></Pressable>
          </Card>
        ) : (
          <Pressable onPress={() => { haptic.tap(); setFbErr(null); setFbOpen(true); }} accessibilityRole="button" accessibilityLabel="Importar de Facebook"
            style={({ pressed }) => [s.fbBtn, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
            <Icon name="logo-facebook" size={20} color={C.lilac} />
            <Text style={[T.headline, { color: C.lilac, fontSize: 15, flex: 1 }]} numberOfLines={1}>Importar de Facebook</Text>
            <Text style={[T.footnote, { color: C.textDim }]} numberOfLines={1}>Pega el link</Text>
            <Icon name="chevron-forward" size={16} color={C.textDim} />
          </Pressable>
        )}
        <Text style={T.caption}>Nombre del producto</Text>
        <TextInput style={ui.input} value={title} onChangeText={setTitle} placeholder="Ej. iPhone 13 de 128 GB" placeholderTextColor={C.textDim} maxLength={TITLE_MAX} accessibilityLabel="Nombre del producto" />
        <Text style={T.caption}>Precio acordado en colones</Text>
        <TextInput style={ui.input} value={formatPriceInput(price)} onChangeText={(v) => setPrice(formatPriceInput(v))} inputMode="numeric" keyboardType="number-pad" placeholder="250 000" placeholderTextColor={C.textDim} accessibilityLabel="Precio acordado" />
        <Text style={T.caption}>Fotos con la cámara (opcional)</Text>
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
            <Pressable accessibilityRole="button" accessibilityLabel="Tomar foto" onPress={() => { haptic.tap(); setCamOpen(true); }} style={[s.thumb, s.add]}>
              <Icon name="camera-outline" size={24} color={C.lilac} />
            </Pressable>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.xs }}><Icon name="information-circle-outline" size={18} color={C.lilac} /><Text style={[T.footnote, { flex: 1 }]} numberOfLines={3}>No necesitas cuenta: tu navegador guarda una llave para que solo tú pagues el link.</Text></View>
      </View>

      <CameraCapture visible={camOpen} purpose="listing" refId="new" asGuest onClose={() => setCamOpen(false)}
        onDone={(p) => { setPics((x) => (x.length >= MAX_INVITE_PHOTOS ? x : [...x, { key: `i${++seq}`, uri: p.uri, url: p.url }])); setCamOpen(false); }} />

      <Sheet visible={fbOpen} onClose={() => { if (!fbBusy) setFbOpen(false); }} title="Importar de Facebook"
        footer={<PrimaryButton title={fbBusy ? 'Leyendo el anuncio…' : 'Importar'} icon="download-outline" loading={fbBusy} disabled={!fbUrl.trim()} onPress={runImport} />}>
        <Text style={T.callout}>En Facebook abre el anuncio, toca Compartir y luego Copiar link. Pégalo aquí: llenamos el nombre, el precio y la foto para que solo revises.</Text>
        <TextInput style={[ui.input, fbErr && s.inputErr]} placeholder="facebook.com/marketplace/item/…" placeholderTextColor={C.textDim} value={fbUrl}
          onChangeText={(v) => { setFbUrl(v); if (fbErr) setFbErr(null); }} autoCapitalize="none" autoCorrect={false} keyboardType="url" inputMode="url"
          returnKeyType="go" onSubmitEditing={runImport} editable={!fbBusy} autoFocus accessibilityLabel="Link del anuncio de Facebook" />
        {fbErr ? <ErrorText>{fbErr}</ErrorText> : <Text style={T.footnote}>Solo anuncios públicos. El vendedor verá el link de su anuncio en la invitación.</Text>}
      </Sheet>
    </Screen>
  );
}

/** Texto del aviso para el comprador: el precio es el que acuerdas con el vendedor. */
function noticeBody(r: FbImport): string {
  if (r.result === 'failed') return 'Escribe el nombre y el precio. Guardamos el link para el vendedor.';
  return r.result === 'partial' ? fbImportNotice(r).body.replace('generar el link', 'crear la invitación') : 'Ajusta el precio si acordaste otro con el vendedor.';
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', gap: S.sm },
  thumb: { width: 64, height: 64, borderRadius: R.md, overflow: 'hidden', backgroundColor: C.lilacBg },
  add: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: C.lilac },
  remove: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: C.backdrop, alignItems: 'center', justifyContent: 'center' },
  inputErr: { borderColor: C.orange, borderWidth: 1 },
  fbBtn: { flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: 44, paddingHorizontal: S.md, borderRadius: R.md, borderWidth: 1, borderColor: C.lilac, backgroundColor: C.lilacBg },
  fbNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: S.sm, padding: S.sm + 2, borderWidth: 1, borderColor: C.lilac },
  fbIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' },
  fbClose: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
});
