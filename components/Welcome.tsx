import { Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/cavos';
import { ErrorText, Icon, PrimaryButton, type IconName } from '@/components/ds';
import { C, S, T } from '@/constants/theme';
import { Fonts } from '@/constants/Colors';

const PERKS: { icon: IconName; text: string }[] = [
  { icon: 'shield-checkmark', text: 'El vendedor cobra solo cuando recibís' },
  { icon: 'keypad', text: 'PIN de entrega para confirmar' },
  { icon: 'time', text: 'Pago liberado en 24 h si todo está bien' },
];

export default function Welcome() {
  const { openLogin, isLoading, isAuthenticated, error, configured } = useAuth();
  const busy = isLoading || isAuthenticated; // autenticado pero cargando la cuenta
  return (
    <SafeAreaView style={s.root}>
      <View style={s.center}>
        <View style={s.glow} />
        <Image source={require('../assets/images/mascot.png')} style={s.mascot} resizeMode="contain" />
        <Text style={s.title}>Meteorito</Text>
        <Text style={s.subtitle}>Comprá y vendé celulares, consolas, laptops y más, con el pago protegido.</Text>
        <View style={{ gap: S.sm + 4, marginTop: S.lg, alignSelf: 'stretch' }}>
          {PERKS.map((p) => (
            <View key={p.text} style={s.perk}>
              <Icon name={p.icon} size={20} color={C.lilac} />
              <Text style={[T.body, { flex: 1 }]}>{p.text}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={s.bottom}>
        {!configured && <ErrorText>Falta EXPO_PUBLIC_CAVOS_APP_ID en el .env</ErrorText>}
        {error && <ErrorText>{error}</ErrorText>}
        <PrimaryButton title="Entrar" loading={busy} disabled={!configured} onPress={openLogin} />
        <Text style={s.hint}>Con Google, Apple o tu correo. Sin contraseñas. · Modo prueba</Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingHorizontal: S.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: 480, alignSelf: 'center' },
  glow: { position: 'absolute', top: '12%', width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(108,43,217,0.45)' },
  mascot: { width: 168, height: 168, marginBottom: S.md },
  title: { fontFamily: Fonts.black, fontSize: 40, color: C.white },
  subtitle: { fontFamily: Fonts.regular, fontSize: 17, lineHeight: 24, color: C.lilac, textAlign: 'center', marginTop: S.sm, maxWidth: 320 },
  perk: { flexDirection: 'row', alignItems: 'center', gap: S.md, backgroundColor: C.surface, borderRadius: 16, paddingHorizontal: S.md, minHeight: 52 },
  bottom: { gap: S.sm + 4, paddingBottom: S.md, width: '100%', maxWidth: 480, alignSelf: 'center' },
  hint: { fontFamily: Fonts.regular, fontSize: 13, color: C.textDim, textAlign: 'center' },
});
