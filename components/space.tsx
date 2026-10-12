// Fondo espacial de Meteorito (portado de meteorito.app): capas de imagen, no cientos de nodos.
// Solo anima transform/opacity con Reanimated (hilo UI). Respeta "Reducir movimiento".
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { Image, StyleSheet, useWindowDimensions, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation, Easing, FadeIn, FadeInDown, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue,
  withDelay, withRepeat, withSequence, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { C } from '@/constants/theme';

const IMG = {
  far: require('../assets/images/space/stars-far.webp'),
  near: require('../assets/images/space/stars-near.webp'),
  nebula: require('../assets/images/space/nebula.webp'),
  comet: require('../assets/images/space/comet.webp'),
  mascot: require('../assets/images/mascot.png'),
};

/** Scroll de la pantalla actual, para parallax. */
export const ScrollCtx = createContext<SharedValue<number> | null>(null);
export const useScreenScroll = () => useContext(ScrollCtx);

export type SpaceMode = 'full' | 'calm' | 'none';

/**
 * full: estrellas con parallax + titileo, nebulosa a la deriva, un meteorito ocasional.
 * calm: estrellas fijas y tenues (pantallas de pago: monto y botón primero).
 */
export function SpaceBackground({ mode = 'full', scrollY }: { mode?: SpaceMode; scrollY?: SharedValue<number> | null }) {
  const reduce = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const live = mode === 'full' && !reduce;
  const tw = useSharedValue(0.75);
  const drift = useSharedValue(0);
  const streak = useSharedValue(0);

  useEffect(() => {
    if (!live) return;
    tw.value = withRepeat(withTiming(1, { duration: 4000, easing: Easing.inOut(Easing.sin) }), -1, true);
    drift.value = withRepeat(withTiming(1, { duration: 26000, easing: Easing.inOut(Easing.sin) }), -1, true);
    streak.value = withRepeat(withSequence(withDelay(7000, withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) })), withTiming(0, { duration: 0 })), -1);
    return () => { cancelAnimation(tw); cancelAnimation(drift); cancelAnimation(streak); };
  }, [live]);

  const farS = useAnimatedStyle(() => ({ transform: [{ translateY: live && scrollY ? -scrollY.value * 0.08 : 0 }] }));
  const nearS = useAnimatedStyle(() => ({
    opacity: live ? tw.value : 0.8,
    transform: [{ translateY: live && scrollY ? -scrollY.value * 0.22 : 0 }],
  }));
  const nebS = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(drift.value, [0, 1], [0, width * 0.06]) },
      { translateY: interpolate(drift.value, [0, 1], [0, -height * 0.04]) + (live && scrollY ? -scrollY.value * 0.12 : 0) },
      { scale: interpolate(drift.value, [0, 1], [1, 1.12]) },
    ],
  }));
  const streakS = useAnimatedStyle(() => ({
    opacity: interpolate(streak.value, [0, 0.08, 0.7, 1], [0, 1, 0.8, 0]),
    transform: [{ translateX: interpolate(streak.value, [0, 1], [width + 80, -160]) }, { translateY: interpolate(streak.value, [0, 1], [height * 0.08, height * 0.32]) }, { rotate: '-25deg' }],
  }));

  if (mode === 'none') return null;
  const tall = height * 1.4; // margen para parallax
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: C.bg, overflow: 'hidden' }]}>
      {mode === 'full' && <>
        <Animated.Image source={IMG.nebula} resizeMode="stretch" style={[s.neb, { width: width * 2.2, height: height * 1.3, left: -width * 0.6, top: -height * 0.15 }, nebS]} />
      </>}
      <Animated.Image source={IMG.far} resizeMode="cover" style={[{ position: 'absolute', width, height: tall, opacity: mode === 'calm' ? 0.35 : 0.8 }, farS]} />
      {mode === 'full' && <Animated.Image source={IMG.near} resizeMode="cover" style={[{ position: 'absolute', width, height: tall }, nearS]} />}
      {live && <Animated.Image source={IMG.comet} style={[s.comet, streakS]} />}
    </View>
  );
}

/** Entrada escalonada (fade + slide). Con reducir movimiento: solo fade. */
export function Reveal({ i = 0, children, style }: { i?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const entering = reduce ? FadeIn.duration(200) : FadeInDown.delay(60 + i * 70).duration(420).springify().damping(18);
  return <Animated.View entering={entering} style={style}>{children}</Animated.View>;
}

/** Mascota viva: flota y responde al scroll. */
export function LivelyMascot({ size = 96, style, parallax = 0.35 }: { size?: number; style?: StyleProp<ImageStyle>; parallax?: number }) {
  const reduce = useReducedMotion();
  const scrollY = useScreenScroll();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    t.value = withRepeat(withTiming(1, { duration: 3600, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(t);
  }, [reduce]);
  const a = useAnimatedStyle(() => {
    const sy = !reduce && scrollY ? scrollY.value : 0;
    return { transform: [
      { translateY: interpolate(t.value, [0, 1], [0, -10]) + sy * parallax },
      { rotate: `${interpolate(t.value, [0, 1], [-4, 3])}deg` },
      { scale: interpolate(sy, [-120, 0, 200], [1.12, 1, 0.85], 'clamp') },
    ] };
  });
  return <Animated.Image source={IMG.mascot} resizeMode="contain" style={[{ width: size, height: size }, style, a]} />;
}

/** Halo suave que respira (solo opacidad/escala, sin blur en loop). */
export function Glow({ style, color = 'rgba(255,138,61,0.35)' }: { style?: StyleProp<ViewStyle>; color?: string }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    p.value = withRepeat(withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(p);
  }, [reduce]);
  const a = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 1], [0.7, 1]), transform: [{ scale: interpolate(p.value, [0, 1], [1, 1.08]) }] }));
  return <Animated.View pointerEvents="none" style={[{ backgroundColor: color }, style, a]} />;
}

/**
 * Meteorito de celebración, una sola pasada. Montarlo SOLO después de una respuesta
 * exitosa del backend que confirma la operación on-chain (p. ej. pago liberado).
 */
export function MeteorBurst({ height = 120 }: { height?: number }) {
  const reduce = useReducedMotion();
  const { width } = useWindowDimensions();
  const v = useSharedValue(0);
  useEffect(() => { if (!reduce) v.value = withTiming(1, { duration: 1200, easing: Easing.out(Easing.cubic) }); }, [reduce]);
  const a = useAnimatedStyle(() => ({
    opacity: interpolate(v.value, [0, 0.1, 0.75, 1], [0, 1, 1, 0]),
    transform: [{ translateX: interpolate(v.value, [0, 1], [width * 0.6, -width * 0.6]) }, { translateY: interpolate(v.value, [0, 1], [-height * 0.4, height * 0.3]) }, { rotate: '-25deg' }],
  }));
  if (reduce) return null;
  return <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height, alignItems: 'center', justifyContent: 'center' }}>
    <Animated.Image source={IMG.comet} style={[{ width: 72, height: 68 }, a]} />
  </View>;
}

const s = StyleSheet.create({
  neb: { position: 'absolute', opacity: 0.9 },
  comet: { position: 'absolute', top: 0, left: 0, width: 56, height: 52 },
});
