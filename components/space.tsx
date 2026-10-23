// Fondo espacial de Meteorito (portado de meteorito.app): capas de imagen, no cientos de nodos.
// Solo anima transform/opacity con Reanimated (hilo UI). Respeta "Reducir movimiento".
import { createContext, memo, useContext, useEffect, type ReactNode } from 'react';
import { Image, Platform, StyleSheet, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';
import { useStableWindow } from '@/lib/viewport';
import Animated, {
  cancelAnimation, Easing, FadeIn, FadeInDown, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue,
  withDelay, withRepeat, withSequence, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { C } from '@/constants/theme';
import { anim } from '@/constants/motion';

/** En web (Safari iOS) Reanimated corre en el hilo JS: cada nodo animado cuesta frames.
 *  Ahí dejamos solo lo esencial (mascota + llamas) y el fondo quieto. */
const WEB = Platform.OS === 'web';

const IMG = {
  far: require('../assets/images/space/stars-far.webp'),
  near: require('../assets/images/space/stars-near.webp'),
  nebula: require('../assets/images/space/nebula.webp'),
  comet: require('../assets/images/space/comet.webp'),
};

/** Scroll de la pantalla actual, para parallax. */
export const ScrollCtx = createContext<SharedValue<number> | null>(null);
export const useScreenScroll = () => useContext(ScrollCtx);

export type SpaceMode = 'full' | 'calm' | 'none';

/**
 * full: estrellas con parallax + titileo, nebulosa a la deriva, un meteorito ocasional.
 * calm: estrellas fijas y tenues (pantallas de pago: monto y botón primero).
 */
export const SpaceBackground = memo(function SpaceBackground({ mode = 'full', scrollY }: { mode?: SpaceMode; scrollY?: SharedValue<number> | null }) {
  const reduce = useReducedMotion();
  const { width, height } = useStableWindow();
  const live = mode === 'full' && !reduce && !WEB;
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
  // Web: el universo animado vive fijo en el HTML (constants/universe.ts); la pantalla queda transparente encima.
  if (WEB && mode === 'full') return null;
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
});

/** Entrada escalonada (fade + slide). Con reducir movimiento: solo fade. */
export const Reveal = memo(function Reveal({ i = 0, children, style }: { i?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const entering = reduce ? FadeIn.duration(200) : FadeInDown.delay(40 + i * 50).duration(300);
  return <Animated.View entering={entering} style={style}>{children}</Animated.View>;
});

/* ---------- Mascota con estela (port exacto de .meteor en meteorito.app) ----------
 * Mismas capas que el landing: 3 llamas (f1-f3), 3 líneas de velocidad (l1-l3) y 10 brasas (e1-e10)
 * sobre un eje en (62%, 60%) rotado 216°. Los gradientes CSS van horneados en PNG.
 * Un solo reloj de 4 s maneja todo (todas las duraciones del landing dividen 4 s). Solo transform/opacity. */
const TRAIL = {
  f1: require('../assets/images/space/trail-f1.webp'), f2: require('../assets/images/space/trail-f2.webp'), f3: require('../assets/images/space/trail-f3.webp'),
  line: require('../assets/images/space/trail-line.png'), ember: require('../assets/images/space/trail-ember.png'), emberP: require('../assets/images/space/trail-ember-purple.png'),
  mascot: require('../assets/images/space/mascot.webp'),
};
const MASCOT_AR = 604 / 640;
// [dur s, delay s, scaleX, scaleY, translateY cqw] (keyframe 50%)
const FLAMES = [
  { img: 'f1', w: 85, h: 40, mt: -20, dur: 0.8, delay: 0, sx: 1.08, sy: 0.9, ty: 1.5 },
  { img: 'f2', w: 68, h: 26, mt: -20, dur: 1, delay: 0, sx: 1.15, sy: 1.1, ty: -2 },
  { img: 'f3', w: 72, h: 24, mt: -2, dur: 0.8, delay: -0.4, sx: 0.9, sy: 1.12, ty: 2 },
] as const;
const LINES = [{ top: -16, w: 40, delay: 0 }, { top: 12, w: 40, delay: -0.33 }, { top: -2, w: 45, delay: -0.66 }];
const EMBERS = [
  { y: -10, y2: -24, d: 1, dl: 0, s: 3 }, { y: 6, y2: 18, d: 0.8, dl: -0.2, s: 3 }, { y: -2, y2: -8, d: 1, dl: -0.5, s: 3 },
  { y: 10, y2: 26, d: 0.8, dl: -0.7, s: 2 }, { y: -14, y2: -30, d: 1, dl: -0.35, s: 2.2 }, { y: 2, y2: 10, d: 2, dl: -0.85, s: 3 },
  { y: -6, y2: -20, d: 2, dl: -1.3, s: 2 }, { y: 8, y2: 14, d: 0.8, dl: -0.1, s: 1.6 }, { y: -18, y2: -12, d: 1, dl: -0.6, s: 2.4, p: true },
  { y: 14, y2: 30, d: 2, dl: -1.6, s: 3, p: true },
];
function phase(t: number, dur: number, delay: number) {
  'worklet';
  const x = (t * 4 - delay) / dur;
  return x - Math.floor(x);
}
function pingEase(ph: number) {
  'worklet';
  const k = ph < 0.5 ? ph * 2 : (1 - ph) * 2; // 0 -> 1 (50%) -> 0
  return 0.5 - 0.5 * Math.cos(Math.PI * k); // ease-in-out por tramo
}

/** Web: llama en CSS (compositor, sin JS por frame); keyframes m-f1..m-f3 en constants/motion.ts. */
function FlameCss({ f, cq, live }: { f: (typeof FLAMES)[number]; cq: number; live: boolean }) {
  return <View {...(live ? anim(f.img) : {})}
    style={{ position: 'absolute', left: 20 * cq, top: f.mt * cq, width: f.w * cq, height: f.h * cq, transformOrigin: 'left center' }}>
    <Image source={TRAIL[f.img]} resizeMode="stretch" style={{ width: f.w * cq, height: f.h * cq }} />
  </View>;
}
function Flame({ f, t, cq, live }: { f: (typeof FLAMES)[number]; t: SharedValue<number>; cq: number; live: boolean }) {
  const a = useAnimatedStyle(() => {
    const e = live ? pingEase(phase(t.value, f.dur, f.delay)) : 0;
    return { transform: [{ scaleX: 1 + (f.sx - 1) * e }, { scaleY: 1 + (f.sy - 1) * e }, { translateY: f.ty * cq * e }] };
  });
  return <Animated.Image source={TRAIL[f.img]} resizeMode="stretch"
    style={[{ position: 'absolute', left: 20 * cq, top: f.mt * cq, width: f.w * cq, height: f.h * cq, transformOrigin: 'left center' }, a]} />;
}
function Line({ l, t, cq }: { l: (typeof LINES)[number]; t: SharedValue<number>; cq: number }) {
  const a = useAnimatedStyle(() => {
    const ph = phase(t.value, 1, l.delay);
    return { opacity: ph < 0.25 ? (ph / 0.25) * 0.8 : 0.8 * (1 - (ph - 0.25) / 0.75), transform: [{ translateX: (-10 + 70 * ph) * cq }] };
  });
  return <Animated.Image source={TRAIL.line} resizeMode="stretch"
    style={[{ position: 'absolute', left: 40 * cq, top: l.top * cq, width: l.w * cq, height: Math.max(1, 0.7 * cq), borderRadius: 2 * cq }, a]} />;
}
function Ember({ m, t, cq }: { m: (typeof EMBERS)[number]; t: SharedValue<number>; cq: number }) {
  const a = useAnimatedStyle(() => {
    const ph = phase(t.value, m.d, m.dl);
    return {
      opacity: ph < 0.15 ? ph / 0.15 : 1 - (ph - 0.15) / 0.85,
      transform: [{ translateX: 62 * cq * ph }, { translateY: (m.y + (m.y2 - m.y) * ph) * cq }, { scale: 1 - 0.7 * ph }],
    };
  });
  const sz = m.s * cq;
  return <Animated.Image source={m.p ? TRAIL.emberP : TRAIL.ember}
    style={[{ position: 'absolute', left: 30 * cq, top: -sz / 2, width: sz, height: sz }, a]} />;
}

/**
 * Mascota viva con la estela del landing. variant "mini" = como el logo del landing:
 * estela quieta al 55%, sin brasas (usar en pantallas de pago).
 * size = ancho. Reducir movimiento: sin animación, sin líneas ni brasas.
 */
export function LivelyMascot({ size = 96, style, parallax = 0.35, variant = 'big' }: {
  size?: number; style?: StyleProp<ViewStyle>; parallax?: number; variant?: 'big' | 'mini';
}) {
  const reduce = useReducedMotion();
  const scrollY = useScreenScroll();
  const live = !reduce && variant === 'big';
  // En web el ciclo corre en CSS (transform en el compositor): Reanimated web lo haría en el hilo JS a 60 fps.
  const jsLive = live && !WEB;
  const t = useSharedValue(0);
  useEffect(() => {
    if (!jsLive) return;
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration: 4000, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(t);
  }, [jsLive]);
  const w = size, h = size * MASCOT_AR, cq = w / 100;
  const outer = useAnimatedStyle(() => {
    const sy = !reduce && scrollY ? scrollY.value : 0;
    return { transform: [{ translateY: sy * parallax }, { scale: interpolate(sy, [-120, 0, 200], [1.12, 1, 0.85], 'clamp') }] };
  });
  const dive = useAnimatedStyle(() => {
    const e = jsLive ? pingEase(t.value) : 0; // mtDive 4s ease-in-out
    return { transform: [{ translateX: 0.025 * w * e }, { translateY: 0.03 * h * e }, { rotate: `${3 * e}deg` }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ width: w, height: h }, style, outer]}>
      <Animated.View {...(WEB && live ? anim('dive') : {})} style={[{ width: w, height: h }, WEB ? null : dive]}>
        <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: variant === 'mini' ? 0.55 : reduce ? 0.8 : 1 }}>
          <View style={{ position: 'absolute', left: 0.62 * w, top: 0.6 * h, width: 0, height: 0, transform: [{ rotate: '216deg' }] }}>
            {FLAMES.map((f) => WEB ? <FlameCss key={f.img} f={f} cq={cq} live={live} /> : <Flame key={f.img} f={f} t={t} cq={cq} live={jsLive} />)}
            {live && !WEB && LINES.map((l, i) => <Line key={i} l={l} t={t} cq={cq} />)}
            {live && !WEB && EMBERS.map((m, i) => <Ember key={i} m={m} t={t} cq={cq} />)}
          </View>
        </View>
        <Image source={TRAIL.mascot} resizeMode="contain" style={{ width: w, height: h }} />
      </Animated.View>
    </Animated.View>
  );
}

/** Halo suave que respira (solo opacidad/escala, sin blur en loop). */
export function Glow({ style, color = 'rgba(255,138,61,0.35)' }: { style?: StyleProp<ViewStyle>; color?: string }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduce || WEB) return;
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
  const { width } = useStableWindow();
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
