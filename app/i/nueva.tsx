// Comprador (sin cuenta): pide a un vendedor que publique el artículo. Crea una INVITACIÓN; el vendedor la confirma y manda el link de pago.
import { router } from 'expo-router';
import { userMessage } from '@/lib/cavosSession';
import { useState } from 'react';
import { Text, TextInput, useWindowDimensions, View } from 'react-native';
import { ErrorText, Icon, PrimaryButton, Screen, TestnetPill } from '@/components/ds';
import { ui } from '@/components/ui';
import { C, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { createInvite } from '@/lib/invites';
import { formatCRC } from '@/lib/orders';
import { track, trackError } from '@/lib/analytics';

const MIN_PRICE = 1000, MAX_PRICE = 50_000_000;

export default function NuevaInvitacion() {
  const auth = useAuth();
  const categoryId = 'otro'; // ya no se pide categoría
  const short = useWindowDimensions().height < 720;
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
    } catch (e) { trackError('create_invite', e); setErr(userMessage((e as Error).message)); } finally { setBusy(false); }
  }

  return (
    <Screen back="/" title="Invitar a un vendedor" subtitle={short ? undefined : 'Dile qué quieres y a qué precio; él publica y te manda el link.'} right={<TestnetPill />} scroll={false}
      footer={<>{err && <ErrorText>{err}</ErrorText>}<PrimaryButton title="Crear invitación" icon="paper-plane-outline" loading={busy} onPress={submit} /></>}>
      <View style={{ flex: 1, gap: S.sm }}>
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <View style={{ flex: 1, gap: S.xs }}>
            <Text style={T.caption}>Marca</Text>
            <TextInput style={ui.input} value={brand} onChangeText={setBrand} placeholder="Apple, Sony…" placeholderTextColor={C.textDim} maxLength={60} accessibilityLabel="Marca" />
          </View>
          <View style={{ flex: 1.3, gap: S.xs }}>
            <Text style={T.caption}>Modelo</Text>
            <TextInput style={ui.input} value={model} onChangeText={setModel} placeholder="iPhone 13, PS5…" placeholderTextColor={C.textDim} maxLength={80} accessibilityLabel="Modelo" />
          </View>
        </View>
        <Text style={T.caption}>Precio acordado (₡)</Text>
        <TextInput style={ui.input} value={price} onChangeText={(v) => setPrice(v.replace(/\D/g, ''))} inputMode="numeric" keyboardType="number-pad" placeholder="250000" placeholderTextColor={C.textDim} accessibilityLabel="Precio acordado" />
        <Text style={T.caption}>Nota para el vendedor (opcional)</Text>
        <TextInput style={ui.input} value={note} onChangeText={setNote} maxLength={500} placeholder="Ej.: entrega en Escazú esta semana" placeholderTextColor={C.textDim} accessibilityLabel="Nota para el vendedor" />
        <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.xs }}><Icon name="information-circle-outline" size={18} color={C.lilac} /><Text style={[T.footnote, { flex: 1 }]}>No necesitas cuenta: tu navegador guarda una llave para que solo tú pagues el link. Beta en testnet: sin dinero real.</Text></View>
      </View>
    </Screen>
  );
}
