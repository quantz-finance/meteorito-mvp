import { ensureWalletReady, walletErrorNotice } from '@/lib/wallet';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { ui } from '@/components/ui';
import { Card, ErrorText, haptic, Icon, IconButton, PrimaryButton, Screen } from '@/components/ds';
import { categoryIcon } from '@/components/categoryIcons';
import { Fonts } from '@/constants/Colors';
import { C, R, S, T, TOUCH } from '@/constants/theme';
import { CATEGORIES, CONDITIONS, checksSummary, getCategory, validateIdentifier } from '@/lib/categories';
import { useAuth } from '@/lib/cavos';
import { createOrder, formatCRC } from '@/lib/orders';
import { compressPhoto, MAX_PHOTOS, newDraftId, uploadCompressed, uploadPhoto } from '@/lib/photos';
import { supabaseConfigured } from '@/lib/supabase';
import { priceBucket, track, trackError } from '@/lib/analytics';

type PhotoStatus = 'processing' | 'ready' | 'uploading' | 'done' | 'error';
interface Photo { key: string; uri: string; mime: string; width?: number; height?: number; status: PhotoStatus; blob?: Blob }

/** Un paso = una pregunta. 'checks' solo aparece si la categoría tiene revisión. */
type StepKey = 'categoria' | 'fotos' | 'modelo' | 'estado' | 'identificador' | 'checks' | 'descripcion' | 'precio' | 'revisar';
const STEP_LABEL: Record<StepKey, string> = {
  categoria: 'Categoría', fotos: 'Fotos', modelo: 'Marca y modelo', estado: 'Estado', identificador: 'Identificador',
  checks: 'Revisión', descripcion: 'Descripción', precio: 'Precio', revisar: 'Revisar',
};
let photoSeq = 0;

const MIN_PRICE = 1000, MAX_PRICE = 50_000_000;
const PRICE_ERROR = `Ingresa un precio válido: mínimo ${formatCRC(MIN_PRICE)}, máximo ${formatCRC(MAX_PRICE)}.`;
const priceInvalid = (n: number) => !n || n < MIN_PRICE || n > MAX_PRICE;

/** Borrador de la venta: vive en memoria del módulo (sobrevive al cambiar de pestaña) y en sessionStorage en web
 *  (sobrevive a recargas, sin fotos). Se descarta al publicar o si cambia la cuenta. */
interface Draft { owner: string | null; stepIdx: number; categoryId: string; brand: string; model: string; condition: string; price: string; description: string; identifier: string; checks: Record<string, boolean>; photos: Photo[] }
const DRAFT_KEY = 'meteorito:sell-draft';
let memDraft: Draft | null = null;
function loadDraft(owner: string | null): Draft | null {
  if (!memDraft) {
    try { const raw = typeof window !== 'undefined' ? window.sessionStorage?.getItem(DRAFT_KEY) : null; if (raw) memDraft = { ...JSON.parse(raw), photos: [] }; } catch { /* sin storage */ }
  }
  if (!memDraft || (memDraft.owner && owner && memDraft.owner !== owner)) return null;
  return memDraft;
}
function saveDraft(d: Draft | null) {
  memDraft = d;
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    if (d) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, photos: [] })); else window.sessionStorage.removeItem(DRAFT_KEY);
  } catch { /* sin storage */ }
}

export default function Vender() {
  const auth = useAuth();
  const { address } = auth;
  const [d0] = useState(() => loadDraft(address));
  const [stepIdx, setStepIdx] = useState(d0 && d0.photos.length === 0 && d0.stepIdx > 1 ? 1 : d0?.stepIdx ?? 0);
  const [categoryId, setCategoryId] = useState(d0?.categoryId ?? 'celular');
  const [brand, setBrand] = useState(d0?.brand ?? '');
  const [model, setModel] = useState(d0?.model ?? '');
  const [condition, setCondition] = useState<string>(d0?.condition ?? CONDITIONS[2]);
  const [price, setPrice] = useState(d0?.price ?? '');
  const [description, setDescription] = useState(d0?.description ?? '');
  const [identifier, setIdentifier] = useState(d0?.identifier ?? '');
  const [checks, setChecks] = useState<Record<string, boolean>>(d0?.checks ?? {});
  const [photos, setPhotos] = useState<Photo[]>(d0?.photos ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cat = getCategory(categoryId)!;
  const steps = useMemo<StepKey[]>(() => (['categoria', 'fotos', 'modelo', 'estado', 'identificador',
    ...(cat.checks.length ? ['checks' as const] : []), 'descripcion', 'precio', 'revisar']), [cat]);
  const step = steps[Math.min(stepIdx, steps.length - 1)];
  const goTo = useCallback((k: StepKey) => { setError(null); setStepIdx(Math.max(0, steps.indexOf(k))); }, [steps]);
  const priceNum = Number(price.replace(/\D/g, ''));
  const idError = useMemo(() => (identifier ? validateIdentifier(cat, identifier) : null), [cat, identifier]);
  const photosBusy = photos.some((p) => p.status === 'processing');

  useEffect(() => { // persistir borrador
    saveDraft({ owner: address, stepIdx, categoryId, brand, model, condition, price, description, identifier, checks, photos });
  }, [address, stepIdx, categoryId, brand, model, condition, price, description, identifier, checks, photos]);
  useEffect(() => { // el error de "falta foto" ya no aplica una vez que hay una
    if (photos.length > 0) setError((e) => (e && /foto/i.test(e) && /al menos/i.test(e) ? null : e));
  }, [photos.length]);

  const setPhoto = useCallback((key: string, patch: Partial<Photo>) =>
    setPhotos((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p))), []);

  async function pickPhotos() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: MAX_PHOTOS - photos.length, quality: 1,
    });
    if (res.canceled) return;
    const added: Photo[] = res.assets.slice(0, MAX_PHOTOS - photos.length).map((a) => ({
      key: `p${++photoSeq}`, uri: a.uri, mime: a.mimeType ?? 'image/jpeg', width: a.width, height: a.height, status: 'processing',
    }));
    setPhotos((p) => [...p, ...added].slice(0, MAX_PHOTOS));
    // Comprimir en el dispositivo apenas se eligen (una a la vez): cada foto muestra su propio estado
    // y al publicar solo queda subir JPEGs livianos.
    for (const ph of added) {
      try { setPhoto(ph.key, { status: 'ready', blob: await compressPhoto(ph) }); }
      catch { setPhoto(ph.key, { status: 'ready' }); } // se reintenta comprimir al subir
    }
  }
  const removePhoto = useCallback((key: string) => { haptic.tap(); setPhotos((ps) => ps.filter((p) => p.key !== key)); }, []);

  async function submit() {
    setError(null);
    if (!address) return setError('Inicia sesión de nuevo');
    if (!brand.trim() || !model.trim()) return setError('Completa marca y modelo');
    if (priceInvalid(priceNum)) return setError(PRICE_ERROR);
    if (photos.length < 1) return setError('Agrega al menos una foto');
    const idErr = validateIdentifier(cat, identifier);
    if (idErr) return setError(idErr);
    if (!supabaseConfigured) return setError('Falta configurar Supabase (.env)');
    setBusy(true);
    try {
      // Primer link: activar la wallet para recibir USDC. Si falla, no se publica.
      await ensureWalletReady(auth).catch((e) => { throw new Error(walletErrorNotice(e)); });
      const draftId = newDraftId();
      const urls: string[] = [];
      for (const [i, p] of photos.entries()) {
        setPhoto(p.key, { status: 'uploading' });
        try {
          urls.push(p.blob ? await uploadCompressed(auth, p.blob, draftId, i) : await uploadPhoto(auth, p, draftId, i));
          setPhoto(p.key, { status: 'done' });
        } catch (e) {
          setPhoto(p.key, { status: 'error' });
          track('photo_upload_failed', { context: 'listing', index: i });
          throw e;
        }
      }
      const slug = await createOrder(auth, {
        category: cat.id, brand: brand.trim(), model: model.trim(),
        condition, price_crc: priceNum, description: description.trim(), identifier: identifier.trim(),
        photos: urls, checks: checksSummary(cat, checks),
      });
      setBrand(''); setModel(''); setPrice(''); setDescription(''); setIdentifier(''); setChecks({}); setPhotos([]); setStepIdx(0); saveDraft(null);
      track('link_created', { category: cat.id, photos: urls.length, price_bucket: priceBucket(priceNum) });
      router.push({ pathname: '/compartir/[slug]', params: { slug } });
    } catch (e) {
      haptic.error();
      trackError('create_listing', e);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Validación por paso (solo UX; submit() sigue validando todo). */
  function stepError(): string | null {
    if (step === 'fotos') {
      if (photos.length < 1) return 'Agrega al menos una foto';
      if (photosBusy) return 'Espera a que terminen de cargar las fotos';
    }
    if (step === 'modelo' && (!brand.trim() || !model.trim())) return 'Completa marca y modelo';
    if (step === 'identificador') return validateIdentifier(cat, identifier);
    if (step === 'checks') { const miss = cat.checks.filter((c) => c.blocksRelease && !checks[c.id]); if (miss.length) return `Activa los puntos marcados como Obligatorio para continuar (${miss.length} pendiente${miss.length === 1 ? '' : 's'}).`; }
    if (step === 'precio' && priceInvalid(priceNum)) return PRICE_ERROR;
    return null;
  }
  function next() {
    const e = stepError();
    if (e) { haptic.error(); return setError(e); }
    setError(null);
    if (stepIdx < steps.length - 1) { track('sell_step_completed', { step: stepIdx, step_name: step as any }); setStepIdx(stepIdx + 1); }
    else { track('sell_submit_tapped', { step: stepIdx }); submit(); }
  }

  const last = step === 'revisar';
  const optional = step === 'descripcion' || (step === 'identificador' && !cat.identifier.required);
  const footer = (
    <View style={{ flexDirection: 'row', gap: S.sm }}>
      {stepIdx > 0 && <View style={{ width: 52 }}><IconButton icon="chevron-back" label="Atrás" onPress={() => { setError(null); setStepIdx(stepIdx - 1); }} /></View>}
      <View style={{ flex: 1 }}>
        <PrimaryButton title={last ? 'Crear link de venta' : optional && !(step === 'descripcion' ? description : identifier).trim() ? 'Omitir' : 'Continuar'}
          icon={last ? 'link' : undefined} loading={busy} disabled={step === 'fotos' && photosBusy} onPress={next} />
      </View>
    </View>
  );

  return (
    <Screen title="Vender" subtitle={`Paso ${stepIdx + 1} de ${steps.length} · ${STEP_LABEL[step]}`} footer={footer}>
      <View style={s.progress}>{steps.map((_, i) => <View key={i} style={[s.progressSeg, i <= stepIdx && { backgroundColor: C.lilac }]} />)}</View>

      {step === 'categoria' && <>
        <Text style={T.title}>¿Qué vas a vender?</Text>
        <View style={s.grid}>
          {CATEGORIES.map((c) => {
            const on = c.id === categoryId;
            return (
              <Pressable key={c.id} accessibilityRole="button" accessibilityState={{ selected: on }}
                onPress={() => { haptic.tap(); if (c.id !== categoryId) { setCategoryId(c.id); setChecks({}); setIdentifier(''); } }}
                style={({ pressed }) => [s.tile, on && s.tileOn, pressed && { opacity: 0.85 }]}>
                <Icon name={categoryIcon(c.id)} size={28} color={on ? C.purpleDark : C.lilac} />
                <Text style={[T.headline, on && { color: C.purpleDark }]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </>}

      {step === 'fotos' && <>
        <Text style={T.title}>Agrega fotos 📸</Text>
        <Text style={T.callout}>De 1 a 4 fotos claras, con buena luz. Toca una para quitarla.</Text>
        <View style={s.grid}>
          {photos.map((p) => <PhotoTile key={p.key} photo={p} index={photos.indexOf(p)} total={photos.length} onRemove={busy ? undefined : removePhoto} />)}
          {photos.length < MAX_PHOTOS && (
            <Pressable onPress={pickPhotos} accessibilityRole="button" style={({ pressed }) => [s.photo, s.photoAdd, pressed && { opacity: 0.8 }]}>
              <Icon name="camera" size={28} color={C.lilac} />
              <Text style={[T.footnote, { color: C.lilac }]}>Agregar ({photos.length}/{MAX_PHOTOS})</Text>
            </Pressable>
          )}
        </View>
      </>}

      {step === 'modelo' && <>
        <Text style={T.title}>¿Qué {cat.label.toLowerCase()} es?</Text>
        <Field label="Marca"><TextInput style={ui.input} placeholder="Ej. Apple, Sony, Lenovo" placeholderTextColor={C.textDim} value={brand} onChangeText={setBrand} autoFocus returnKeyType="next" /></Field>
        <Field label="Modelo"><TextInput style={ui.input} placeholder="Ej. iPhone 13 128 GB" placeholderTextColor={C.textDim} value={model} onChangeText={setModel} returnKeyType="next" onSubmitEditing={next} /></Field>
      </>}

      {step === 'estado' && <>
        <Text style={T.title}>¿Cómo está?</Text>
        <View style={{ gap: S.sm }}>
          {CONDITIONS.map((c) => {
            const on = c === condition;
            return (
              <Pressable key={c} accessibilityRole="radio" accessibilityState={{ selected: on }}
                onPress={() => { haptic.tap(); setCondition(c); }} style={[s.option, on && s.optionOn]}>
                <Text style={[T.headline, on && { color: C.purpleDark }]}>{c}</Text>
                <Icon name={on ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={on ? C.purpleDark : C.textDim} />
              </Pressable>
            );
          })}
        </View>
      </>}

      {step === 'identificador' && <>
        <Text style={T.title}>{cat.identifier.label}</Text>
        <Text style={T.callout}>{cat.identifier.kind === 'imei'
          ? 'Lo encuentras en Ajustes › General › Información. Es opcional, lo declaras tú y Meteorito no lo verifica. Puedes dejarlo vacío.'
          : cat.identifier.required ? 'Se le muestra al comprador como dato que declaras tú; Meteorito no lo verifica.' : 'Puedes dejarlo vacío.'}</Text>
        <TextInput style={ui.input} placeholder={cat.identifier.kind === 'imei' ? '15 dígitos' : cat.identifier.label} placeholderTextColor={C.textDim}
          autoCapitalize="characters" autoFocus
          keyboardType={cat.identifier.kind === 'imei' ? 'number-pad' : 'default'} inputMode={cat.identifier.kind === 'imei' ? 'numeric' : 'text'}
          maxLength={cat.identifier.kind === 'imei' ? 15 : 30} value={identifier}
          onChangeText={(v) => setIdentifier(cat.identifier.kind === 'imei' ? v.replace(/\D/g, '') : v)} />
        {idError && <Text style={ui.error}>{idError}</Text>}
        <Text style={T.footnote}>Nunca se muestra completo: el comprador solo ve los últimos 4.</Text>
      </>}

      {step === 'checks' && <>
        <Text style={T.title}>Revisión antes de vender</Text>
        <Card>
          {cat.checks.map((c) => {
            const toggle = (v: boolean) => { haptic.tap(); setChecks((x) => ({ ...x, [c.id]: v })); setError(null); };
            return (
              <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, minHeight: TOUCH }}>
                <Pressable style={{ flex: 1, minHeight: TOUCH, justifyContent: 'center' }} accessibilityRole="switch" accessibilityState={{ checked: !!checks[c.id] }}
                  onPress={() => toggle(!checks[c.id])}>
                  <Text style={T.body}>{c.label}</Text>
                  {c.blocksRelease && <Text style={[T.footnote, { color: C.orange }]}>Obligatorio</Text>}
                </Pressable>
                <Switch value={!!checks[c.id]} onValueChange={toggle} accessibilityLabel={c.label} trackColor={{ true: C.success, false: C.surface2 }} />
              </View>
            );
          })}
          <Text style={T.footnote}>Los puntos marcados como Obligatorio deben estar activados para publicar: son condición para liberar el pago.</Text>
        </Card>
      </>}

      {step === 'descripcion' && <>
        <Text style={T.title}>¿Algo más que contar?</Text>
        <Text style={T.callout}>Opcional: batería, detalles, qué incluye.</Text>
        <TextInput style={[ui.input, { minHeight: 96, paddingTop: S.sm + 4, textAlignVertical: 'top' }]} multiline placeholder="Batería al 89 %, incluye cargador…"
          placeholderTextColor={C.textDim} value={description} onChangeText={setDescription} />
      </>}

      {step === 'precio' && <>
        <Text style={T.title}>¿En cuánto lo vendes?</Text>
        <Card style={{ paddingVertical: S.lg, alignItems: 'center' }}>
          <TextInput style={s.priceInput} placeholder="₡0" placeholderTextColor={C.textDim} keyboardType="number-pad" autoFocus
            value={priceNum ? formatCRC(priceNum) : ''} onChangeText={setPrice} accessibilityLabel="Precio en colones" />
          <Text style={T.footnote}>Precio en colones</Text>
        </Card>
        <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start' }}>
          <Icon name="shield-checkmark" size={20} color={C.success} />
          <Text style={[T.callout, { flex: 1 }]}>Recibes el monto completo. El comprador paga protegido y tú cobras al entregar.</Text>
        </View>
      </>}

      {step === 'revisar' && <>
        <Text style={T.title}>Revisa y publica</Text>
        <Card style={{ gap: S.md }}>
          <View style={{ flexDirection: 'row', gap: S.md, alignItems: 'center' }}>
            {photos[0] ? <Image source={{ uri: photos[0].uri }} style={{ width: 56, height: 56, borderRadius: R.md }} />
              : <View style={[s.thumb]}><Icon name={categoryIcon(cat.id)} size={28} color={C.lilac} /></View>}
            <View style={{ flex: 1 }}>
              <Text style={T.headline}>{brand} {model}</Text>
              <Text style={T.footnote}>{cat.label} · {condition} · {photos.length} foto{photos.length === 1 ? '' : 's'}</Text>
            </View>
          </View>
          <Text style={T.money}>{formatCRC(priceNum)}</Text>
          {cat.checks.map((c) => (
            <View key={c.id} style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center' }}>
              <Icon name={checks[c.id] ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={checks[c.id] ? C.success : C.orange} />
              <Text style={[T.callout, { flex: 1 }]}>{c.label}</Text>
            </View>
          ))}
        </Card>
        {([['Categoría', 'categoria'], ['Fotos', 'fotos'], ['Marca y modelo', 'modelo'], ['Estado', 'estado'], ['Precio', 'precio']] as const).map(([l, k]) => (
          <Pressable key={l} onPress={() => goTo(k)} style={s.editRow}>
            <Text style={T.body}>Editar {l.toLowerCase()}</Text><Icon name="chevron-forward" size={18} color={C.textDim} />
          </Pressable>
        ))}
      </>}

      {error && <ErrorText>{error}</ErrorText>}
    </Screen>
  );
}

const PHOTO_TEXT: Record<PhotoStatus, string> = { processing: 'Optimizando…', ready: '', uploading: 'Subiendo…', done: '', error: 'No se subió' };

/** Foto con su propio estado: placeholder + spinner mientras carga/optimiza/sube. Memo: no se re-renderiza al teclear. */
const PhotoTile = memo(function PhotoTile({ photo, index, total, onRemove }: { photo: Photo; index: number; total: number; onRemove?: (key: string) => void }) {
  const [loaded, setLoaded] = useState(false);
  const busy = photo.status === 'processing' || photo.status === 'uploading' || !loaded;
  return (
    <Pressable style={s.photo} accessibilityLabel="Quitar foto" disabled={!onRemove || photo.status === 'uploading'} onPress={() => onRemove?.(photo.key)}>
      <Image source={{ uri: photo.uri }} style={StyleSheet.absoluteFill} onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} />
      {busy || photo.status === 'error' ? (
        <View style={s.photoOverlay}>
          {photo.status === 'error' ? <Icon name="alert-circle" size={26} color={C.orange} /> : <ActivityIndicator color={C.white} />}
          <Text style={[T.footnote, { color: C.white }]}>
            {photo.status === 'uploading' ? `Subiendo ${index + 1}/${total}…` : PHOTO_TEXT[photo.status] || 'Cargando…'}
          </Text>
        </View>
      ) : photo.status === 'done' ? (
        <View style={s.photoX}><Icon name="checkmark" size={16} color={C.success} /></View>
      ) : onRemove ? <View style={s.photoX}><Icon name="close" size={16} color={C.white} /></View> : null}
    </Pressable>
  );
});

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <View style={{ gap: S.sm }}><Text style={T.caption}>{label}</Text>{children}{hint ? <Text style={T.footnote}>{hint}</Text> : null}</View>;
}

const s = StyleSheet.create({
  progress: { flexDirection: 'row', gap: S.xs },
  progressSeg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: C.surface2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  tile: { flexBasis: '30%', flexGrow: 1, aspectRatio: 1, maxHeight: 112, backgroundColor: C.surface, borderRadius: R.lg, alignItems: 'center', justifyContent: 'center', gap: S.sm, borderWidth: 1, borderColor: C.line },
  tileOn: { backgroundColor: C.lilac, borderColor: C.lilac },
  photo: { flexBasis: '47%', flexGrow: 1, aspectRatio: 1, borderRadius: R.lg, overflow: 'hidden', backgroundColor: C.surface },
  photoAdd: { alignItems: 'center', justifyContent: 'center', gap: S.sm, borderWidth: 2, borderStyle: 'dashed', borderColor: C.lilac, backgroundColor: 'transparent' },
  photoX: { position: 'absolute', top: S.sm, right: S.sm, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  priceInput: { fontFamily: Fonts.black, fontSize: 38, color: C.text, textAlign: 'center', minWidth: 200, fontVariant: ['tabular-nums'], outlineStyle: 'none' } as object,
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52, paddingHorizontal: S.md, borderRadius: R.md, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  optionOn: { backgroundColor: C.lilac, borderColor: C.lilac },
  photoOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(26,11,61,0.6)', alignItems: 'center', justifyContent: 'center', gap: S.xs },
  thumb: { width: 64, height: 64, borderRadius: R.md, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' },
  editRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: TOUCH, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
});
