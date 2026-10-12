import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { ui } from '@/components/ui';
import { Brand } from '@/constants/Colors';
import { useAuth } from '@/lib/cavos';
import { formatCRC, getSellerOrders, STATUS_LABEL, type SellerOrder } from '@/lib/orders';
import { supabaseConfigured } from '@/lib/supabase';

export default function Pedidos() {
  const { address } = useAuth();
  const [orders, setOrders] = useState<SellerOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!address || !supabaseConfigured) return;
    setLoading(true); setError(null);
    try { setOrders(await getSellerOrders(address)); } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [address]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <FlatList
      style={ui.screen}
      contentContainerStyle={ui.content}
      data={orders}
      keyExtractor={(o) => o.slug}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={Brand.lilac} />}
      ListHeaderComponent={<>
        <Text style={ui.h1}>Mis ventas</Text>
        {!supabaseConfigured && <Text style={ui.error}>Falta configurar Supabase (.env)</Text>}
        {error && <Text style={ui.error}>{error}</Text>}
      </>}
      ListEmptyComponent={!loading ? <Text style={ui.muted}>Todavía no creaste links. Andá a Vender.</Text> : null}
      renderItem={({ item }) => (
        <Pressable style={ui.card} onPress={() => router.push({ pathname: '/compartir/[slug]', params: { slug: item.slug } })}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={[ui.text, { fontWeight: '700', flex: 1 }]}>{item.brand} {item.model}</Text>
            <Text style={[ui.chipText]}>{STATUS_LABEL[item.status] ?? item.status}</Text>
          </View>
          <Text style={ui.muted}>{formatCRC(item.price_crc)} · /p/{item.slug}</Text>
        </Pressable>
      )}
    />
  );
}
