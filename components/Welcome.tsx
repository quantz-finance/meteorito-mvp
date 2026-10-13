import { useAutoReleaseWindow } from '@/lib/autorelease';
import { StyleSheet, Text, View } from 'react-native';
import { Glow, LivelyMascot, Reveal, SpaceBackground } from '@/components/space';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/cavos';
import { ErrorText, Icon, PrimaryButton, type IconName } from '@/components/ds';
import { C, S, T } from '@/constants/theme';
import { Fonts } from '@/constants/Colors';

const perks = (w: string): { icon: IconName; text: string }[] => [
  { icon: 'shield-checkmark', text: 'El vendedor cobra solo cuando recibís' },
  { icon: 'keypad', text: 'PIN de entrega para confirmar' },
  { icon: 'time', text: `Pago liberado en ${w} si todo está bien` },
];
import { track } from '@/lib/analytics';
import { LegalLinks } from '@/components/LegalLinks';

export default function Welcome() {
  const PERKS = perks(useAutoReleaseWindow());
  const { openLogin, isLoading, isAuthenticated, error, configured } = useAuth();
  const busy = isLoading || isAuthenticated; // autenticado pero cargando la cuenta
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
    <SpaceBackground mode="full" />
    <SafeAreaView style={s.root}>
      <View style={s.center}>
        <Glow style={s.glow} color="rgba(108,43,217,0.45)" />
        <Reveal i={0}><LivelyMascot size={168} style={s.mascot} parallax={0} /></Reveal>
        <Reveal i={1} style={{ alignItems: 'center' }}><Text style={s.title}>Meteorito</Text>
        <Text style={s.subtitle}>Comprá y vendé celulares, consolas, laptops y más, con el pago protegido.</Text></Reveal>
        <View style={{ gap: S.sm + 4, marginTop: S.lg, alignSelf: 'stretch' }}>
          {PERKS.map((p, i) => (
            <Reveal key={p.text} i={2 + i}><View style={s.perk}>
              <Icon name={p.icon} size={20} color={C.lilac} />
              <Text style={[T.body, { flex: 1 }]}>{p.text}</Text>
            </View></Reveal>
          ))}
        </View>
      </View>
      <View style={s.bottom}>
        {!configured && <ErrorText>Falta EXPO_PUBLIC_CAVOS_APP_ID en el .env</ErrorText>}
        {error && <ErrorText>{error}</ErrorText>}
        <PrimaryButton title="Entrar" loading={busy} disabled={!configured} onPress={() => { track('login_started'); openLogin(); }} />
        <LegalLinks />
        <Text style={s.hint}>Con Google, Apple o tu correo. Sin contraseñas. · Modo prueba</Text>
      </View>
    </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: S.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: 480, alignSelf: 'center' },
  glow: { position: 'absolute', top: '12%', width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(108,43,217,0.45)' },
  mascot: { marginBottom: S.md },
  title: { fontFamily: Fonts.black, fontSize: 40, color: C.white },
  subtitle: { fontFamily: Fonts.regular, fontSize: 17, lineHeight: 24, color: C.lilac, textAlign: 'center', marginTop: S.sm, maxWidth: 320 },
  perk: { flexDirection: 'row', alignItems: 'center', gap: S.md, backgroundColor: 'rgba(43,18,102,0.86)', borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, borderRadius: 16, paddingHorizontal: S.md, minHeight: 52 },
  bottom: { gap: S.sm + 4, paddingBottom: S.md, width: '100%', maxWidth: 480, alignSelf: 'center' },
  hint: { fontFamily: Fonts.regular, fontSize: 13, color: C.textDim, textAlign: 'center' },
});
