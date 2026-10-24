// Vender: el link en UNA sola pantalla. Nombre del producto, precio en colones y fotos -> "Generar link".
// El link aparece aquí mismo con Copiar y Compartir. Categoría, marca, modelo, estado e identificador ya no se piden.
// "Importar de un link": pega el link de tu anuncio (Facebook, Mercado Libre, Encuentra24, Amazon…) y precarga nombre,
// precio, fotos y descripción. Detecta el proveedor al pegar. No crea nada solo: el vendedor revisa y toca "Generar link".
// "Entrega y plazo": cara a cara o envío (default) y el plazo para liberar (24 h, 3 días, 7 días u otro, de 24 h a 30 días).
// Fotos: SOLO con la cámara de la app en el momento (CameraCapture, token 'listing'); se suben al tomarlas. Excepción: la
// foto del anuncio importado de Facebook (la guarda el servidor) y las fotos de la invitación del comprador.
import { ensureWalletReady, freshAuth, needsDeviceStep, walletErrorNotice, WALLET_LOADING } from '@/lib/wallet';
import type { MeteoritoAuth } from '@/lib/types';
import { OrphanWalletCard } from '@/components/OrphanWallet';
import { userMessage } from '@/lib/cavosSession';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { COPY } from '@/lib/copy';
import { blockedNotice, checkListingUrl, detectProvider, importFromLink, importNotice, importProps, IMPORT_FAILED, PROVIDER_ICON, SUPPORTED, type ListingImport } from '@/lib/listingImport';
import { useStableWindow } from '@/lib/viewport';
import { ui } from '@/components/ui';
import { BetaNotice, RulesHint } from '@/components/RulesLink';
import { SELL_SUMMARY } from '@/lib/rules';
import { Card, ErrorText, haptic, Icon, IconButton, PrimaryButton, Screen, Sheet, Skeleton, SuccessCheck, type IconName } from '@/components/ds';
import { Reveal } from '@/components/space';
import { ShareLink } from '@/components/ShareLink';
import { AdTemplateButton, AdTemplateSheet } from '@/components/AdTemplateSheet';
import { LastSeenInvite } from '@/components/LastSeenInvite';
import type { AdInput } from '@/lib/sellerTools';
import { Fonts } from '@/constants/Colors';
import { C, R, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { createOrder, formatCRC, orderLink } from '@/lib/orders';
import { getInvite, type Invite } from '@/lib/invites';
import { MAX_PHOTOS } from '@/lib/photos';
import { CameraCapture } from '@/components/CameraCapture';
import type { CapturedPhoto } from '@/lib/capture';
import { formatPriceInput, isListingValid, parsePrice, TITLE_MAX, validateListing, type ListingErrors } from '@/lib/listing';
import { LaunchButton } from '@/components/LaunchButton';
import { supabaseConfigured } from '@/lib/supabase';
import { loadSellDraft, saveSellDraft } from '@/lib/sellDraft';
import { priceBucket, track, trackError } from '@/lib/analytics';
import { agreementSummary, daysToMinutes, DEFAULT_PROTECTION_MIN, DELIVERY_LABEL, PROTECTION_CHIPS, protectionLabel, type DeliveryMode } from '../../api/_lib/agreement';

type PhotoStatus = 'processing' | 'ready' | 'uploading' | 'done' | 'error';
interface Photo { key: string; uri: string; mime: string; status: PhotoStatus; /** ya subida: cámara de la app, anuncio de Facebook (servidor) o invitación del comprador */ url: string }
interface Created { slug: string; title: string; price: number; photo: string | null; agreement: string; ad: AdInput }
let photoSeq = 0;

// Vender es la pestaña de entrada: (tabs) queda montado debajo de /p, /i, /t… abiertos por link.
// No se arma el formulario hasta que la pestaña se ve por primera vez (más liviano, sin campos duplicados ocultos).
export default function Vender() {
  const focused = useIsFocused();
  const [seen, setSeen] = useState(focused);
  useEffect(() => { if (focused) setSeen(true); }, [focused]);
  return seen ? <VenderForm /> : null;
}

function VenderForm() {
  const auth = useAuth();
  const { address } = auth;
  const [d0] = useState(() => loadSellDraft(address)); // borrador: sobrevive al re-login y a que iOS cierre la app
  const [title, setTitle] = useState(d0?.title ?? '');
  const [price, setPrice] = useState(d0?.price ?? '');
  const [description, setDescription] = useState<string | null>(d0?.description ?? null); // solo si vino de un link importado
  const [fbOpen, setFbOpen] = useState(false);
  const [fbUrl, setFbUrl] = useState('');
  const [fbBusy, setFbBusy] = useState(false);
  const [fbErr, setFbErr] = useState<string | null>(null);
  const [fbNotice, setFbNotice] = useState<{ title: string; body: string; failed: boolean; icon?: string } | null>(null);
  /** Anuncio importado: source_url canónico (habilita en el servidor las fotos que guardó al importar) y proveedor (migración 019). */
  const [source, setSource] = useState<{ url: string; provider: string } | null>(d0?.source ?? null);
  const detected = detectProvider(fbUrl);
  const [photos, setPhotos] = useState<Photo[]>(() => (d0?.photos ?? []).slice(0, MAX_PHOTOS).map((p) => ({ key: `p${++photoSeq}`, uri: p.uri ?? p.url, mime: 'image/jpeg', status: 'ready' as const, url: p.url })));
  const [errors, setErrors] = useState<ListingErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [orphan, setOrphan] = useState(false);
  const [waitWallet, setWaitWallet] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [adOpen, setAdOpen] = useState(false); // plantilla de anuncio del link recién creado
  // Acuerdo de entrega: envío 7 días por defecto; cara a cara 24 h.
  const [mode, setMode] = useState<DeliveryMode>(d0?.mode ?? 'envio');
  const [windowMin, setWindowMin] = useState<number>(d0?.windowMin ?? DEFAULT_PROTECTION_MIN[d0?.mode ?? 'envio']);
  const [agreeOpen, setAgreeOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customDays, setCustomDays] = useState('');
  const customMin = customOpen ? daysToMinutes(customDays) : null;
  const pickMode = (m: DeliveryMode) => { haptic.tap(); setMode(m); setWindowMin(DEFAULT_PROTECTION_MIN[m]); setCustomOpen(false); setCustomDays(''); };
  const short = useStableWindow().height < 740; // iPhone SE y similares: menos aire, todo en una pantalla

  // Respuesta a una invitación del comprador (?invite=codigo): nombre y precio precargados; el precio acordado no se cambia.
  const { invite: inviteParam } = useLocalSearchParams<{ invite?: string }>();
  const [invite, setInvite] = useState<Invite | null>(null);
  useEffect(() => {
    if (!inviteParam) { setInvite(null); return; }
    let live = true;
    getInvite(String(inviteParam)).then((i) => {
      if (!live || !i || i.status !== 'abierta') { if (live && i) setError('Esta invitación ya no está abierta.'); return; }
      setInvite(i); setCreated(null); setTitle(`${i.brand} ${i.model}`.trim().slice(0, TITLE_MAX)); setPrice(String(i.price_crc));
      // Fotos de la invitación (p. ej. la del anuncio de Facebook que importó el comprador): el API acepta reutilizarlas.
      if (i.photos?.length) setPhotos(i.photos.slice(0, MAX_PHOTOS).map((url) => ({ key: `p${++photoSeq}`, uri: url, mime: 'image/jpeg', status: 'ready' as const, url })));
    }).catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [inviteParam]);

  useEffect(() => { // reanudar "Generar link" cuando Cavos termina de cargar (máx. 20 s)
    if (!waitWallet) return;
    if (auth.wallet?.state !== 'loading') { setWaitWallet(false); setBusy(false); submit(); return; }
    const t = setTimeout(() => { setWaitWallet(false); setBusy(false); setError(WALLET_LOADING); }, 20_000);
    return () => clearTimeout(t);
  }, [waitWallet, auth.wallet?.state]);
  // Segundo dispositivo (cuenta creada en otro): paso "Confirma que eres tú" con la passkey, antes de intentar publicar.
  useEffect(() => { if (auth.wallet?.state === 'needs-approval') setOrphan(true); }, [auth.wallet?.state]);
  const priceNum = parsePrice(price);
  const photosBusy = photos.some((p) => p.status === 'processing');
  // Con un aviso arriba (importado, invitación, confirmar dispositivo) hay menos espacio: "Ver reglas" baja junto al círculo y en
  // iPhone SE se aprieta un poco más (fotos y espacios), para que el aviso de beta nunca quede bajo el círculo.
  const extra = !!fbNotice || !!invite || orphan;
  const tight = short || extra, tiny = short && extra;
  const ready = isListingValid({ title, price: priceNum, photos: photos.length, photosBusy }); // el círculo se enciende cuando todo está listo
  useEffect(() => { if (!created) saveSellDraft({ owner: address, title, price, description, photos: photos.map((p) => ({ url: p.url, uri: p.uri })), mode, windowMin, source }); }, [address, title, price, description, photos, mode, windowMin, source, created]);
  const clearErr = (k: keyof ListingErrors) => setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));

  const [camOpen, setCamOpen] = useState(false);
  /** Foto de la cámara de la app: ya viene subida con su token de un uso. */
  function addCameraPhoto(p: CapturedPhoto) {
    setPhotos((ps) => (ps.length >= MAX_PHOTOS ? ps : [...ps, { key: `p${++photoSeq}`, uri: p.uri, mime: 'image/jpeg', status: 'ready', url: p.url }]));
    clearErr('photos'); setCamOpen(false);
  }
  /** Foto del anuncio importado: la guardó el servidor al importar (photo_urls); la data URL solo se usa para mostrarla. */
  function addImportedPhoto(src: string, url: string | null | undefined) {
    if (!url) return; // sin copia en el servidor no se puede usar: el vendedor toma la suya con la cámara
    setPhotos((p) => (p.length >= MAX_PHOTOS ? p : [...p, { key: `p${++photoSeq}`, uri: src, mime: 'image/jpeg', status: 'ready', url }])); clearErr('photos');
  }

  async function runImport() {
    const chk = checkListingUrl(fbUrl);
    if (!chk.ok) { setFbErr(chk.error); haptic.error(); return; }
    const provider = chk.provider.id;
    setFbErr(null); setFbBusy(true);
    track('import_started', { provider });
    let r: ListingImport | null = null;
    try { r = await importFromLink(freshAuth(auth), chk.url); }
    catch (e: any) {
      track('import_failed', { provider, code: String(e?.code ?? e?.status ?? 'unknown').slice(0, 40) });
      // Sesión vencida o demasiados intentos: su propio mensaje. Cualquier otra falla: el mensaje amable.
      setFbErr(e?.status === 401 || e?.status === 429 || e?.code === 'import_url_invalid' ? userMessage((e as Error).message) : IMPORT_FAILED);
      setFbBusy(false); haptic.error(); return;
    }
    if (r.result === 'failed') { // la hoja sigue abierta: puede probar otro link o cerrar y tomar las fotos
      track('import_failed', { provider: r.provider, code: String(r.code ?? 'unreadable').slice(0, 40) });
      setFbErr(IMPORT_FAILED); setFbBusy(false); haptic.error(); return;
    }
    track('import_succeeded', importProps(r));
    if (r.title) { setTitle(r.title.slice(0, TITLE_MAX)); clearErr('title'); }
    if (r.price_crc && !invite) { setPrice(String(r.price_crc)); clearErr('price'); }
    setDescription(r.description ? r.description.slice(0, 2000) : null);
    setSource(r.source_url ? { url: r.source_url, provider: r.provider } : null);
    setFbNotice({ ...importNotice(r), failed: false, icon: PROVIDER_ICON[r.provider] });
    setFbBusy(false); setFbOpen(false); setFbUrl('');
    haptic.success();
    // Fotos del anuncio: las guardó el servidor (photo_urls) y son las únicas exentas de "solo cámara"; las que el
    // vendedor agregue a mano se toman con la cámara.
    r.photos.slice(0, Math.max(0, MAX_PHOTOS - photos.length)).forEach((src, i) => addImportedPhoto(src, r!.photo_urls?.[i]));
  }

  const removePhoto = useCallback((key: string) => { haptic.tap(); setPhotos((ps) => ps.filter((p) => p.key !== key)); }, []);

  async function submit(restored?: MeteoritoAuth) {
    const a = restored ?? freshAuth(auth);
    setError(null);
    const errs = validateListing({ title, price: priceNum, photos: photos.length, photosBusy });
    setErrors(errs);
    if (Object.keys(errs).length) { haptic.error(); return; }
    if (!address) return setError('Inicia sesión de nuevo.');
    if (!supabaseConfigured) return setError('Falta configurar Supabase (.env)');
    if (a.wallet?.state === 'needs-approval') { setOrphan(true); haptic.error(); track('create_failed', { code: 'device_needs_passkey', wallet_state: 'needs-approval', has_passkey: !!a.wallet.hasPasskey }); return; }
    // Cavos todavía cargando la cuenta (p. ej. justo después de entrar): esperar a que termine en vez de fallar.
    if (a.wallet?.state === 'loading') { setWaitWallet(true); setBusy(true); return; }
    track('sell_submit_tapped', { step: 0 });
    setBusy(true);
    try {
      await ensureWalletReady(a).catch((e) => { const msg = walletErrorNotice(e); if (e?.code === 'device_not_authorized' || needsDeviceStep(e)) setOrphan(true); throw Object.assign(new Error(msg), { code: e?.code }); }); // primer link: activar la wallet
      const urls = photos.map((p) => p.url); // ya subidas al tomarlas (cámara) o guardadas por el servidor (Facebook / invitación)
      const t = title.trim();
      const slug = await createOrder(a, { title: t, price_crc: priceNum, photos: urls, delivery_mode: mode, protection_minutes: windowMin, ...(description ? { description } : {}), ...(invite ? { invite: invite.code } : {}), ...(source ? { source_url: source.url, source_provider: source.provider } : {}) });
      track('link_created', { category: 'otro', photos: urls.length, price_bucket: priceBucket(priceNum), from_invite: !!invite, from_facebook: source?.provider === 'facebook', import_provider: source?.provider ?? null, delivery_mode: mode, protection_minutes: windowMin });
      haptic.success();
      setCreated({ slug, title: t, price: priceNum, photo: photos[0]?.uri ?? null, agreement: agreementSummary(mode, windowMin),
        ad: { title: t, price_crc: priceNum, link: orderLink(slug), description, delivery_mode: mode, protection_minutes: windowMin } });
      setMode('envio'); setWindowMin(DEFAULT_PROTECTION_MIN.envio); setCustomOpen(false); setCustomDays('');
      setTitle(''); setPrice(''); setPhotos([]); setInvite(null); setDescription(null); setFbNotice(null); setSource(null); saveSellDraft(null);
      if (inviteParam) router.setParams({ invite: undefined });
    } catch (e: any) {
      haptic.error(); trackError('create_listing', e);
      // Código exacto (sin datos personales) para diagnosticar fallas de create/activate por dispositivo.
      track('create_failed', { code: String(e?.code ?? 'unknown').slice(0, 40), wallet_state: freshAuth(auth).wallet?.state ?? 'none', has_passkey: !!freshAuth(auth).wallet?.hasPasskey });
      if (needsDeviceStep(e)) setOrphan(true);
      else if (e?.code !== 'device_not_authorized') setError(userMessage((e as Error).message));
    } finally { setBusy(false); }
  }

  const right = (
    <View style={{ alignItems: 'flex-end', gap: S.sm }}>
      <IconButton icon="storefront-outline" label="Mi tienda" onPress={() => router.push('/mi-tienda')} />
    </View>
  );

  if (created) return (
    <Screen footerBare title="Vender" right={right} scroll={false}
      footer={<View style={{ flexDirection: 'row', gap: S.sm }}>
        <View style={{ flex: 1 }}><PrimaryButton title="Otro link" icon="add" variant="secondary" onPress={() => { setCreated(null); setError(null); }} /></View>
        <View style={{ flex: 1 }}><PrimaryButton title="Mi tienda" icon="storefront-outline" variant="secondary" onPress={() => router.push('/mi-tienda')} /></View>
      </View>}>
      <View style={{ flex: 1, gap: S.md, justifyContent: 'center' }}>
        <Reveal i={0} style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
          <SuccessCheck size={short ? 44 : 56} celebrate />
          <Text style={[T.title, { flex: 1 }]}>¡Tu link está listo!</Text>
        </Reveal>
        <Reveal i={1}><Card style={{ flexDirection: 'row', gap: S.md, alignItems: 'center', padding: S.sm + 4 }}>
          {created.photo ? <Image source={{ uri: created.photo }} style={s.thumb} /> : <View style={s.thumb}><Icon name="pricetag-outline" size={24} color={C.lilac} /></View>}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={T.headline} numberOfLines={2}>{created.title}</Text>
            <Text style={[T.title, { fontVariant: ['tabular-nums'] }]}>{formatCRC(created.price)}</Text>
            <Text style={T.footnote} numberOfLines={2}>{created.agreement}</Text>
          </View>
        </Card></Reveal>
        <Reveal i={2}><ShareLink kind="order" link={orderLink(created.slug)} message={`${created.title} por ${formatCRC(created.price)}. Paga aquí con Meteorito:`} /></Reveal>
        <Reveal i={3}><AdTemplateButton onPress={() => setAdOpen(true)} /></Reveal>
        <Reveal i={4}><Text style={[T.footnote, { textAlign: 'center' }]}>El comprador paga sin crear cuenta; tú cobras al entregar.</Text></Reveal>
      </View>
      <AdTemplateSheet visible={adOpen} onClose={() => setAdOpen(false)} ad={created.ad} />
      <LastSeenInvite trigger={created.slug} />
    </Screen>
  );

  return (
    <Screen footerBare title="Vender" subtitle={short ? undefined : 'Nombre, precio y fotos. Nada más.'} right={right} scroll={false}
      footer={<View style={s.dock}>{/* el círculo al centro; en iPhone SE "Ver reglas" a su izquierda (no cabe arriba sin scroll) */}
        <View style={s.dockSide}>{tight ? <RulesHint text={SELL_SUMMARY} from="sell" compact /> : null}</View>
        <LaunchButton label="Generar link" ready={ready} busy={busy} short={short} onPress={() => submit()} />
        <View style={s.dockSide} />
      </View>}>
      <View style={{ flex: 1, gap: tiny ? 6 : short ? S.sm : S.md }}>{/* iPhone SE: menos aire para que "Entrega y plazo" y el aviso de beta quepan sin scroll */}
      {orphan ? <OrphanWalletCard compact={short} onRestored={(r) => { setOrphan(false); if (title.trim() && photos.length) submit(r); }} /> : null}
      {invite && <Card style={{ gap: 2, padding: S.sm + 4 }}><Text style={T.headline} numberOfLines={1}>Respondes a una invitación</Text><Text style={T.footnote} numberOfLines={2}>Te piden {`${invite.brand} ${invite.model}`.trim()} por {formatCRC(invite.price_crc)}. El link queda reservado para quien te invitó.</Text></Card>}

      {invite ? null : fbNotice ? (
        <Card style={[s.fbNotice, short && { padding: S.sm }, fbNotice.failed && { borderColor: C.orange }]}>{/* iPhone SE: aviso compacto (1 línea + 1 línea) para que el aviso de beta no quede bajo "Generar link" */}
          <View style={[s.fbIcon, fbNotice.failed && { backgroundColor: C.warnBg }]}><Icon name={fbNotice.failed ? 'alert-circle' : (fbNotice.icon ?? 'link') as IconName} size={20} color={fbNotice.failed ? C.orange : C.lilac} /></View>
          <View style={{ flex: 1, minWidth: 0, gap: short ? 0 : 2 }}>
            <Text style={[T.headline, { fontSize: 15 }]} numberOfLines={short ? 1 : 2}>{fbNotice.title}</Text>
            <Text style={T.footnote} numberOfLines={short ? 1 : 2}>{fbNotice.body}</Text>
            {description ? <Pressable onPress={() => { haptic.tap(); setDescription(null); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Quitar descripción">
              <Text style={[T.footnote, { color: C.lilac }]} numberOfLines={1}>Incluye la descripción del anuncio · Quitar</Text>
            </Pressable> : null}
          </View>
          <Pressable onPress={() => { haptic.tap(); setFbNotice(null); setSource(null); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cerrar aviso" style={s.fbClose}><Icon name="close" size={18} color={C.textDim} /></Pressable>
        </Card>
      ) : (
        <Pressable onPress={() => { haptic.tap(); setFbErr(null); setFbOpen(true); }} accessibilityRole="button" accessibilityLabel={COPY.importLink.title}
          style={({ pressed }) => [s.fbBtn, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
          <Icon name="link" size={20} color={C.lilac} />
          <Text style={[T.headline, { color: C.lilac, fontSize: 15, flex: 1 }]} numberOfLines={1}>{COPY.importLink.title}</Text>
          <View style={s.provIcons} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {SUPPORTED.slice(0, 3).map((p) => <Icon key={p.id} name={PROVIDER_ICON[p.id] as IconName} size={14} color={C.textDim} />)}
          </View>
          <Icon name="chevron-forward" size={16} color={C.textDim} />
        </Pressable>
      )}

      <View style={{ gap: S.xs }}>{/* etiqueta dentro del campo: mismo texto, menos alto (el círculo cabe sin scroll) */}
        <View style={[s.field, title.trim() ? s.fieldOn : null, errors.title && s.inputErr]}>
          <Text style={s.fieldLabel}>Nombre del producto</Text>
          <TextInput style={s.fieldInput} placeholder="Ej. iPhone 13 de 128 GB" placeholderTextColor={C.textDim}
            value={title} onChangeText={(v) => { setTitle(v); clearErr('title'); }} maxLength={TITLE_MAX} returnKeyType="next" accessibilityLabel="Nombre del producto" />
        </View>
        {errors.title ? <ErrorText>{errors.title}</ErrorText> : null}
      </View>

      <View style={{ gap: S.xs }}>
        <View style={[s.field, priceNum > 0 ? s.fieldOn : null, errors.price && s.inputErr, invite && { opacity: 0.7 }]}>
          <Text style={s.fieldLabel}>Precio en colones</Text>
          <View style={s.priceRow}>
            <Text style={s.currency}>₡</Text>
            <TextInput style={s.priceInput} placeholder="0" placeholderTextColor={C.textDim} keyboardType="number-pad" inputMode="numeric"
              value={formatPriceInput(price)} onChangeText={(v) => { setPrice(v); clearErr('price'); }} editable={!invite} accessibilityLabel="Precio en colones" />
          </View>
        </View>
        {errors.price ? <ErrorText>{errors.price}</ErrorText> : null}
      </View>

      <View style={{ gap: S.xs }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={T.caption}>Fotos ({photos.length}/{MAX_PHOTOS})</Text>
          {photos.length > 0 && !errors.photos ? <Text style={T.footnote}>Toca una para quitarla</Text> : null}
        </View>
        <View style={s.grid}>
          {photos.map((p, i) => <PhotoTile key={p.key} photo={p} index={i} total={photos.length} small={short} tiny={tiny} onRemove={busy ? undefined : removePhoto} />)}
          {photos.length < MAX_PHOTOS && (
            <Pressable onPress={() => { haptic.tap(); setCamOpen(true); }} accessibilityRole="button" accessibilityLabel="Tomar foto" style={({ pressed }) => [s.photo, short && s.photoSm, tiny && s.photoXs, s.photoAdd, errors.photos && { borderColor: C.orange }, pressed && { opacity: 0.8 }]}>
              <Icon name="camera" size={24} color={C.lilac} />
              <Text style={[T.footnote, { color: C.lilac }]}>Tomar</Text>
            </Pressable>
          )}
        </View>
        {errors.photos ? <ErrorText>{errors.photos}</ErrorText> : null}
      </View>

      <Pressable onPress={() => { haptic.tap(); setAgreeOpen(true); }} accessibilityRole="button" accessibilityLabel="Entrega y plazo"
        style={({ pressed }) => [s.agreeRow, pressed && { opacity: 0.85 }]}>
        <Icon name={mode === 'cara_a_cara' ? 'people-outline' : 'cube-outline'} size={20} color={C.lilac} />
        <Text style={[T.headline, { fontSize: 15, flex: 1 }]} numberOfLines={1}>Entrega y plazo</Text>
        <Text testID="agreement-value" style={[T.footnote, { color: C.text }]} numberOfLines={1}>{DELIVERY_LABEL[mode]} · {protectionLabel(windowMin)}</Text>
        <Icon name="chevron-forward" size={16} color={C.textDim} />
      </Pressable>
      {error && <ErrorText>{error}</ErrorText>}
      {tight ? null : <Text style={T.footnote}>De 1 a 4 fotos con la cámara, en este momento.</Text>}
      {tight ? null : <RulesHint text={SELL_SUMMARY} from="sell" /* iPhone SE o con aviso: "Ver reglas" va junto al círculo, abajo */ />}
      <BetaNotice from="sell" />
      </View>

      <CameraCapture visible={camOpen} purpose="listing" refId="new" onClose={() => setCamOpen(false)} onDone={addCameraPhoto} />
      <Sheet visible={agreeOpen} onClose={() => setAgreeOpen(false)} title="Entrega y plazo"
        footer={<PrimaryButton title="Listo" icon="checkmark" disabled={customOpen && !customMin}
          onPress={() => { if (customOpen && customMin) setWindowMin(customMin); setAgreeOpen(false); }} />}>
        <Text style={T.caption}>¿Cómo entregas?</Text>
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          {(['envio', 'cara_a_cara'] as DeliveryMode[]).map((m) => <Pressable key={m} onPress={() => pickMode(m)} accessibilityRole="radio" aria-checked={mode === m}
            accessibilityLabel={DELIVERY_LABEL[m]} style={({ pressed }) => [s.choice, mode === m && s.choiceOn, pressed && { opacity: 0.85 }]}>
            <Icon name={m === 'cara_a_cara' ? 'people-outline' : 'cube-outline'} size={20} color={mode === m ? C.white : C.lilac} />
            <Text style={[T.headline, { fontSize: 15, color: mode === m ? C.white : C.lilac }]}>{DELIVERY_LABEL[m]}</Text>
          </Pressable>)}
        </View>
        <Text style={T.caption}>Plazo para liberar el pago</Text>
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          {PROTECTION_CHIPS.map((m) => { const on = !customOpen && windowMin === m; return <Pressable key={m} onPress={() => { haptic.tap(); setCustomOpen(false); setWindowMin(m); }}
            accessibilityRole="radio" aria-checked={on} accessibilityLabel={`Plazo ${protectionLabel(m)}`} style={({ pressed }) => [s.chip, on && s.choiceOn, pressed && { opacity: 0.85 }]}>
            <Text style={[T.headline, { fontSize: 15, color: on ? C.white : C.lilac }]}>{protectionLabel(m)}</Text>
          </Pressable>; })}
          <Pressable onPress={() => { haptic.tap(); setCustomOpen(true); setCustomDays(PROTECTION_CHIPS.includes(windowMin) ? '' : String(windowMin / 1440)); }} accessibilityRole="radio"
            aria-checked={customOpen || !PROTECTION_CHIPS.includes(windowMin)} accessibilityLabel="Otro plazo en días"
            style={({ pressed }) => [s.chip, (customOpen || !PROTECTION_CHIPS.includes(windowMin)) && s.choiceOn, pressed && { opacity: 0.85 }]}>
            <Text style={[T.headline, { fontSize: 15, color: customOpen || !PROTECTION_CHIPS.includes(windowMin) ? C.white : C.lilac }]}>{!customOpen && !PROTECTION_CHIPS.includes(windowMin) ? protectionLabel(windowMin) : 'Otro'}</Text>
          </Pressable>
        </View>
        {customOpen ? <View style={{ gap: S.xs }}>
          <TextInput style={[ui.input, s.input, customDays && !customMin ? s.inputErr : null]} placeholder="Días (de 1 a 30)" placeholderTextColor={C.textDim} keyboardType="number-pad" inputMode="numeric"
            value={customDays} onChangeText={(v) => setCustomDays(v.replace(/\D/g, '').slice(0, 2))} maxLength={2} autoFocus accessibilityLabel="Días del plazo" />
          {customDays && !customMin ? <ErrorText>Escribe de 1 a 30 días.</ErrorText> : null}
        </View> : null}
        <Text style={T.footnote}>{mode === 'cara_a_cara'
          ? 'Cara a cara: el plazo cuenta desde el pago. El comprador te da su código cuando revisa el producto.'
          : 'Envío: el plazo cuenta desde que tocas "Ya lo envié".'} Si el comprador no reporta un problema, el pago se libera al terminar el plazo. Lo ve antes de pagar.</Text>
      </Sheet>

      <Sheet visible={fbOpen} onClose={() => { if (!fbBusy) setFbOpen(false); }} title={COPY.importLink.title}
        footer={<PrimaryButton title={fbBusy ? 'Leyendo el anuncio…' : 'Importar'} icon="download-outline" loading={fbBusy} disabled={!fbUrl.trim() || !!detected?.blocked} onPress={runImport} />}>
        <Text style={T.callout}>Abre tu anuncio, toca Compartir y copia el link. Pégalo aquí: llenamos el nombre, el precio y las fotos para que solo revises.</Text>
        <View style={s.provRow} testID="import-providers">
          {SUPPORTED.slice(0, 5).map((p) => <View key={p.id} style={s.provBadge} accessibilityLabel={p.name}><Icon name={PROVIDER_ICON[p.id] as IconName} size={16} color={C.lilac} /></View>)}
          <Text style={[T.footnote, { flex: 1 }]} numberOfLines={2}>{COPY.importLink.label}</Text>
        </View>
        <TextInput style={[ui.input, fbErr && s.inputErr]} placeholder={COPY.importLink.label} placeholderTextColor={C.textDim} value={fbUrl}
          onChangeText={(v) => { setFbUrl(v); if (fbErr) setFbErr(null); }} autoCapitalize="none" autoCorrect={false} keyboardType="url" inputMode="url"
          returnKeyType="go" onSubmitEditing={runImport} editable={!fbBusy} autoFocus accessibilityLabel="Link del anuncio" />
        {fbBusy ? (
          <View style={s.skel} testID="import-skeleton">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
              <Icon name={(detected?.icon ?? 'link') as IconName} size={18} color={C.lilac} />
              <Text style={[T.footnote, { color: C.text, flex: 1 }]} numberOfLines={1}>Leyendo tu anuncio de {detected?.name ?? 'la página'}…</Text>
            </View>
            <Skeleton w="80%" h={14} /><Skeleton w="40%" h={14} />
            <View style={{ flexDirection: 'row', gap: S.sm }}>{[0, 1, 2].map((i) => <Skeleton key={i} w={48} h={48} r={R.sm} />)}</View>
          </View>
        ) : fbErr ? <ErrorText>{fbErr}</ErrorText>
          : detected?.blocked ? <View style={s.detected} testID="import-provider"><Icon name="alert-circle" size={16} color={C.orange} /><Text style={[T.footnote, { color: C.orange, flex: 1 }]} numberOfLines={2}>{blockedNotice(detected.name)}</Text></View>
          : detected ? <View style={s.detected} testID="import-provider"><Icon name={detected.icon as IconName} size={16} color={C.lilac} /><Text style={[T.footnote, { color: C.text, flex: 1 }]} numberOfLines={1}>Anuncio de {detected.name}</Text></View>
          : <Text style={T.footnote}>Solo anuncios públicos. Tú confirmas el precio final.</Text>}
      </Sheet>
    </Screen>
  );
}

/** Foto con su propio estado. Memo: no se re-renderiza al teclear. */
const PhotoTile = memo(function PhotoTile({ photo, index, total, small, tiny, onRemove }: { photo: Photo; index: number; total: number; small?: boolean; tiny?: boolean; onRemove?: (key: string) => void }) {
  const [loaded, setLoaded] = useState(false);
  const busy = photo.status === 'processing' || photo.status === 'uploading' || !loaded;
  return (
    <Pressable style={[s.photo, small && s.photoSm, tiny && s.photoXs]} accessibilityLabel="Quitar foto" disabled={!onRemove || photo.status === 'uploading'} onPress={() => onRemove?.(photo.key)}>
      <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} />
      {busy || photo.status === 'error' ? (
        <View style={s.photoOverlay}>
          {photo.status === 'error' ? <Icon name="alert-circle" size={22} color={C.orange} /> : <ActivityIndicator color={C.white} />}
          <Text style={[T.footnote, { color: C.white, fontSize: 11 }]} numberOfLines={1}>{photo.status === 'uploading' ? `${index + 1}/${total}` : ''}</Text>
        </View>
      ) : photo.status === 'done' ? <View style={s.photoX}><Icon name="checkmark" size={14} color={C.success} /></View>
        : onRemove ? <View style={s.photoX}><Icon name="close" size={14} color={C.white} /></View> : null}
    </Pressable>
  );
});

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  photo: { width: '22.5%', aspectRatio: 1, borderRadius: R.md, overflow: 'hidden', backgroundColor: C.surface },
  photoAdd: { alignItems: 'center', justifyContent: 'center', gap: 2, borderWidth: 2, borderStyle: 'dashed', borderColor: C.lilac, backgroundColor: 'transparent' },
  photoOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(26,11,61,0.6)', alignItems: 'center', justifyContent: 'center', gap: 2 },
  photoX: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 46 },
  // Campo con la etiqueta adentro (cápsula de vidrio); se ilumina en naranja suave cuando ya tiene valor.
  field: { backgroundColor: 'rgba(45,20,102,0.72)', borderRadius: R.md, paddingHorizontal: S.md, paddingTop: 7, paddingBottom: 3, borderWidth: 1, borderColor: 'rgba(201,182,255,0.22)' },
  fieldOn: { borderColor: 'rgba(255,170,110,0.55)' },
  fieldLabel: { fontFamily: Fonts.bold, fontSize: 11, lineHeight: 14, letterSpacing: 0.6, textTransform: 'uppercase', color: C.textDim },
  fieldInput: { fontFamily: Fonts.bold, fontSize: 17, color: C.text, paddingVertical: 5, minHeight: 32, outlineStyle: 'none' } as object,
  priceRow: { flexDirection: 'row', alignItems: 'center' },
  currency: { fontFamily: Fonts.black, fontSize: 22, color: C.orange, marginRight: S.xs },
  priceInput: { flex: 1, minWidth: 0, fontFamily: Fonts.black, fontSize: 22, color: C.text, paddingVertical: 2, minHeight: 32, fontVariant: ['tabular-nums'], outlineStyle: 'none' } as object,
  photoSm: { width: 64 },
  photoXs: { width: 56 },
  dock: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  dockSide: { flex: 1, minWidth: 0 },
  inputErr: { borderColor: C.orange, borderWidth: 1 },
  fbBtn: { flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: 44, paddingHorizontal: S.md, borderRadius: R.md, borderWidth: 1, borderColor: C.lilac, backgroundColor: C.lilacBg },
  fbNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: S.sm, padding: S.sm + 2, borderWidth: 1, borderColor: C.lilac },
  fbIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' },
  fbClose: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  skel: { gap: S.sm, padding: S.sm + 4, borderRadius: R.md, backgroundColor: C.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  provIcons: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  provRow: { flexDirection: 'row', alignItems: 'center', gap: S.xs + 2 },
  provBadge: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' },
  detected: { flexDirection: 'row', alignItems: 'center', gap: S.xs + 2, minHeight: 20 },
  agreeRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: 44, paddingHorizontal: S.md, borderRadius: R.md, backgroundColor: C.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  choice: { flex: 1, flexDirection: 'row', gap: S.xs + 2, alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: R.md, borderWidth: 1, borderColor: C.lilac },
  chip: { flex: 1, minHeight: 44, borderRadius: R.md, borderWidth: 1, borderColor: C.lilac, alignItems: 'center', justifyContent: 'center' },
  choiceOn: { backgroundColor: C.lilac, borderColor: C.lilac },
  thumb: { width: 56, height: 56, borderRadius: R.md, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' },
});
