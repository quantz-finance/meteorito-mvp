// Comprador (sin cuenta): pide a un vendedor que publique el artículo. Crea una INVITACIÓN; el vendedor la confirma y manda el link de pago.
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Card, ErrorText, Icon, PrimaryButton, Screen, TestnetPill } from '@/components/ds';
import { ui } from '@/components/ui';
import { C, S, T } from '@/constants/theme';
import { CATEGORIES } from '@/lib/categories';
import { useAuth } from '@/lib/cavos';
import { createInvite } from '@/lib/invites';
import { formatCRC } from '@/lib/orders';
import { track, trackError } from '@/lib/analytics';

const MIN_PRICE = 1000, MAX_PRICE = 50_000_000;

export default function NuevaInvitacion() {
  const auth = useAuth();
  const [categoryId, setCategoryId] = useState('celular');
  const [brand, setBrand] = useState(''); const [model, setModel] = useState('');
  const [price, setPrice] = useState(''); const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const priceNum = Number(price.replace(/\D/g, ''));

  async function submit() {
    setErr(null);
    if (!brand.trim() || !model.trim()) return setErr('Completa marca y modelo.');
    if (!priceNum || priceNum < MIN_PRICE || priceNum > MAX_PRICE) return setErr(`Ingresa un precio válido: mínimo ${formatCRC(MIN_PRICE)}, máximo ${formatCRC(MAX_PRICE)}.`);
    setBusy(true);
    try {
      const code = await createInvite(auth, { category: categoryId, brand: brand.trim(), model: model.trim(), price_crc: priceNum, note: note.trim() || undefined });
      track('invite_created', { category: categoryId });
      router.replace({ pathname: '/i/[code]', params: { code } });
    } catch (e) { trackError('create_invite', e); setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Screen back="/" title="Invitar a un vendedor" subtitle="Cuéntanos qué quieres comprar. El vendedor confirma publicando el artículo y te envía el link de pago." right={<TestnetPill />}
      footer={<>{err && <ErrorText>{err}</ErrorText>}<PrimaryButton title="Crear invitación" icon="paper-plane-outline" loading={busy} onPress={submit} /></>}>
      <Card style={{ gap: S.sm }}>
        <Text style={T.caption}>Categoría</Text>
        <View style={ui.row}>
          {CATEGORIES.map((c) => (
            <Pressable key={c.id} accessibilityRole="radio" accessibilityState={{ selected: c.id === categoryId }} onPress={() => setCategoryId(c.id)} style={[ui.chip, c.id === categoryId && ui.chipOn]}>
              <Text style={[ui.chipText, c.id === categoryId && { color: C.purpleDark }]}>{c.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={T.caption}>Marca</Text>
        <TextInput style={ui.input} value={brand} onChangeText={setBrand} placeholder="Apple, Samsung, Sony…" placeholderTextColor={C.textDim} maxLength={60} />
        <Text style={T.caption}>Modelo</Text>
        <TextInput style={ui.input} value={model} onChangeText={setModel} placeholder="iPhone 13, PS5…" placeholderTextColor={C.textDim} maxLength={80} />
        <Text style={T.caption}>Precio acordado (₡)</Text>
        <TextInput style={ui.input} value={price} onChangeText={(v) => setPrice(v.replace(/\D/g, ''))} inputMode="numeric" keyboardType="number-pad" placeholder="250000" placeholderTextColor={C.textDim} />
        <Text style={T.caption}>Nota para el vendedor (opcional)</Text>
        <TextInput style={[ui.input, { minHeight: 80, paddingTop: S.sm + 4, textAlignVertical: 'top' }]} multiline value={note} onChangeText={setNote} maxLength={500} placeholder="Ej.: Lo necesito esta semana, entrega en Escazú" placeholderTextColor={C.textDim} />
      </Card>
      <Card style={{ gap: S.sm }}>
        <View style={{ flexDirection: 'row', gap: S.sm }}><Icon name="information-circle-outline" size={20} color={C.lilac} /><Text style={[T.callout, { flex: 1 }]}>No necesitas cuenta. Tu navegador guarda una llave para que solo tú puedas pagar con el link que cree el vendedor. Es una prueba en testnet: no se mueve dinero real.</Text></View>
      </Card>
    </Screen>
  );
}
