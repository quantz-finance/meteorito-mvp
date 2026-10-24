// Comprador (sin cuenta): pide a un vendedor que publique el artículo. Mismos campos que el vendedor: nombre, precio y
// fotos opcionales. Crea una INVITACIÓN; el vendedor la confirma y manda el link de pago (reservado para este comprador).
// "Importar de un link": pega el link del anuncio de cualquier marketplace (Facebook, Mercado Libre, Amazon, Encuentra24,
// Walmart o cualquier tienda https). Se detecta el proveedor al pegar (mismo providers.ts que Vender). Donde se deja leer
// (Facebook, Walmart…) se precargan nombre, precio y foto con import_listing y la llave de invitado; donde no (Mercado
// Libre, Amazon…) NO se intenta: el link se acepta igual, sin error, y va en la invitación como referencia para el vendedor.
// Fotos propias: SOLO con la cámara de la app en el momento (CameraCapture, token 'listing' con su llave de invitado).
// La foto del anuncio importado la guarda el servidor (photo_urls). No hay carrete ni input de archivo.
import { router, useLocalSearchParams } from 'expo-router';
import { userMessage } from '@/lib/cavosSession';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useStableWindow } from '@/lib/viewport';
import { Card, ErrorText, haptic, Icon, PrimaryButton, Screen, Sheet, type IconName } from '@/components/ds';
import { ui } from '@/components/ui';
import { C, R, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { createInvite } from '@/lib/invites';
import { formatCRC } from '@/lib/orders';
import { formatPriceInput, MAX_PRICE, MIN_PRICE, parsePrice, TITLE_MAX, TITLE_MIN } from '@/lib/listing';
import { checkListingUrl, detectProvider, importFromLinkAsBuyer, importProps, INVITE_MARKETS, INVITE_URL_INVALID, inviteCanRead, inviteDetectedLabel, inviteImportNotice, inviteMarketsLabel, PROVIDER_ICON, type ListingImport } from '@/lib/listingImport';
import { CameraCapture } from '@/components/CameraCapture';
import { track, trackError } from '@/lib/analytics';

const MAX_INVITE_PHOTOS = 4;
/** Foto ya subida (cámara de la app o foto del anuncio importado, guardada por el servidor). */
interface Pic { key: string; uri: string; url: string }
let seq = 0;

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
  const [fbNotice, setFbNotice] = useState<{ title: string; body: string; icon: string } | null>(null);
  const detected = detectProvider(fbUrl);
  const [source, setSource] = useState<string | null>(null); // link del anuncio (referencia para el vendedor)
  const priceNum = parsePrice(price);

  const [camOpen, setCamOpen] = useState(false);
  /** Foto del anuncio: la data URL se muestra ya; la copia guardada por el servidor (photo_urls) es la que se usa. */
  function addImportedPhoto(src: string, url: string | null | undefined) {
    if (!url) return;
    setPics((p) => (p.length >= MAX_INVITE_PHOTOS ? p : [...p, { key: `i${++seq}`, uri: src, url }]));
  }

  async function runImport() {
    const chk = checkListingUrl(fbUrl);
    const d = detectProvider(fbUrl);
    if (!chk.ok || !d) { setFbErr(INVITE_URL_INVALID); haptic.error(); return; }
    setFbErr(null);
    let r: ListingImport | null = null;
    if (inviteCanRead(d)) { // solo donde funciona; Mercado Libre, Amazon… no se piden (bloquean nuestros servidores)
      setFbBusy(true);
      track('import_started', { provider: d.id, context: 'invite' });
      try { r = await importFromLinkAsBuyer(auth, chk.url); }
      catch (e: any) {
        track('import_failed', { provider: d.id, result: 'failed', code: String(e?.code ?? 'unknown').slice(0, 40), context: 'invite' });
        // Demasiados intentos o llave de invitado perdida: se avisa en la hoja. Otra falla: el link se acepta igual.
        if (e?.status === 401 || e?.status === 429) { setFbErr(userMessage((e as Error).message)); setFbBusy(false); haptic.error(); return; }
      }
    } else track('import_link_only', { provider: d.id, context: 'invite' });
    if (r) track(r.result === 'failed' ? 'import_failed' : 'import_succeeded', { ...importProps(r), context: 'invite' });
    const ok = r && r.result !== 'failed' ? r : null;
    if (ok?.title) setTitle(ok.title.slice(0, TITLE_MAX));
    if (ok?.price_crc) setPrice(String(ok.price_crc));
    setSource(r?.source_url ?? chk.url); setErr(null);
    setFbNotice({ ...inviteImportNotice(d, r), icon: d.icon });
    setFbBusy(false); setFbOpen(false); setFbUrl('');
    ok ? haptic.success() : haptic.tap();
    (ok?.photos ?? []).slice(0, Math.max(0, MAX_INVITE_PHOTOS - pics.length)).forEach((src, i) => addImportedPhoto(src, ok?.photo_urls?.[i]));
  }

  async function submit() {
    setErr(null);
    const t = title.trim();
    if (t.length < TITLE_MIN) return setErr('Escribe el nombre de lo que quieres comprar.');
    if (!priceNum || priceNum < MIN_PRICE || priceNum > MAX_PRICE) return setErr(`Ingresa un precio válido: mínimo ${formatCRC(MIN_PRICE)}, máximo ${formatCRC(MAX_PRICE)}.`);
    setBusy(true);
    try {
      const photos = pics.map((p) => p.url); // ya subidas al tomarlas (cámara) o guardadas por el servidor (anuncio importado)
      const code = await createInvite(auth, { title: t, price_crc: priceNum, ...(photos.length ? { photos } : {}), ...(source ? { source_url: source } : {}) });
      track('invite_created', { photos: photos.length, from_facebook: detectProvider(source ?? '')?.id === 'facebook', source_provider: source ? detectProvider(source)?.id ?? null : null });
      router.replace({ pathname: '/i/[code]', params: { code } });
    } catch (e) { trackError('create_invite', e); setErr(userMessage((e as Error).message)); } finally { setBusy(false); }
  }

  return (
    <Screen back="/comprar" title="Invitar a un vendedor" subtitle={short ? undefined : 'Dile qué quieres y a qué precio; él publica y te manda el link.'} scroll={false}
      footer={<>{err && <ErrorText>{err}</ErrorText>}<PrimaryButton title="Crear invitación" icon="paper-plane-outline" loading={busy} onPress={submit} /></>}>
      <View style={{ flex: 1, gap: S.sm }}>
        {fbNotice ? (
          <Card style={s.fbNotice}>
            <View style={s.fbIcon}><Icon name={fbNotice.icon as IconName} size={20} color={C.lilac} /></View>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={[T.headline, { fontSize: 15 }]} numberOfLines={2}>{fbNotice.title}</Text>
              <Text style={T.footnote} numberOfLines={2}>{fbNotice.body}</Text>
            </View>
            <Pressable onPress={() => { haptic.tap(); setFbNotice(null); setSource(null); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Quitar link del anuncio" style={s.fbClose}><Icon name="close" size={18} color={C.textDim} /></Pressable>
          </Card>
        ) : (
          <Pressable onPress={() => { haptic.tap(); setFbErr(null); setFbOpen(true); }} accessibilityRole="button" accessibilityLabel="Importar de un link"
            style={({ pressed }) => [s.fbBtn, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
            <Icon name="link" size={20} color={C.lilac} />
            <Text style={[T.headline, { color: C.lilac, fontSize: 15, flex: 1 }]} numberOfLines={1}>Importar de un link</Text>
            <Text style={[T.footnote, { color: C.textDim }]} numberOfLines={1}>Cualquier tienda</Text>
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

      <Sheet visible={fbOpen} onClose={() => { if (!fbBusy) setFbOpen(false); }} title="Importar de un link"
        footer={detected?.blocked
          ? <PrimaryButton title="Agregar link" icon="link" disabled={!fbUrl.trim()} onPress={runImport} />
          : <PrimaryButton title={fbBusy ? 'Leyendo el anuncio…' : 'Importar'} icon="download-outline" loading={fbBusy} disabled={!fbUrl.trim()} onPress={runImport} />}>
        <Text style={T.callout}>Abre el anuncio, toca Compartir y copia el link. Pégalo aquí: va en tu invitación para que el vendedor publique desde ahí.</Text>
        <View style={s.provRow} testID="invite-markets">
          {INVITE_MARKETS.map((id) => <View key={id} style={s.provBadge}><Icon name={PROVIDER_ICON[id] as IconName} size={16} color={C.lilac} /></View>)}
          <Text style={[T.footnote, { flex: 1 }]} numberOfLines={2}>{inviteMarketsLabel}</Text>
        </View>
        <TextInput style={[ui.input, fbErr && s.inputErr]} placeholder="Pega el link del anuncio" placeholderTextColor={C.textDim} value={fbUrl}
          onChangeText={(v) => { setFbUrl(v); if (fbErr) setFbErr(null); }} autoCapitalize="none" autoCorrect={false} keyboardType="url" inputMode="url"
          returnKeyType="go" onSubmitEditing={runImport} editable={!fbBusy} autoFocus accessibilityLabel="Link del anuncio" />
        {fbErr ? <ErrorText>{fbErr}</ErrorText>
          : detected ? <View style={s.detected} testID="import-provider"><Icon name={detected.icon as IconName} size={16} color={C.lilac} /><Text style={[T.footnote, { color: C.text, flex: 1 }]} numberOfLines={2}>{inviteDetectedLabel(detected)}</Text></View>
          : <Text style={T.footnote}>Solo anuncios públicos. El vendedor verá el link en la invitación.</Text>}
      </Sheet>
    </Screen>
  );
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
  provRow: { flexDirection: 'row', alignItems: 'center', gap: S.xs + 2 },
  provBadge: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' },
  detected: { flexDirection: 'row', alignItems: 'center', gap: S.xs + 2, minHeight: 20 },
});
