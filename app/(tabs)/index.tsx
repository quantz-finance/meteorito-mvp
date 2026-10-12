import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/lib/cavos';
import { fetchBalances, type Balances } from '@/lib/horizon';
import { Brand, Fonts } from '@/constants/Colors';

export default function Inicio() {
  const { email, address, logout } = useAuth();
  const [bal, setBal] = useState<Balances | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true); setErr(null);
    try { setBal(await fetchBalances(address)); } catch (e) { setErr(String((e as Error).message ?? e)); }
    finally { setLoading(false); }
  }, [address]);
  useEffect(() => { load(); }, [load]);

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={Brand.lilac} />}>
      <Text style={s.hello}>Hola {email ?? 'de nuevo'} 👋</Text>
      <View style={s.card}>
        <Text style={s.label}>Tu cuenta Stellar (testnet)</Text>
        <Text style={s.address} selectable>{address}</Text>
      </View>
      <View style={s.card}>
        <Text style={s.label}>Saldo</Text>
        {loading && !bal ? <ActivityIndicator color={Brand.lilac} /> : err ? <Text style={s.warn}>No se pudo leer el saldo: {err}</Text> : bal && (
          <>
            <Text style={s.balance}>{Number(bal.xlm).toFixed(2)} XLM</Text>
            <Text style={s.balance}>{bal.usdc != null ? Number(bal.usdc).toFixed(2) : '0.00'} USDC</Text>
            {!bal.funded && <Text style={s.warn}>La cuenta todavía no existe en la red. Se activa con su primer movimiento.</Text>}
          </>
        )}
        <Pressable onPress={load}><Text style={s.link}>Actualizar</Text></Pressable>
      </View>
      <Pressable style={s.logout} onPress={() => logout()}><Text style={s.logoutText}>Cerrar sesión</Text></Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.purpleDark },
  content: { padding: 20, gap: 16, paddingTop: 48 },
  hello: { fontFamily: Fonts.black, fontSize: 26, color: Brand.white },
  card: { backgroundColor: Brand.purpleMid, borderRadius: 18, padding: 18, gap: 8 },
  label: { fontFamily: Fonts.bold, fontSize: 13, color: Brand.muted, textTransform: 'uppercase' },
  address: { fontFamily: Fonts.bold, fontSize: 15, color: Brand.white },
  balance: { fontFamily: Fonts.black, fontSize: 24, color: Brand.white },
  warn: { fontFamily: Fonts.regular, fontSize: 14, color: Brand.orange },
  link: { fontFamily: Fonts.bold, color: Brand.lilac, marginTop: 4 },
  logout: { borderColor: Brand.lilac, borderWidth: 1, borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  logoutText: { fontFamily: Fonts.bold, fontSize: 16, color: Brand.lilac },
});
