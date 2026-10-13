import { ensureWalletReady, walletErrorNotice } from '@/lib/wallet';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { ui } from '@/components/ui';
import { Card, ErrorText, haptic, Icon, IconButton, PrimaryButton, Screen } from '@/components/ds';
import { categoryIcon } from '@/components/categoryIcons';
import { Fonts } from '@/constants/Colors';
import { C, R, S, T, TOUCH } from '@/constants/theme';
import { CATEGORIES, CONDITIONS, checksSummary, getCategory, validateIdentifier } from '@/lib/categories';
import { useAuth } from '@/lib/cavos';
import { createOrder, formatCRC } from '@/lib/orders';
import { MAX_PHOTOS, newDraftId, uploadPhoto } from '@/lib/photos';
import { supabaseConfigured } from '@/lib/supabase';
import { priceBucket, track, trackError } from '@/lib/analytics';

interface Photo { uri: string; mime: string; width?: number; height?: number }
const STEPS = ['Categoría', 'Fotos', 'Detalles', 'Precio', 'Revisar'] as const;

export default function Vender() {
  const auth = useAuth();
  const { address } = auth;
  const [step, setStep] = useState(0);
  const [categoryId, setCategoryId] = useState('celular');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [condition, setCondition] = useState<string>(CONDITIONS[2]);
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cat = getCategory(categoryId)!;
  const priceNum = Number(price.replace(/\D/g, ''));
  const idError = useMemo(() => (identifier ? validateIdentifier(cat, identifier) : null), [cat, identifier]);

  async function pickPhotos() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: MAX_PHOTOS - photos.length, quality: 1,
    });
    if (res.canceled) return;
    const added = res.assets.map((a) => ({ uri: a.uri, mime: a.mimeType ?? 'image/jpeg', width: a.width, height: a.height }));
    setPhotos((p) => [...p, ...added].slice(0, MAX_PHOTOS));
  }

  async function submit() {
    setError(null);
    if (!address) return setError('Iniciá sesión de nuevo');
    if (!brand.trim() || !model.trim()) return setError('Completá marca y modelo');
    if (!priceNum || priceNum < 1000) return setError('Poné un precio válido en colones');
    if (photos.length < 1) return setError('Agregá al menos una foto');
    const idErr = validateIdentifier(cat, identifier);
    if (idErr) return setError(idErr);
    if (!supabaseConfigured) return setError('Falta configurar Supabase (.env)');
    setBusy(true);
    try {
      // Primer link: activar la wallet para recibir USDC. Si falla, no se publica.
      await ensureWalletReady(auth).catch((e) => { throw new Error(walletErrorNotice(e)); });
      const draftId = newDraftId();
      const urls: string[] = [];
      for (const [i, p] of photos.entries()) urls.push(await uploadPhoto(auth, p, draftId, i).catch((e) => { track('photo_upload_failed', { context: 'listing', index: i }); throw e; }));
      const slug = await createOrder(auth, {
        category: cat.id, brand: brand.trim(), model: model.trim(),
        condition, price_crc: priceNum, description: description.trim(), identifier: identifier.trim(),
        photos: urls, checks: checksSummary(cat, checks),
      });
      setBrand(''); setModel(''); setPrice(''); setDescription(''); setIdentifier(''); setChecks({}); setPhotos([]); setStep(0);
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
    if (step === 1 && photos.length < 1) return 'Agregá al menos una foto';
    if (step === 2) {
      if (!brand.trim() || !model.trim()) return 'Completá marca y modelo';
      const e = validateIdentifier(cat, identifier); if (e) return e;
    }
    if (step === 3 && (!priceNum || priceNum < 1000)) return 'Poné un precio válido en colones';
    return null;
  }
  function next() {
    const e = stepError();
    if (e) { haptic.error(); return setError(e); }
    setError(null);
    if (step < STEPS.length - 1) { track('sell_step_completed', { step, step_name: STEPS[step] as any }); setStep(step + 1); } else { track('sell_submit_tapped', { step }); submit(); }
  }

  const footer = (
    <View style={{ flexDirection: 'row', gap: S.sm }}>
      {step > 0 && <View style={{ width: 56 }}><IconButton icon="chevron-back" label="Atrás" onPress={() => { setError(null); setStep(step - 1); }} /></View>}
      <View style={{ flex: 1 }}>
        <PrimaryButton title={step === STEPS.length - 1 ? 'Crear link de venta' : 'Continuar'} icon={step === STEPS.length - 1 ? 'link' : undefined}
          loading={busy} onPress={next} />
      </View>
    </View>
  );

  return (
    <Screen title="Vender" subtitle={`Paso ${step + 1} de ${STEPS.length} · ${STEPS[step]}`} footer={footer}>
      <View style={s.progress}>{STEPS.map((_, i) => <View key={i} style={[s.progressSeg, i <= step && { backgroundColor: C.lilac }]} />)}</View>

      {step === 0 && <>
        <Text style={T.title}>¿Qué vas a vender?</Text>
        <View style={s.grid}>
          {CATEGORIES.map((c) => {
            const on = c.id === categoryId;
            return (
              <Pressable key={c.id} accessibilityRole="button" accessibilityState={{ selected: on }}
                onPress={() => { haptic.tap(); if (c.id !== categoryId) { setCategoryId(c.id); setChecks({}); } }}
                style={({ pressed }) => [s.tile, on && s.tileOn, pressed && { opacity: 0.85 }]}>
                <Icon name={categoryIcon(c.id)} size={32} color={on ? C.purpleDark : C.lilac} />
                <Text style={[T.headline, on && { color: C.purpleDark }]}>{c.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </>}

      {step === 1 && <>
        <Text style={T.title}>Agregá fotos</Text>
        <Text style={T.callout}>De 1 a 4 fotos claras, con buena luz. Tocá una para quitarla.</Text>
        <View style={s.grid}>
          {photos.map((p, i) => (
            <Pressable key={p.uri} style={s.photo} accessibilityLabel="Quitar foto" onPress={() => { haptic.tap(); setPhotos((ps) => ps.filter((_, j) => j !== i)); }}>
              <Image source={{ uri: p.uri }} style={StyleSheet.absoluteFill} />
              <View style={s.photoX}><Icon name="close" size={16} color={C.white} /></View>
            </Pressable>
          ))}
          {photos.length < 4 && (
            <Pressable onPress={pickPhotos} accessibilityRole="button" style={({ pressed }) => [s.photo, s.photoAdd, pressed && { opacity: 0.8 }]}>
              <Icon name="camera" size={32} color={C.lilac} />
              <Text style={[T.footnote, { color: C.lilac }]}>Agregar ({photos.length}/4)</Text>
            </Pressable>
          )}
        </View>
      </>}

      {step === 2 && <>
        <Text style={T.title}>Detalles del {cat.label.toLowerCase()}</Text>
        <Field label="Marca"><TextInput style={ui.input} placeholder="Ej. Apple, Sony, Lenovo" placeholderTextColor={C.textDim} value={brand} onChangeText={setBrand} /></Field>
        <Field label="Modelo"><TextInput style={ui.input} placeholder="Ej. iPhone 13 128 GB" placeholderTextColor={C.textDim} value={model} onChangeText={setModel} /></Field>
        <Field label="Estado">
          <View style={ui.row}>
            {CONDITIONS.map((c) => (
              <Pressable key={c} onPress={() => { haptic.tap(); setCondition(c); }} style={[ui.chip, c === condition && ui.chipOn]}>
                <Text style={[ui.chipText, c === condition && { color: C.purpleDark }]}>{c}</Text>
              </Pressable>
            ))}
          </View>
        </Field>
        <Field label={cat.identifier.label} hint="Nunca se muestra completo: el comprador solo ve los últimos 4.">
          <TextInput style={ui.input} placeholder={cat.identifier.label} placeholderTextColor={C.textDim} autoCapitalize="characters"
            keyboardType={cat.identifier.kind === 'imei' ? 'number-pad' : 'default'} value={identifier} onChangeText={setIdentifier} />
          {idError && <Text style={ui.error}>{idError}</Text>}
        </Field>
        {cat.checks.length > 0 && (
          <Card>
            <Text style={T.caption}>Revisión antes de vender</Text>
            {cat.checks.map((c) => (
              <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, minHeight: TOUCH }}>
                <Text style={[T.body, { flex: 1 }]}>{c.label}{c.blocksRelease ? ' *' : ''}</Text>
                <Switch value={!!checks[c.id]} onValueChange={(v) => { haptic.tap(); setChecks((x) => ({ ...x, [c.id]: v })); }} trackColor={{ true: C.success, false: C.surface2 }} />
              </View>
            ))}
            <Text style={T.footnote}>* Obligatorio para liberar el pago.</Text>
          </Card>
        )}
        <Field label="Descripción (opcional)">
          <TextInput style={[ui.input, { minHeight: 96, paddingTop: S.sm + 4, textAlignVertical: 'top' }]} multiline placeholder="Batería, detalles, qué incluye…"
            placeholderTextColor={C.textDim} value={description} onChangeText={setDescription} />
        </Field>
      </>}

      {step === 3 && <>
        <Text style={T.title}>¿En cuánto lo vendés?</Text>
        <Card style={{ paddingVertical: S.lg, alignItems: 'center' }}>
          <TextInput style={s.priceInput} placeholder="₡0" placeholderTextColor={C.textDim} keyboardType="number-pad" autoFocus
            value={priceNum ? formatCRC(priceNum) : ''} onChangeText={setPrice} accessibilityLabel="Precio en colones" />
          <Text style={T.footnote}>Precio en colones</Text>
        </Card>
        <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start' }}>
          <Icon name="shield-checkmark" size={20} color={C.success} />
          <Text style={[T.callout, { flex: 1 }]}>Recibís el monto completo. El comprador paga protegido y vos cobrás al entregar.</Text>
        </View>
      </>}

      {step === 4 && <>
        <Text style={T.title}>Revisá y publicá</Text>
        <Card style={{ gap: S.md }}>
          <View style={{ flexDirection: 'row', gap: S.md, alignItems: 'center' }}>
            {photos[0] ? <Image source={{ uri: photos[0].uri }} style={{ width: 64, height: 64, borderRadius: R.md }} />
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
        {([['Categoría', 0], ['Fotos', 1], ['Detalles', 2], ['Precio', 3]] as const).map(([l, i]) => (
          <Pressable key={l} onPress={() => setStep(i)} style={s.editRow}>
            <Text style={T.body}>Editar {l.toLowerCase()}</Text><Icon name="chevron-forward" size={18} color={C.textDim} />
          </Pressable>
        ))}
      </>}

      {error && <ErrorText>{error}</ErrorText>}
    </Screen>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <View style={{ gap: S.sm }}><Text style={T.caption}>{label}</Text>{children}{hint ? <Text style={T.footnote}>{hint}</Text> : null}</View>;
}

const s = StyleSheet.create({
  progress: { flexDirection: 'row', gap: S.xs },
  progressSeg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: C.surface2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  tile: { flexBasis: '30%', flexGrow: 1, aspectRatio: 1, maxHeight: 128, backgroundColor: C.surface, borderRadius: R.lg, alignItems: 'center', justifyContent: 'center', gap: S.sm, borderWidth: 1, borderColor: C.line },
  tileOn: { backgroundColor: C.lilac, borderColor: C.lilac },
  photo: { flexBasis: '47%', flexGrow: 1, aspectRatio: 1, borderRadius: R.lg, overflow: 'hidden', backgroundColor: C.surface },
  photoAdd: { alignItems: 'center', justifyContent: 'center', gap: S.sm, borderWidth: 2, borderStyle: 'dashed', borderColor: C.lilac, backgroundColor: 'transparent' },
  photoX: { position: 'absolute', top: S.sm, right: S.sm, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  priceInput: { fontFamily: Fonts.black, fontSize: 44, color: C.text, textAlign: 'center', minWidth: 200, fontVariant: ['tabular-nums'], outlineStyle: 'none' } as object,
  thumb: { width: 64, height: 64, borderRadius: R.md, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' },
  editRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: TOUCH, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
});
