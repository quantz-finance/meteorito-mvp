// Vender: el link en UNA sola pantalla. Nombre del producto, precio en colones y fotos -> "Generar link".
// El link aparece aquí mismo con Copiar y Compartir. Categoría, marca, modelo, estado e identificador ya no se piden.
import { ensureWalletReady, freshAuth, needsDeviceStep, walletErrorNotice, WALLET_LOADING } from '@/lib/wallet';
import type { MeteoritoAuth } from '@/lib/types';
import { OrphanWalletCard } from '@/components/OrphanWallet';
import { userMessage } from '@/lib/cavosSession';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useStableWindow } from '@/lib/viewport';
import { ui } from '@/components/ui';
import { Card, ErrorText, haptic, Icon, IconButton, PrimaryButton, Screen, SuccessCheck } from '@/components/ds';
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

type PhotoStatus = 'processing' | 'ready' | 'uploading' | 'done' | 'error';
interface Photo { key: string; uri: string; mime: string; width?: number; height?: number; status: PhotoStatus; blob?: Blob }
interface Created { slug: string; title: string; price: number; photo: string | null }
let photoSeq = 0;

/** Borrador (solo texto): sobrevive al cambiar de pestaña y a recargas en web. Se descarta al generar el link. */
interface Draft { owner: string | null; title: string; price: string }
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

export default function Vender() {
  const auth = useAuth();
  const { address } = auth;
  const [d0] = useState(() => loadDraft(address));
  const [title, setTitle] = useState(d0?.title ?? '');
  const [price, setPrice] = useState(d0?.price ?? '');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [errors, setErrors] = useState<ListingErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [orphan, setOrphan] = useState(false);
  const [waitWallet, setWaitWallet] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
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
  useEffect(() => { saveDraft({ owner: address, title, price }); }, [address, title, price]);
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
        setPhoto(p.key, { status: 'uploading' });
        try { urls.push(p.blob ? await uploadCompressed(a, p.blob, draftId, i) : await uploadPhoto(a, p, draftId, i)); setPhoto(p.key, { status: 'done' }); }
        catch (e) { setPhoto(p.key, { status: 'error' }); track('photo_upload_failed', { context: 'listing', index: i }); throw e; }
      }
      const t = title.trim();
      const slug = await createOrder(a, { title: t, price_crc: priceNum, photos: urls, ...(invite ? { invite: invite.code } : {}) });
      track('link_created', { category: 'otro', photos: urls.length, price_bucket: priceBucket(priceNum), from_invite: !!invite });
      haptic.success();
      setCreated({ slug, title: t, price: priceNum, photo: photos[0]?.uri ?? null });
      setTitle(''); setPrice(''); setPhotos([]); setInvite(null); saveDraft(null);
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
    <Screen title="Vender" right={right} scroll={false}
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
          </View>
        </Card></Reveal>
        <Reveal i={2}><ShareLink kind="order" link={orderLink(created.slug)} message={`${created.title} por ${formatCRC(created.price)}. Paga aquí con Meteorito:`} /></Reveal>
        <Reveal i={3}><Text style={[T.footnote, { textAlign: 'center' }]}>El comprador paga sin crear cuenta; tú cobras al entregar.</Text></Reveal>
      </View>
    </Screen>
  );

  return (
    <Screen title="Vender" subtitle={short ? undefined : 'Nombre, precio y fotos. Nada más.'} right={right} scroll={false}
      footer={<PrimaryButton title="Generar link" icon="link" loading={busy} disabled={photosBusy} onPress={() => submit()} />}>
      <View style={{ flex: 1, gap: short ? S.sm + 4 : S.md }}>
      {orphan ? <OrphanWalletCard compact={short} onRestored={(r) => { setOrphan(false); if (title.trim() && photos.length) submit(r); }} /> : null}
      {invite && <Card style={{ gap: 2, padding: S.sm + 4 }}><Text style={T.headline} numberOfLines={1}>Respondes a una invitación</Text><Text style={T.footnote} numberOfLines={2}>Te piden {`${invite.brand} ${invite.model}`.trim()} por {formatCRC(invite.price_crc)}. El link queda reservado para quien te invitó.</Text></Card>}

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

      {error && <ErrorText>{error}</ErrorText>}
      <Text style={T.footnote}>De 1 a 4 fotos con buena luz.</Text>
      </View>
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
  thumb: { width: 56, height: 56, borderRadius: R.md, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' },
});
