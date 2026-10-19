import { useAutoReleaseWindow } from '@/lib/autorelease';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Glow, LivelyMascot, Reveal, SpaceBackground } from '@/components/space';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/cavos';
import { ErrorText, Icon, PrimaryButton, type IconName } from '@/components/ds';
import { C, S, T } from '@/constants/theme';
import { Fonts } from '@/constants/Colors';

const perks = (w: string | null): { icon: IconName; text: string }[] => [
  { icon: 'shield-checkmark', text: 'El vendedor cobra solo cuando recibes' },
  { icon: 'keypad', text: 'PIN de entrega para confirmar' },
  { icon: 'time', text: w ? `Pago liberado en ${w} si todo está bien` : 'Pago liberado automáticamente si todo está bien' },
];
import { track } from '@/lib/analytics';
import { router } from 'expo-router';
import { useState } from 'react';
import { LearnSheet } from '@/components/LearnSheet';
import { LegalLinks } from '@/components/LegalLinks';

export default function Welcome() {
  const PERKS = perks(useAutoReleaseWindow());
  const { openLogin, isLoading, isAuthenticated, error, configured } = useAuth();
  const [learn, setLearn] = useState(false);
  const busy = isLoading || isAuthenticated; // autenticado pero cargando la cuenta
  // Todo cabe en el viewport sin scroll: la mascota y los espacios escalan con el alto disponible
  // (Safari iOS con barras visibles deja ~650-750 px en un 13 Pro Max).
  const { height } = useWindowDimensions();
  const compact = height < 760;
  const tiny = height < 640;
  const mascot = Math.round(Math.max(88, Math.min(150, height * 0.17)));
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
    <SpaceBackground mode="full" />
    <SafeAreaView style={s.root}>
      <View style={s.center}>
        <Glow style={s.glow} color="rgba(108,43,217,0.45)" />
        <Reveal i={0}><LivelyMascot size={mascot} style={s.mascot} parallax={0} /></Reveal>
        <Reveal i={1} style={{ alignItems: 'center' }}><Text style={[s.title, compact && { fontSize: 32 }]}>Meteorito</Text>
        <Text style={s.subtitle}>Compra y vende celulares, consolas, laptops y más, con los fondos en custodia hasta la entrega.</Text></Reveal>
        <View style={{ gap: compact ? S.sm : S.sm + 4, marginTop: compact ? S.md : S.lg, alignSelf: 'stretch' }}>
          {PERKS.map((p, i) => (
            <Reveal key={p.text} i={2 + i}><View style={[s.perk, compact && { minHeight: 44 }]}>
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
        <PrimaryButton title="Quiero comprar (sin cuenta)" variant="secondary" icon="paper-plane-outline" onPress={() => { track('invite_start_tapped'); router.push('/i/nueva'); }} />
        <PrimaryButton title="¿Cómo funciona? Cuenta, custodia y testnet" variant="ghost" icon="help-circle-outline" onPress={() => { track('learn_cta_tapped'); setLearn(true); }} />
        <LegalLinks />
        {!tiny && <Text style={s.hint}>Con Google, Apple o tu correo: Cavos crea tu billetera, tú controlas la llave. · Beta en testnet</Text>}
        <LearnSheet visible={learn} onClose={() => setLearn(false)} />
      </View>
    </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: S.lg, overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: 480, alignSelf: 'center' },
  glow: { position: 'absolute', top: '8%', width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(108,43,217,0.45)' },
  mascot: { marginBottom: S.sm },
  title: { fontFamily: Fonts.black, fontSize: 36, color: C.white },
  subtitle: { fontFamily: Fonts.regular, fontSize: 15, lineHeight: 21, color: C.lilac, textAlign: 'center', marginTop: S.sm, maxWidth: 320 },
  perk: { flexDirection: 'row', alignItems: 'center', gap: S.md, backgroundColor: 'rgba(43,18,102,0.86)', borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, borderRadius: 16, paddingHorizontal: S.md, minHeight: 48 },
  bottom: { gap: S.sm, paddingBottom: S.md, width: '100%', maxWidth: 480, alignSelf: 'center' },
  hint: { fontFamily: Fonts.regular, fontSize: 12, color: C.textDim, textAlign: 'center' },
});
