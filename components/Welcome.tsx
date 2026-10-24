import { Platform, StyleSheet, Text, View } from 'react-native';
import { useStableWindow } from '@/lib/viewport';
import { Glow, LivelyMascot, Reveal, SpaceBackground } from '@/components/space';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/cavos';
import { ErrorText, Icon, IconButton, PrimaryButton } from '@/components/ds';
import { hasLocalPurchases, MY_PURCHASES_TITLE } from '@/lib/purchases';
import { C, S } from '@/constants/theme';
import { Fonts } from '@/constants/Colors';
import { track } from '@/lib/analytics';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { LearnSheet } from '@/components/LearnSheet';
import { LegalLinks } from '@/components/LegalLinks';
import { needsRelogin, RELOGIN_TITLE } from '@/lib/cavosSession';

export default function Welcome() {
  const { openLogin, isLoading, isAuthenticated, error, configured } = useAuth();
  const [learn, setLearn] = useState(false);
  // Comprador sin cuenta que ya compró en este dispositivo: acceso a Mis compras arriba a la derecha (después del montaje: localStorage).
  const [bought, setBought] = useState(false);
  useEffect(() => { setBought(hasLocalPurchases()); }, []);
  const busy = isLoading || isAuthenticated; // autenticado pero cargando la cuenta
  const relogin = needsRelogin(error); // sesión vencida/sin token: pantalla clara "Entrar de nuevo", nunca el error del SDK
  // Sin scroll: todo cabe en una pantalla, incluso con la barra de Safari visible (~620 px útiles). La mascota y los
  // espacios escalan con el alto real; los botones quedan siempre abajo.
  const { height, width } = useStableWindow();
  const insets = useSafeAreaInsets();
  const short = height < 720;
  const tiny = height < 640;
  const mascot = Math.round(Math.max(56, Math.min(128, height * 0.15 - (relogin || error ? 24 : 0))));
  return (
    <View style={{ flex: 1, backgroundColor: Platform.OS === 'web' ? 'transparent' : C.bg }}>
      <SpaceBackground mode="full" />
      {bought ? <View style={{ position: 'absolute', zIndex: 2, top: insets.top + S.md, right: S.md }}>
        <IconButton icon="bag-handle" label={MY_PURCHASES_TITLE} onPress={() => router.push('/mis-compras')} />
      </View> : null}
      <View style={[s.col, { paddingTop: insets.top + (tiny ? S.md : S.lg), paddingBottom: insets.bottom + S.sm }]}>
        <View style={s.hero}>
          <View style={{ width: mascot, height: mascot, alignItems: 'center', justifyContent: 'center' }}>
            <Glow style={[s.glow, { width: mascot * 1.6, height: mascot * 1.6, borderRadius: mascot * 0.8, top: -mascot * 0.3, left: -mascot * 0.3 }]} color="rgba(108,43,217,0.45)" />
            <Reveal i={0}><LivelyMascot size={mascot} parallax={0} /></Reveal>
          </View>
          <Reveal i={1} style={{ alignItems: 'center' }}>
            <Text style={[s.title, short && { fontSize: 30, lineHeight: 36, marginTop: S.sm }]}>Meteorito</Text>
            <Text style={[s.subtitle, tiny && { fontSize: 15, lineHeight: 20 }]}>Crea un link de pago en segundos. El dinero queda en custodia hasta la entrega.</Text>
          </Reveal>
        </View>
        <View style={[s.ctas, tiny && { gap: S.sm }]}>
          {!configured && <ErrorText>Falta EXPO_PUBLIC_CAVOS_APP_ID en el .env</ErrorText>}
          {relogin ? (
            <View style={s.relogin} testID="relogin-card">
              <Icon name="log-in-outline" size={20} color={C.lilac} />
              <View style={{ flex: 1 }}>
                <Text style={s.reloginTitle}>{RELOGIN_TITLE}</Text>
                <Text style={s.reloginText} numberOfLines={3}>{error}</Text>
              </View>
            </View>
          ) : error ? <ErrorText>{error}</ErrorText> : null}
          <PrimaryButton title={relogin ? 'Entrar de nuevo' : 'Entrar'} loading={busy} disabled={!configured} onPress={() => { track('login_started'); openLogin(); }} />
          <PrimaryButton title={width < 350 ? 'Comprar sin cuenta' : 'Quiero comprar (sin cuenta)'} variant="secondary" icon="paper-plane-outline" onPress={() => { track('invite_start_tapped'); router.push('/i/nueva'); }} />
          <PrimaryButton title="¿Cómo funciona?" variant="ghost" icon="help-circle-outline" onPress={() => { track('learn_cta_tapped'); setLearn(true); }} />
          <View style={s.footer}>
            <Text style={s.hint}>Entras con Google, Apple o tu correo.</Text>
            <LegalLinks />
          </View>
        </View>
      </View>
      <LearnSheet visible={learn} onClose={() => setLearn(false)} />
    </View>
  );
}

const s = StyleSheet.create({
  col: { flex: 1, width: '100%', maxWidth: 440, alignSelf: 'center', paddingHorizontal: S.lg, justifyContent: 'space-between' },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 0 },
  relogin: { flexDirection: 'row', gap: S.sm, alignItems: 'flex-start', padding: S.md, borderRadius: 16, backgroundColor: 'rgba(108,43,217,0.18)', borderWidth: 1, borderColor: 'rgba(196,167,255,0.35)' },
  reloginTitle: { color: C.text, fontFamily: Fonts.bold, fontSize: 16, lineHeight: 22 },
  reloginText: { color: C.muted, fontFamily: Fonts.regular, fontSize: 14, lineHeight: 20, marginTop: 2 },
  glow: { position: 'absolute', backgroundColor: 'rgba(108,43,217,0.45)' },
  title: { fontFamily: Fonts.black, fontSize: 34, lineHeight: 40, color: C.white, marginTop: S.md },
  subtitle: { fontFamily: Fonts.regular, fontSize: 15, lineHeight: 22, color: C.lilac, textAlign: 'center', marginTop: S.sm, maxWidth: 320 },
  ctas: { gap: S.sm + 4, alignSelf: 'stretch' },
  footer: { marginTop: S.xs, gap: 2, alignItems: 'center' },
  hint: { fontFamily: Fonts.regular, fontSize: 12, lineHeight: 17, color: C.textDim, textAlign: 'center', maxWidth: 340 },
});
