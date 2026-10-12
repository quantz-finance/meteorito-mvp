import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Button, ui } from '@/components/ui';
import { Brand } from '@/constants/Colors';
import { CATEGORIES, CONDITIONS, checksSummary, getCategory, validateIdentifier } from '@/lib/categories';
import { useAuth } from '@/lib/cavos';
import { createOrder, formatCRC, formatUSD, uploadPhoto } from '@/lib/orders';
import { supabaseConfigured } from '@/lib/supabase';

interface Photo { uri: string; mime: string }

export default function Vender() {
  const { address, email } = useAuth();
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
      mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 4 - photos.length, quality: 0.7,
    });
    if (res.canceled) return;
    const added = res.assets.map((a) => ({ uri: a.uri, mime: a.mimeType ?? 'image/jpeg' }));
    setPhotos((p) => [...p, ...added].slice(0, 4));
  }

  async function submit() {
    setError(null);
    if (!address) return setError('Iniciá sesión de nuevo');
    if (!brand.trim() || !model.trim()) return setError('Completá marca y modelo');
    if (!priceNum || priceNum < 1000) return setError('Poné un precio válido en colones');
    const idErr = validateIdentifier(cat, identifier);
    if (idErr) return setError(idErr);
    if (!supabaseConfigured) return setError('Falta configurar Supabase (.env)');
    setBusy(true);
    try {
      const urls: string[] = [];
      for (const p of photos) urls.push(await uploadPhoto(p.uri, address, p.mime));
      const slug = await createOrder({
        seller_address: address, seller_email: email, category: cat.id, brand: brand.trim(), model: model.trim(),
        condition, price_crc: priceNum, description: description.trim(), identifier: identifier.trim(),
        photos: urls, checks: checksSummary(cat, checks),
      });
      setBrand(''); setModel(''); setPrice(''); setDescription(''); setIdentifier(''); setChecks({}); setPhotos([]);
      router.push({ pathname: '/compartir/[slug]', params: { slug } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
      <Text style={ui.h1}>Crear link de venta</Text>

      <Text style={ui.label}>Categoría</Text>
      <View style={ui.row}>
        {CATEGORIES.map((c) => (
          <Pressable key={c.id} style={[ui.chip, c.id === categoryId && ui.chipOn]} onPress={() => { setCategoryId(c.id); setChecks({}); }}>
            <Text style={[ui.chipText, c.id === categoryId && { color: Brand.purpleDark }]}>{c.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={ui.label}>Marca y modelo</Text>
      <TextInput style={ui.input} placeholder="Marca (ej. Apple)" placeholderTextColor={Brand.muted} value={brand} onChangeText={setBrand} />
      <TextInput style={ui.input} placeholder="Modelo (ej. iPhone 13 128 GB)" placeholderTextColor={Brand.muted} value={model} onChangeText={setModel} />

      <Text style={ui.label}>Estado</Text>
      <View style={ui.row}>
        {CONDITIONS.map((c) => (
          <Pressable key={c} style={[ui.chip, c === condition && ui.chipOn]} onPress={() => setCondition(c)}>
            <Text style={[ui.chipText, c === condition && { color: Brand.purpleDark }]}>{c}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={ui.label}>Precio (colones)</Text>
      <TextInput style={ui.input} placeholder="₡ 250 000" placeholderTextColor={Brand.muted} keyboardType="number-pad"
        value={priceNum ? formatCRC(priceNum) : ''} onChangeText={setPrice} />
      {priceNum > 0 && <Text style={ui.muted}>{formatUSD(priceNum)} (referencia)</Text>}

      <Text style={ui.label}>{cat.identifier.label}</Text>
      <TextInput style={ui.input} placeholder={cat.identifier.label} placeholderTextColor={Brand.muted} autoCapitalize="characters"
        keyboardType={cat.identifier.kind === 'imei' ? 'number-pad' : 'default'} value={identifier} onChangeText={setIdentifier} />
      {idError && <Text style={ui.error}>{idError}</Text>}
      <Text style={ui.muted}>Nunca se muestra completo: el comprador solo ve los últimos 4.</Text>

      {cat.checks.length > 0 && (
        <View style={ui.card}>
          <Text style={ui.label}>Revisión antes de vender</Text>
          {cat.checks.map((c) => (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Switch value={!!checks[c.id]} onValueChange={(v) => setChecks((s) => ({ ...s, [c.id]: v }))} trackColor={{ true: Brand.lilac }} />
              <Text style={[ui.text, { flex: 1 }]}>{c.label}{c.blocksRelease ? ' *' : ''}</Text>
            </View>
          ))}
          <Text style={ui.muted}>* Obligatorio para liberar el pago.</Text>
        </View>
      )}

      <Text style={ui.label}>Descripción</Text>
      <TextInput style={[ui.input, { minHeight: 90, textAlignVertical: 'top' }]} multiline placeholder="Batería, detalles, qué incluye…"
        placeholderTextColor={Brand.muted} value={description} onChangeText={setDescription} />

      <Text style={ui.label}>Fotos ({photos.length}/4)</Text>
      <View style={ui.row}>
        {photos.map((p, i) => (
          <Pressable key={p.uri} onPress={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}>
            <Image source={{ uri: p.uri }} style={{ width: 76, height: 76, borderRadius: 12 }} />
          </Pressable>
        ))}
        {photos.length < 4 && (
          <Pressable onPress={pickPhotos} style={[ui.chip, { width: 76, height: 76, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }]}>
            <Text style={[ui.chipText, { fontSize: 28 }]}>+</Text>
          </Pressable>
        )}
      </View>

      {error && <Text style={ui.error}>{error}</Text>}
      {busy ? <ActivityIndicator color={Brand.lilac} /> : <Button title="Crear link de venta" onPress={submit} />}
    </ScrollView>
  );
}
