import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/cavos';
import { Brand, Fonts } from '@/constants/Colors';

export default function Welcome() {
  const { openLogin, isLoading, isAuthenticated, error, configured } = useAuth();
  const busy = isLoading || isAuthenticated; // autenticado pero cargando la cuenta
  return (
    <SafeAreaView style={s.root}>
      <View style={s.center}>
        <Image source={require('../assets/images/mascot.png')} style={s.mascot} resizeMode="contain" />
        <Text style={s.title}>Meteorito</Text>
        <Text style={s.subtitle}>Comprá y vendé iPhones usados con el pago protegido. Pagá seguro.</Text>
      </View>
      <View style={s.bottom}>
        {!configured && <Text style={s.error}>Falta EXPO_PUBLIC_CAVOS_APP_ID en el .env</Text>}
        {error && <Text style={s.error}>{error}</Text>}
        <Pressable style={({ pressed }) => [s.btn, pressed && { opacity: 0.8 }]} onPress={openLogin} disabled={busy || !configured}>
          {busy ? <ActivityIndicator color={Brand.purple} /> : <Text style={s.btnText}>Entrar</Text>}
        </Pressable>
        <Text style={s.hint}>Con Google, Apple o tu correo. Sin frases semilla. Red de pruebas (testnet).</Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.purpleDark, padding: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mascot: { width: 220, height: 220, marginBottom: 16 },
  title: { fontFamily: Fonts.black, fontSize: 42, color: Brand.white },
  subtitle: { fontFamily: Fonts.regular, fontSize: 17, color: Brand.lilac, textAlign: 'center', marginTop: 8, maxWidth: 320 },
  bottom: { gap: 12, paddingBottom: 12 },
  btn: { backgroundColor: Brand.white, borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  btnText: { fontFamily: Fonts.bold, fontSize: 18, color: Brand.purple },
  hint: { fontFamily: Fonts.regular, fontSize: 13, color: Brand.muted, textAlign: 'center' },
  error: { fontFamily: Fonts.bold, fontSize: 14, color: Brand.orange, textAlign: 'center' },
});
