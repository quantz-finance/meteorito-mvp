import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, Text, View } from 'react-native';
import { Button, ui } from '@/components/ui';
import { PayBox } from '@/components/PayBox';
import { Brand } from '@/constants/Colors';
import { getCategory } from '@/lib/categories';
import { useAuth } from '@/lib/cavos';
import { formatCRC, formatUSD, getPublicOrder, STATUS_LABEL, type PublicOrder } from '@/lib/orders';

export default function LinkDeVenta() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { isAuthenticated, email } = useAuth();
  const [order, setOrder] = useState<PublicOrder | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = () => { if (slug) getPublicOrder(String(slug)).then(setOrder).catch((e) => setError((e as Error).message)); };
  // Respaldo del pg_cron: si el plazo de 24h ya venció, pedirle al backend que libere (idempotente, verifica on-chain).
  useEffect(() => {
    if (order?.status === 'enviado' && order.auto_release_at && new Date(order.auto_release_at) <= new Date())
      fetch(`/api/escrow/cron?slug=${order.slug}`).then(() => load()).catch(() => {});
  }, [order?.status, order?.auto_release_at]);
  useEffect(load, [slug]);

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
          <Text key={c.id} style={ui.text}>{c.ok ? '✓' : '✗'} {c.label}</Text>
        ))}
        <Text style={ui.muted}>Meteorito verifica esto antes de liberar el pago.</Text>
      </View>

      <PayBox order={order} onChange={load} />
      {isAuthenticated && <Text style={ui.muted}>Sesión iniciada como {email}</Text>}
    </ScrollView>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <View style={[ui.screen, { alignItems: 'center', justifyContent: 'center', padding: 24 }]}>{children}</View>;
}
