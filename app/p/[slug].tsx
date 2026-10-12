import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, Text, View } from 'react-native';
import { Button, ui } from '@/components/ui';
import { Brand } from '@/constants/Colors';
import { getCategory } from '@/lib/categories';
import { useAuth } from '@/lib/cavos';
import { formatCRC, formatUSD, getPublicOrder, STATUS_LABEL, type PublicOrder } from '@/lib/orders';

export default function LinkDeVenta() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { isAuthenticated, email, openLogin } = useAuth();
  const [order, setOrder] = useState<PublicOrder | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    getPublicOrder(String(slug)).then(setOrder).catch((e) => setError((e as Error).message));
  }, [slug]);

  if (error) return <Center><Text style={ui.error}>No se pudo cargar: {error}</Text></Center>;
  if (order === undefined) return <Center><ActivityIndicator color={Brand.lilac} /></Center>;
  if (order === null) return <Center><Text style={ui.h1}>Este link no existe</Text></Center>;

  const cat = getCategory(order.category);
  return (
    <ScrollView style={ui.screen} contentContainerStyle={[ui.content, { paddingTop: 40 }]}>
      <Text style={ui.muted}>Meteorito · Pagá seguro</Text>
      <ScrollView horizontal contentContainerStyle={{ gap: 10 }}>
        {order.photos.map((u) => <Image key={u} source={{ uri: u }} style={{ width: 260, height: 260, borderRadius: 16 }} />)}
      </ScrollView>
      <Text style={ui.h1}>{order.brand} {order.model}</Text>
      <Text style={ui.muted}>{cat?.label ?? order.category} · {order.condition} · {STATUS_LABEL[order.status] ?? order.status}</Text>
      <Text style={[ui.h1, { fontSize: 32 }]}>{formatCRC(order.price_crc)}</Text>
      <Text style={ui.muted}>{formatUSD(order.price_crc)}</Text>
      {order.description ? <Text style={ui.text}>{order.description}</Text> : null}

      <View style={ui.card}>
        <Text style={ui.label}>Lo que declara el vendedor</Text>
        {order.identifier_masked && <Text style={ui.text}>Identificador: {order.identifier_masked}</Text>}
        {(order.checks_summary ?? []).map((c) => (
          <Text key={c.id} style={[ui.text, !c.ok && { color: Brand.orange }]}>{c.ok ? '✓' : '✗'} {c.label}</Text>
        ))}
        <Text style={ui.muted}>Meteorito verifica esto antes de liberar el pago.</Text>
      </View>

      <Button title="Pagar seguro · Próximamente: escrow" disabled />
      {isAuthenticated
        ? <Text style={ui.muted}>Sesión iniciada como {email}</Text>
        : <Button title="Entrar para comprar" variant="outline" onPress={openLogin} />}
    </ScrollView>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <View style={[ui.screen, { alignItems: 'center', justifyContent: 'center', padding: 24 }]}>{children}</View>;
}
