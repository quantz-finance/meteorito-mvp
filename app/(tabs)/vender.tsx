// Vender: el link en UNA sola pantalla. Nombre del producto, precio en colones y fotos -> "Generar link".
// El link aparece aquí mismo con Copiar y Compartir. Categoría, marca, modelo, estado e identificador ya no se piden.
// "Importar de Facebook": pega el link de un anuncio de Marketplace y precarga nombre, precio, foto y descripción.
// No crea nada solo: el vendedor revisa y toca "Generar link" (los datos leídos de FB pueden venir mal).
// "Entrega y plazo": cara a cara o envío (default) y el plazo para liberar (24 h, 3 días, 7 días u otro, de 24 h a 30 días).
import { ensureWalletReady, freshAuth, needsDeviceStep, walletErrorNotice, WALLET_LOADING } from '@/lib/wallet';
import type { MeteoritoAuth } from '@/lib/types';
import { OrphanWalletCard } from '@/components/OrphanWallet';
import { userMessage } from '@/lib/cavosSession';
import * as ImagePicker from 'expo-image-picker';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { checkFacebookUrl, fbImportNotice, fbImportProps, importedPhotoBlob, importFromFacebook, type FbImport } from '@/lib/fbImport';
import { useStableWindow } from '@/lib/viewport';
import { ui } from '@/components/ui';
import { BetaNotice, RulesHint } from '@/components/RulesLink';
import { SELL_SUMMARY } from '@/lib/rules';
import { Card, ErrorText, haptic, Icon, IconButton, PrimaryButton, Screen, Sheet, SuccessCheck } from '@/components/ds';
import { Reveal } from '@/components/space';
import { ShareLink } from '@/components/ShareLink';
import { Fonts } from '@/constants/Colors';
import { C, R, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { createOrder, formatCRC, orderLink } from '@/lib/orders';
import { getInvite, type Invite } from '@/lib/invites';
import { compressPhoto, MAX_PHOTOS, newDraftId, uploadCompressed, uploadPhoto } from '@/lib/photos';
import { formatPriceInput, parsePrice, TITLE_MAX, validateListing, type ListingErrors } from '@/lib/listing';
import { supabaseConfigured } from '@/lib/supabase';
import { priceBucket, track, trackError } from '@/lib/analytics';
import { photoFailureProps } from '@/lib/photoError';
import { agreementSummary, daysToMinutes, DEFAULT_PROTECTION_MIN, DELIVERY_LABEL, PROTECTION_CHIPS, protectionLabel, type DeliveryMode } from '../../api/_lib/agreement';

type PhotoStatus = 'processing' | 'ready' | 'uploading' | 'done' | 'error';
interface Photo { key: string; uri: string; mime: string; width?: number; height?: number; status: PhotoStatus; blob?: Blob; /** ya subida (foto de la invitación del comprador): se reutiliza tal cual */ url?: string }
interface Created { slug: string; title: string; price: number; photo: string | null; agreement: string }
let photoSeq = 0;

/** Borrador (solo texto): sobrevive al cambiar de pestaña y a recargas en web. Se descarta al generar el link. */
interface Draft { owner: string | null; title: string; price: string; description?: string | null }
const DRAFT_KEY = 'meteorito:sell-draft-v2';
let memDraft: Draft | null = null;
function loadDraft(owner: string | null): Draft | null {
  if (!memDraft) { try { const raw = typeof window !== 'undefined' ? window.sessionStorage?.getItem(DRAFT_KEY) : null; if (raw) memDraft = JSON.parse(raw); } catch { /* sin storage */ } }
  if (!memDraft || (memDraft.owner && owner && memDraft.owner !== owner)) return null;
  return memDraft;
}
function saveDraft(d: Draft | null) {
  memDraft = d;
  try { if (typeof window === 'undefined' || !window.sessionStorage) return; if (d) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)); else window.sessionStorage.removeItem(DRAFT_KEY); } catch { /* sin storage */ }
}

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
  const [d0] = useState(() => loadDraft(address));
  const [title, setTitle] = useState(d0?.title ?? '');
  const [price, setPrice] = useState(d0?.price ?? '');
  const [description, setDescription] = useState<string | null>(d0?.description ?? null); // solo si vino de Facebook
  const [fbOpen, setFbOpen] = useState(false);
  const [fbUrl, setFbUrl] = useState('');
  const [fbBusy, setFbBusy] = useState(false);
  const [fbErr, setFbErr] = useState<string | null>(null);
  const [fbNotice, setFbNotice] = useState<{ title: string; body: string; failed: boolean } | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [errors, setErrors] = useState<ListingErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [orphan, setOrphan] = useState(false);
  const [waitWallet, setWaitWallet] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  // Acuerdo de entrega: envío 7 días por defecto; cara a cara 24 h.
  const [mode, setMode] = useState<DeliveryMode>('envio');
  const [windowMin, setWindowMin] = useState<number>(DEFAULT_PROTECTION_MIN.envio);
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
  useEffect(() => { saveDraft({ owner: address, title, price, description }); }, [address, title, price, description]);
  const clearErr = (k: keyof ListingErrors) => setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e));

  const setPhoto = useCallback((key: string, patch: Partial<Photo>) =>
    setPhotos((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p))), []);
  async function pickPhotos() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: MAX_PHOTOS - photos.length, quality: 1 });
    if (res.canceled) return;
    const added: Photo[] = res.assets.slice(0, MAX_PHOTOS - photos.length).map((a) => ({
      key: `p${++photoSeq}`, uri: a.uri, mime: a.mimeType ?? 'image/jpeg', width: a.width, height: a.height, status: 'processing',
    }));
    setPhotos((p) => [...p, ...added].slice(0, MAX_PHOTOS)); clearErr('photos');
    for (const ph of added) { // comprimir en el dispositivo apenas se eligen
      try { setPhoto(ph.key, { status: 'ready', blob: await compressPhoto(ph) }); }
      catch { setPhoto(ph.key, { status: 'ready' }); }
    }
  }
  /** Foto importada (data URL) -> misma compresión que una foto del teléfono; se sube al generar el link. */
  async function addImportedPhoto(src: string) {
    const blob = await importedPhotoBlob(src);
    const uri = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : src;
    const dims = await new Promise<{ width?: number; height?: number }>((res) => Image.getSize(uri, (width, height) => res({ width, height }), () => res({})));
    const ph: Photo = { key: `p${++photoSeq}`, uri, mime: blob.type || 'image/jpeg', ...dims, status: 'processing' };
    setPhotos((p) => (p.length >= MAX_PHOTOS ? p : [...p, ph])); clearErr('photos');
    try { setPhoto(ph.key, { status: 'ready', blob: await compressPhoto(ph) }); } catch { setPhoto(ph.key, { status: 'ready' }); }
  }

  async function runImport() {
    const chk = checkFacebookUrl(fbUrl);
    if (!chk.ok) { setFbErr(chk.error); haptic.error(); return; }
    setFbErr(null); setFbBusy(true);
    let r: FbImport | null = null;
    try { r = await importFromFacebook(freshAuth(auth), chk.url); }
    catch (e: any) {
      track('facebook_import', fbImportProps(null, e?.code));
      // Sesión vencida o demasiados intentos: se avisa en la hoja. Cualquier otra falla: completar a mano.
      if (e?.status === 401 || e?.status === 429 || e?.code === 'fb_url_invalid') { setFbErr(userMessage((e as Error).message)); setFbBusy(false); haptic.error(); return; }
    }
    const res: FbImport = r ?? { result: 'failed', title: null, price_crc: null, price_source: null, converted: false, description: null, photos: [], missing: ['title', 'price', 'photos'] };
    if (res.title) { setTitle(res.title.slice(0, TITLE_MAX)); clearErr('title'); }
    if (res.price_crc && !invite) { setPrice(String(res.price_crc)); clearErr('price'); }
    setDescription(res.description ? res.description.slice(0, 2000) : null);
    if (r) track('facebook_import', fbImportProps(res));
    setFbNotice({ ...fbImportNotice(res), failed: res.result === 'failed' });
    setFbBusy(false); setFbOpen(false); setFbUrl('');
    res.result === 'failed' ? haptic.error() : haptic.success();
    for (const src of res.photos.slice(0, Math.max(0, MAX_PHOTOS - photos.length))) { try { await addImportedPhoto(src); } catch { /* foto mala: el vendedor agrega la suya */ } }
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
      const draftId = newDraftId();
      const urls: string[] = [];
      for (const [i, p] of photos.entries()) {
        if (p.url) { urls.push(p.url); continue; }
        setPhoto(p.key, { status: 'uploading' });
        try { urls.push(p.blob ? await uploadCompressed(a, p.blob, draftId, i) : await uploadPhoto(a, p, draftId, i)); setPhoto(p.key, { status: 'done' }); }
        catch (e) { setPhoto(p.key, { status: 'error' }); track('photo_upload_failed', { context: 'listing', index: i, precompressed: !!p.blob, ...photoFailureProps(e) }); throw e; }
      }
      const t = title.trim();
      const slug = await createOrder(a, { title: t, price_crc: priceNum, photos: urls, delivery_mode: mode, protection_minutes: windowMin, ...(description ? { description } : {}), ...(invite ? { invite: invite.code } : {}) });
      track('link_created', { category: 'otro', photos: urls.length, price_bucket: priceBucket(priceNum), from_invite: !!invite, from_facebook: !!fbNotice && !fbNotice.failed, delivery_mode: mode, protection_minutes: windowMin });
      haptic.success();
      setCreated({ slug, title: t, price: priceNum, photo: photos[0]?.uri ?? null, agreement: agreementSummary(mode, windowMin) });
      setMode('envio'); setWindowMin(DEFAULT_PROTECTION_MIN.envio); setCustomOpen(false); setCustomDays('');
      setTitle(''); setPrice(''); setPhotos([]); setInvite(null); setDescription(null); setFbNotice(null); saveDraft(null);
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
        <Reveal i={3}><Text style={[T.footnote, { textAlign: 'center' }]}>El comprador paga sin crear cuenta; tú cobras al entregar.</Text></Reveal>
      </View>
    </Screen>
  );

  return (
    <Screen footerBare title="Vender" subtitle={short ? undefined : 'Nombre, precio y fotos. Nada más.'} right={right} scroll={false}
      footer={<PrimaryButton title="Generar link" icon="link" loading={busy} disabled={photosBusy} onPress={() => submit()} />}>
      <View style={{ flex: 1, gap: short ? S.sm + 4 : S.md }}>
      {orphan ? <OrphanWalletCard compact={short} onRestored={(r) => { setOrphan(false); if (title.trim() && photos.length) submit(r); }} /> : null}
      {invite && <Card style={{ gap: 2, padding: S.sm + 4 }}><Text style={T.headline} numberOfLines={1}>Respondes a una invitación</Text><Text style={T.footnote} numberOfLines={2}>Te piden {`${invite.brand} ${invite.model}`.trim()} por {formatCRC(invite.price_crc)}. El link queda reservado para quien te invitó.</Text></Card>}

      {invite ? null : fbNotice ? (
        <Card style={[s.fbNotice, fbNotice.failed && { borderColor: C.orange }]}>
          <View style={[s.fbIcon, fbNotice.failed && { backgroundColor: C.warnBg }]}><Icon name={fbNotice.failed ? 'alert-circle' : 'logo-facebook'} size={20} color={fbNotice.failed ? C.orange : C.lilac} /></View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={[T.headline, { fontSize: 15 }]} numberOfLines={2}>{fbNotice.title}</Text>
            <Text style={T.footnote} numberOfLines={2}>{fbNotice.body}</Text>
            {description ? <Pressable onPress={() => { haptic.tap(); setDescription(null); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Quitar descripción">
              <Text style={[T.footnote, { color: C.lilac }]} numberOfLines={1}>Incluye la descripción del anuncio · Quitar</Text>
            </Pressable> : null}
          </View>
          <Pressable onPress={() => { haptic.tap(); setFbNotice(null); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cerrar aviso" style={s.fbClose}><Icon name="close" size={18} color={C.textDim} /></Pressable>
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

      <View style={{ gap: S.xs }}>
        <Text style={T.caption}>Nombre del producto</Text>
        <TextInput style={[ui.input, s.input, errors.title && s.inputErr]} placeholder="Ej. iPhone 13 de 128 GB" placeholderTextColor={C.textDim}
          value={title} onChangeText={(v) => { setTitle(v); clearErr('title'); }} maxLength={TITLE_MAX} returnKeyType="next" accessibilityLabel="Nombre del producto" />
        {errors.title ? <ErrorText>{errors.title}</ErrorText> : null}
      </View>

      <View style={{ gap: S.xs }}>
        <Text style={T.caption}>Precio en colones</Text>
        <View style={[s.priceWrap, errors.price && s.inputErr, invite && { opacity: 0.7 }]}>
          <Text style={s.currency}>₡</Text>
          <TextInput style={s.priceInput} placeholder="0" placeholderTextColor={C.textDim} keyboardType="number-pad" inputMode="numeric"
            value={formatPriceInput(price)} onChangeText={(v) => { setPrice(v); clearErr('price'); }} editable={!invite} accessibilityLabel="Precio en colones" />
        </View>
        {errors.price ? <ErrorText>{errors.price}</ErrorText> : null}
      </View>

      <View style={{ gap: S.xs }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={T.caption}>Fotos ({photos.length}/{MAX_PHOTOS})</Text>
          {photos.length > 0 && !errors.photos ? <Text style={T.footnote}>Toca una para quitarla</Text> : null}
        </View>
        <View style={s.grid}>
          {photos.map((p, i) => <PhotoTile key={p.key} photo={p} index={i} total={photos.length} onRemove={busy ? undefined : removePhoto} />)}
          {photos.length < MAX_PHOTOS && (
            <Pressable onPress={pickPhotos} accessibilityRole="button" accessibilityLabel="Agregar fotos" style={({ pressed }) => [s.photo, s.photoAdd, errors.photos && { borderColor: C.orange }, pressed && { opacity: 0.8 }]}>
              <Icon name="camera" size={24} color={C.lilac} />
              <Text style={[T.footnote, { color: C.lilac }]}>Agregar</Text>
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
      {short ? null : <Text style={T.footnote}>De 1 a 4 fotos con buena luz.</Text>}
      <RulesHint text={SELL_SUMMARY} from="sell" compact={short} /* iPhone SE: solo "Ver reglas" para dejar espacio al aviso de beta */ />
      <BetaNotice from="sell" />
      </View>

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

      <Sheet visible={fbOpen} onClose={() => { if (!fbBusy) setFbOpen(false); }} title="Importar de Facebook"
        footer={<PrimaryButton title={fbBusy ? 'Leyendo el anuncio…' : 'Importar'} icon="download-outline" loading={fbBusy} disabled={!fbUrl.trim()} onPress={runImport} />}>
        <Text style={T.callout}>En Facebook abre tu anuncio, toca Compartir y luego Copiar link. Pégalo aquí: llenamos el nombre, el precio y la foto para que solo revises.</Text>
        <TextInput style={[ui.input, fbErr && s.inputErr]} placeholder="facebook.com/marketplace/item/…" placeholderTextColor={C.textDim} value={fbUrl}
          onChangeText={(v) => { setFbUrl(v); if (fbErr) setFbErr(null); }} autoCapitalize="none" autoCorrect={false} keyboardType="url" inputMode="url"
          returnKeyType="go" onSubmitEditing={runImport} editable={!fbBusy} autoFocus accessibilityLabel="Link del anuncio de Facebook" />
        {fbErr ? <ErrorText>{fbErr}</ErrorText> : <Text style={T.footnote}>Solo anuncios públicos. El link de Facebook no se guarda en tu producto.</Text>}
      </Sheet>
    </Screen>
  );
}

/** Foto con su propio estado. Memo: no se re-renderiza al teclear. */
const PhotoTile = memo(function PhotoTile({ photo, index, total, onRemove }: { photo: Photo; index: number; total: number; onRemove?: (key: string) => void }) {
  const [loaded, setLoaded] = useState(false);
  const busy = photo.status === 'processing' || photo.status === 'uploading' || !loaded;
  return (
    <Pressable style={s.photo} accessibilityLabel="Quitar foto" disabled={!onRemove || photo.status === 'uploading'} onPress={() => onRemove?.(photo.key)}>
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
  priceWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: R.md, paddingHorizontal: S.md, minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  currency: { fontFamily: Fonts.black, fontSize: 22, color: C.textDim, marginRight: S.xs },
  priceInput: { flex: 1, minWidth: 0, fontFamily: Fonts.black, fontSize: 22, color: C.text, paddingVertical: 6, fontVariant: ['tabular-nums'], outlineStyle: 'none' } as object,
  inputErr: { borderColor: C.orange, borderWidth: 1 },
  fbBtn: { flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: 44, paddingHorizontal: S.md, borderRadius: R.md, borderWidth: 1, borderColor: C.lilac, backgroundColor: C.lilacBg },
  fbNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: S.sm, padding: S.sm + 2, borderWidth: 1, borderColor: C.lilac },
  fbIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' },
  fbClose: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  agreeRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: 44, paddingHorizontal: S.md, borderRadius: R.md, backgroundColor: C.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  choice: { flex: 1, flexDirection: 'row', gap: S.xs + 2, alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: R.md, borderWidth: 1, borderColor: C.lilac },
  chip: { flex: 1, minHeight: 44, borderRadius: R.md, borderWidth: 1, borderColor: C.lilac, alignItems: 'center', justifyContent: 'center' },
  choiceOn: { backgroundColor: C.lilac, borderColor: C.lilac },
  thumb: { width: 56, height: 56, borderRadius: R.md, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' },
});
