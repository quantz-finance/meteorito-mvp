import { useAutoReleaseWindow } from '@/lib/autorelease';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Glow, LivelyMascot, Reveal, SpaceBackground } from '@/components/space';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { needsRelogin, RELOGIN_TITLE } from '@/lib/cavosSession';

export default function Welcome() {
  const PERKS = perks(useAutoReleaseWindow());
  const { openLogin, isLoading, isAuthenticated, error, configured } = useAuth();
  const [learn, setLearn] = useState(false);
  const busy = isLoading || isAuthenticated; // autenticado pero cargando la cuenta
  const relogin = needsRelogin(error); // sesión vencida/sin token: pantalla clara "Entrar de nuevo", nunca el error del SDK
  // Layout en scroll: nada se superpone. En pantallas altas el espaciador empuja los CTAs abajo;
  // en pantallas bajas (360x640) la página simplemente hace scroll.
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Todo escala con el alto: en 568–640 px (iPhone SE, Android chicos) caben las tarjetas y los dos CTAs principales sin scroll;
  // en 812+ px los tamaños quedan como antes.
  const short = height < 700;
  const tiny = height < 660;
  const mascot = Math.round(Math.max(64, Math.min(128, height * 0.14 - (tiny ? 18 : 0))));
  const gapY = tiny ? S.md : short ? S.lg : S.xl;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SpaceBackground mode="full" />
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + (tiny ? S.lg : short ? S.lg : S.xl), paddingBottom: insets.bottom + S.lg }]}>
        <View style={s.col}>
          <View style={s.hero}>
            <Glow style={[s.glow, { width: mascot * 1.9, height: mascot * 1.9, borderRadius: mascot }]} color="rgba(108,43,217,0.45)" />
            <Reveal i={0}><LivelyMascot size={mascot} parallax={0} /></Reveal>
            <Reveal i={1} style={{ alignItems: 'center' }}>
              <Text style={[s.title, short && { fontSize: 30, lineHeight: 36 }, tiny && { fontSize: 26, lineHeight: 32, marginTop: S.sm }]}>Meteorito</Text>
              <Text style={[s.subtitle, tiny && { fontSize: 14, lineHeight: 19, marginTop: S.xs }]}>Compra y vende celulares, consolas, laptops y más, con los fondos en custodia hasta la entrega.</Text>
            </Reveal>
          </View>
          <View style={[s.perks, { marginTop: gapY }, tiny && { gap: S.sm }]}>
            {PERKS.map((p, i) => (
              <Reveal key={p.text} i={2 + i}><View style={[s.perk, tiny && { paddingVertical: S.sm }]}>
                <View style={s.perkIcon}><Icon name={p.icon} size={18} color={C.lilac} /></View>
                <Text style={[s.perkText, tiny && { fontSize: 14, lineHeight: 19 }]}>{p.text}</Text>
              </View></Reveal>
            ))}
          </View>
          <View style={{ flexGrow: 1, minHeight: gapY }} />
          <View style={[s.ctas, tiny && { gap: S.sm }]}>
            {!configured && <ErrorText>Falta EXPO_PUBLIC_CAVOS_APP_ID en el .env</ErrorText>}
            {relogin ? (
              <View style={s.relogin} testID="relogin-card">
                <Icon name="log-in-outline" size={20} color={C.lilac} />
                <View style={{ flex: 1 }}>
                  <Text style={s.reloginTitle}>{RELOGIN_TITLE}</Text>
                  <Text style={s.reloginText}>{error}</Text>
                </View>
              </View>
            ) : error ? <ErrorText>{error}</ErrorText> : null}
            <PrimaryButton title={relogin ? 'Entrar de nuevo' : 'Entrar'} loading={busy} disabled={!configured} onPress={() => { track('login_started'); openLogin(); }} />
            <PrimaryButton title={width < 350 ? 'Comprar sin cuenta' : 'Quiero comprar (sin cuenta)'} variant="secondary" icon="paper-plane-outline" onPress={() => { track('invite_start_tapped'); router.push('/i/nueva'); }} />
            <PrimaryButton title="¿Cómo funciona?" variant="ghost" icon="help-circle-outline" onPress={() => { track('learn_cta_tapped'); setLearn(true); }} />
          </View>
          <View style={s.footer}>
            <Text style={s.hint}>Beta en testnet · Con Google, Apple o tu correo: Cavos crea tu billetera y tú controlas la llave.</Text>
            <LegalLinks />
          </View>
        </View>
      </ScrollView>
      <LearnSheet visible={learn} onClose={() => setLearn(false)} />
    </View>
  );
}

const s = StyleSheet.create({
  scroll: { flexGrow: 1, paddingHorizontal: S.lg },
  col: { flexGrow: 1, width: '100%', maxWidth: 440, alignSelf: 'center' },
  hero: { alignItems: 'center' },
  relogin: { flexDirection: 'row', gap: S.sm, alignItems: 'flex-start', padding: S.md, borderRadius: 16, backgroundColor: 'rgba(108,43,217,0.18)', borderWidth: 1, borderColor: 'rgba(196,167,255,0.35)' },
  reloginTitle: { color: C.text, fontFamily: Fonts.bold, fontSize: 16, lineHeight: 22 },
  reloginText: { color: C.muted, fontFamily: Fonts.regular, fontSize: 14, lineHeight: 20, marginTop: 2 },
  glow: { position: 'absolute', top: -S.md, alignSelf: 'center', backgroundColor: 'rgba(108,43,217,0.45)' },
  title: { fontFamily: Fonts.black, fontSize: 34, lineHeight: 40, color: C.white, marginTop: S.md },
  subtitle: { fontFamily: Fonts.regular, fontSize: 15, lineHeight: 22, color: C.lilac, textAlign: 'center', marginTop: S.sm, maxWidth: 320 },
  perks: { gap: S.sm + 2, alignSelf: 'stretch' },
  perk: { flexDirection: 'row', alignItems: 'center', gap: S.md - 4, backgroundColor: 'rgba(43,18,102,0.86)', borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, borderRadius: 16, paddingHorizontal: S.md, paddingVertical: S.md - 4 },
  perkIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(108,43,217,0.28)' },
  perkText: { fontFamily: Fonts.regular, fontSize: 15, lineHeight: 20, color: C.text, flex: 1 },
  ctas: { gap: S.sm + 4, alignSelf: 'stretch' },
  footer: { marginTop: S.md, gap: 2, alignItems: 'center' },
  hint: { fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17, color: C.textDim, textAlign: 'center', maxWidth: 340 },
});
