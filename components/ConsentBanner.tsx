// Aviso de autorización previa para la analítica opcional (PostHog). Texto de Harvey (7 nov 2026), sin selección previa.
// Hasta que la persona elija, no se carga PostHog ni se envían eventos o UTMs (lib/analytics.ts). Barra discreta abajo:
// no es modal, no tapa la ventana de Cavos/passkey y se puede ignorar (sin elección = analítica apagada).
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/ds';
import { needsConsent, setConsent } from '@/lib/analytics';
import { C, S, T } from '@/constants/theme';

export const CONSENT_TEXT = '¿Autorizas que usemos PostHog, que puede tratar datos fuera de Costa Rica, para medir el uso y las operaciones de prueba con identificadores de cuenta o pedido y mejorar Meteorito? Es opcional y puedes retirar tu autorización en “Analítica de uso”.';

export function ConsentBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => { if (Platform.OS === 'web') setShow(needsConsent()); }, []); // después del montaje: localStorage
  if (!show) return null;
  const pick = (c: 'granted' | 'denied') => { setConsent(c); setShow(false); };
  return (
    <View style={s.wrap} pointerEvents="box-none" testID="consent-banner">
      <View style={s.card} accessibilityRole="alert">
        <Text style={[T.footnote, s.text]}>{CONSENT_TEXT}{' '}
          <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacidad' } })}>
            <Text style={[T.footnote, s.link]}>Privacidad</Text>
          </Pressable>
        </Text>
        <View style={s.row}>
          <View style={{ flex: 1 }}><PrimaryButton testID="consent-deny" title="No, gracias" variant="secondary" onPress={() => pick('denied')} /></View>
          <View style={{ flex: 1 }}><PrimaryButton testID="consent-accept" title="Aceptar" variant="secondary" onPress={() => pick('granted')} /></View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // web: fixed y por encima de las capas de pantalla completa (fondo animado, Stack), que si no interceptan el toque
  wrap: { position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', padding: S.sm, zIndex: 10000 },
  card: { width: '100%', maxWidth: 520, backgroundColor: C.surface2, borderRadius: 16, padding: S.md, gap: S.sm },
  text: { color: C.text },
  link: { color: C.lilac, textDecorationLine: 'underline' },
  row: { flexDirection: 'row', gap: S.sm },
});
