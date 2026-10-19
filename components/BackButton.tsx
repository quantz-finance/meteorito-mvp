// Botón "Volver" compartido para pantallas fuera de las tabs: arriba a la izquierda, área táctil ≥ 44 px.
// Si hay historial hace router.back(); si el link se abrió directo (sin historial) va a `fallback`.
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { haptic, Icon } from '@/components/ds';
import { pressTransition } from '@/constants/motion';
import { Fonts } from '@/constants/Colors';
import { C, S, TOUCH } from '@/constants/theme';

export function goBack(fallback: Href = '/') {
  if (router.canGoBack()) router.back(); else router.replace(fallback);
}

export function BackButton({ fallback = '/', label = 'Volver' }: { fallback?: Href; label?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} testID="back-button"
      onPress={() => { haptic.tap(); goBack(fallback); }}
      style={({ pressed }) => [s.btn, pressTransition, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}>
      <Icon name="arrow-back" size={20} color={C.lilac} />
      <Text style={s.t}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', gap: S.xs, alignSelf: 'flex-start', minHeight: TOUCH, minWidth: TOUCH,
    paddingLeft: S.sm, paddingRight: S.md - 4, marginLeft: -S.sm, borderRadius: 999 },
  t: { fontFamily: Fonts.bold, fontSize: 16, color: C.lilac },
});
