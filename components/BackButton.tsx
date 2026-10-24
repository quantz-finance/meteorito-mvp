// Botón "Volver" compartido para pantallas fuera de las tabs: arriba a la izquierda, área táctil ≥ 44 px.
// Si hay historial hace router.back(); si el link se abrió directo (sin historial) va a `fallback`.
import { router, useNavigation, type Href } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';
import { haptic, Icon } from '@/components/ds';
import { pressTransition } from '@/constants/motion';
import { Fonts } from '@/constants/Colors';
import { C, S, TOUCH } from '@/constants/theme';
import { guestFallback, prevIsPublic } from '@/lib/publicRoutes';
import { useIsGuest } from '@/lib/useIsGuest';

export function goBack(fallback: Href = '/vender') {
  if (router.canGoBack()) router.back(); else router.replace(fallback);
}

/** Salida a una ruta FUERA de la pila actual (Comprar sin cuenta -> bienvenida). La bienvenida la pinta el Gate en lugar del
 *  navegador (app/_layout.tsx): router.back() no la alcanza y router.replace() a una ruta con login desmonta el navegador y
 *  expo-router lo vuelve a montar en la ruta pública (la pantalla no cambiaba). En web se carga la ruta de verdad. */
export function exitTo(href: Href) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.assign(String(href));
  else router.replace(href);
}

/** Acción de Volver. Con cuenta: historial o `to` (como siempre). Sin cuenta: atrás solo si la pantalla anterior se ve sin
 *  cuenta; si no (link abierto directo: debajo queda Vender sin montar), nunca a una ruta con login: a Mis compras
 *  (guestFallback), o a `guestExit` si la pantalla lo pide. exit (salida explícita, p. ej. Comprar -> bienvenida): siempre a `to` con exitTo. */
export function useBack(to: Href, exit = false, guestExit?: Href) {
  const guest = useIsGuest();
  const nav = useNavigation();
  return () => {
    if (exit) return exitTo(to);
    if (!guest || typeof to !== 'string') return goBack(to);
    if (router.canGoBack() && prevIsPublic(nav.getState() as any)) router.back();
    else if (guestExit) exitTo(guestExit); // legales y reglas: se abren desde la bienvenida, vuelven a ella
    else router.replace(guestFallback(to, true) as Href);
  };
}

/** replace: va siempre a `fallback` con exitTo (sin historial de la pila). */
export function BackButton({ fallback = '/vender', label = 'Volver', replace = false }: { fallback?: Href; label?: string; replace?: boolean }) {
  const back = useBack(fallback, replace);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} testID="back-button"
      onPress={() => { haptic.tap(); back(); }}
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
