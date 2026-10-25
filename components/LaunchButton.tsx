// Botón circular "Generar link" de Vender: un planeta violeta sólido que se aprieta, con halo que respira, dos órbitas
// elípticas inclinadas que giran despacio (un planetita y un meteorito pasan por detrás y por delante), partículas que
// flotan y onda expansiva al lanzar. Solo presentación: la lógica (validar, crear) es de Vender.
// Vive en su PROPIO espacio (escenario) dentro del flujo de Vender: nunca encima del formulario ni de los avisos.
// Web: animaciones CSS (constants/motion.ts, solo transform/opacity en el compositor, 0 JS por frame).
// Nativo: Animated con useNativeDriver. "Reducir movimiento": quieto (sin bucles, sin onda ni partículas).
// idle (falta algo): más calmo pero sólido y legible; se puede tocar: tiembla y Vender muestra qué falta.
import { memo, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { useReducedMotion } from 'react-native-reanimated';
import { anim, pressTransition } from '@/constants/motion';
import { Fonts } from '@/constants/Colors';
import { C } from '@/constants/theme';
import { haptic, Icon } from '@/components/ds';
import { launchState, type Orbit } from '@/lib/launchCore';

const WEB = Platform.OS === 'web';
const COMET = require('../assets/images/space/comet.webp');

/** Bucle nativo (rotación u oscilación 0→1) con el driver nativo; en web o con reducir movimiento no corre. */
function useLoop(on: boolean, duration: number, bounce = false) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) { v.stopAnimation(); v.setValue(0); return; }
    const t = Animated.timing(v, { toValue: 1, duration, easing: bounce ? Easing.inOut(Easing.sin) : Easing.linear, useNativeDriver: true });
    const a = Animated.loop(bounce ? Animated.sequence([t, Animated.timing(v, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true })]) : t);
    a.start();
    return () => a.stop();
  }, [on, duration]);
  return v;
}

const STEPS = Array.from({ length: 17 }, (_, i) => i / 16);
/** Cuerpo que recorre una órbita elíptica. Web: dos osciladores CSS desfasados un cuarto de vuelta (x = a·cos, y = b·sin).
 *  front: copia que solo se ve en la mitad delantera (pasa por delante del círculo); la de atrás queda tapada por él. */
function Body({ o, n, front, t, children }: { o: Orbit; n: 1 | 2; front?: boolean; t: Animated.Value | null; children: React.ReactNode }) {
  const box = { position: 'absolute' as const, left: 0, top: 0, width: o.a, height: o.b };
  if (WEB) return (
    <View {...(front ? anim(`of${n}`) : {})} style={[StyleSheet.absoluteFill, front && { opacity: 0 }]}>
      <View {...anim(`ox${n}`)} style={[box, { transform: [{ translateX: o.a }] }]}>
        <View {...anim(`oy${n}`)} style={box}>{children}</View>
      </View>
    </View>
  );
  const x = t ? t.interpolate({ inputRange: STEPS, outputRange: STEPS.map((p) => o.a * Math.cos(p * 2 * Math.PI)) }) : o.a;
  const y = t ? t.interpolate({ inputRange: STEPS, outputRange: STEPS.map((p) => -o.b * Math.sin(p * 2 * Math.PI)) }) : 0;
  const op = front ? (t ? t.interpolate({ inputRange: [0, 0.49, 0.51, 1], outputRange: [0, 0, 1, 1] }) : 1) : 1;
  return <Animated.View style={[{ position: 'absolute', left: 0, top: 0, opacity: op, transform: [{ translateX: x }, { translateY: y }] }]}>{children}</Animated.View>;
}

export const LaunchButton = memo(function LaunchButton({ label, ready, busy, size, inner, outer, onPress }: {
  label: string; ready: boolean; busy: boolean; size: number; inner: Orbit; outer: Orbit; onPress: () => void;
}) {
  const reduce = useReducedMotion();
  const state = launchState(ready, busy);
  const z = size;
  const [shock, setShock] = useState(0); // cada lanzamiento remonta la onda (web) / la reinicia (nativo)
  const [shake, setShake] = useState(0);
  const native = !WEB && !reduce;
  const lit = state !== 'idle';
  const spin = useLoop(native, 22000);
  const orb1 = useLoop(native, inner.period * 1000);
  const orb2 = useLoop(native, outer.period * 1000);
  const halo = useLoop(native, lit ? 2800 : 4200, true);
  const busySpin = useLoop(!WEB && busy, 900);
  const wave = useRef(new Animated.Value(1)).current;
  const jolt = useRef(new Animated.Value(0)).current;

  function press() {
    if (busy) return;
    haptic.tap();
    if (ready) {
      setShock((n) => n + 1);
      if (native) { wave.setValue(0); Animated.timing(wave, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }
    } else {
      setShake((n) => n + 1);
      if (native) { jolt.setValue(0); Animated.timing(jolt, { toValue: 1, duration: 380, easing: Easing.linear, useNativeDriver: true }).start(); }
    }
    onPress();
  }

  const box = Math.ceil(Math.max(outer.a, inner.a) * 2 + 24); // lienzo de la decoración, centrado en el círculo
  const c = box / 2;
  const at = (d: number) => ({ position: 'absolute' as const, width: d, height: d, borderRadius: d / 2, left: c - d / 2, top: c - d / 2 });
  const center = { left: '50%', top: '50%', width: box, height: box, marginLeft: -box / 2, marginTop: -box / 2 } as object;
  const rot = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const rotR = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] });
  /** Anillo elíptico: un círculo punteado que gira dentro de un contenedor aplastado e inclinado (los trazos corren por la elipse). */
  const ring = (o: Orbit, css: object, v: Animated.AnimatedInterpolation<string>, style: object) => (
    <View style={[at(o.a * 2), { transform: [{ rotate: `${o.tilt}deg` }, { scaleY: o.b / o.a }] }]}>
      <Animated.View {...css} style={[StyleSheet.absoluteFill, { borderRadius: o.a }, style, native ? { transform: [{ rotate: v }] } : null]} />
    </View>
  );
  const tilted = (o: Orbit) => ({ position: 'absolute' as const, left: c, top: c, width: 0, height: 0, transform: [{ rotate: `${o.tilt}deg` }] });
  const planet = <View style={[s.planet, { left: -5, top: -5 }, !lit && s.planetCalm]} />;
  const comet = <Image source={COMET} style={[s.comet, { left: -9, top: -8 }, !lit && { opacity: 0.75 }]} />;
  const fg = lit ? C.white : '#EEE8FF';
  const small = z < 120;

  return (
    <View testID="launch-stage" pointerEvents="box-none" style={s.stage}>
      {/* Detrás del círculo (sin toques): halo que respira, órbitas, cuerpos en su mitad trasera, partículas */}
      <View pointerEvents="none" style={[s.decor, center]}>
        <Animated.View {...anim(lit ? 'halo' : 'halo-calm')} style={[at(z + 6), lit ? s.halo : s.haloCalm,
          native ? { opacity: halo.interpolate({ inputRange: [0, 1], outputRange: lit ? [0.6, 1] : [0.45, 0.75] }), transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [1, lit ? 1.08 : 1.04] }) }] } : null]} />
        {WEB && lit && !busy ? <View {...anim('sonar')} style={[at(z), s.sonar]} /> : null}
        {ring(outer, anim('orbit-r'), rotR, [s.ringOuter, !lit && { opacity: 0.6 }])}
        {ring(inner, anim('orbit'), rot, [s.ringInner, !lit && { opacity: 0.6 }])}
        <View style={tilted(outer)}><Body o={outer} n={2} t={native ? orb2 : null}>{comet}</Body></View>
        <View style={tilted(inner)}><Body o={inner} n={1} t={native ? orb1 : null}>{planet}</Body></View>
        {WEB && lit && !busy ? <View {...anim('floaters')} style={[at(z + 40)]}>
          {[0, 1, 2, 3, 4, 5].map((i) => <View key={i} style={{ backgroundColor: i % 3 === 0 ? C.orange : i % 3 === 1 ? C.lilac : C.white }} />)}
        </View> : null}
      </View>

      <Animated.View key={`shake${shake}`} {...(WEB && shake > 0 ? anim('shake') : {})}
        style={native ? { transform: [{ translateX: jolt.interpolate({ inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1], outputRange: [0, -7, 6, -4, 2, 0] }) }] } : null}>
        <Pressable onPress={press} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy }} aria-busy={busy}
            testID="launch-button" {...(WEB ? { dataSet: { state } } : {})}
            style={({ pressed }) => [s.core, { width: z, height: z, borderRadius: z / 2 }, lit ? s.coreLit : s.coreIdle,
              pressTransition, pressed && !busy && { transform: [{ scale: 0.93 }] }]}>
            {({ pressed }) => <>
              <Svg pointerEvents="none" width={z} height={z} style={StyleSheet.absoluteFill}>
                <Defs>
                  <RadialGradient id="lg-on" cx="34%" cy="28%" r="80%">
                    <Stop offset="0" stopColor="#C9A9FF" /><Stop offset="0.24" stopColor="#8B5CF6" /><Stop offset="0.62" stopColor="#6D28D9" /><Stop offset="1" stopColor="#3F1784" />
                  </RadialGradient>
                  <RadialGradient id="lg-off" cx="34%" cy="28%" r="80%">
                    <Stop offset="0" stopColor="#9277EA" /><Stop offset="0.4" stopColor="#5E3FC2" /><Stop offset="1" stopColor="#331C80" />
                  </RadialGradient>
                  <RadialGradient id="lg-rim" cx="50%" cy="100%" r="60%">
                    <Stop offset="0" stopColor="#FF8A3D" stopOpacity={lit ? 0.55 : 0.18} /><Stop offset="1" stopColor="#FF8A3D" stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Circle cx={z / 2} cy={z / 2} r={z / 2} fill={`url(#${lit ? 'lg-on' : 'lg-off'})`} />
                <Circle cx={z / 2} cy={z / 2} r={z / 2} fill="url(#lg-rim)" />
                {/* cráteres suaves y brillo especular: un planeta, no un botón plano */}
                <Circle cx={z * 0.72} cy={z * 0.7} r={z * 0.07} fill="#2A0E5E" fillOpacity={lit ? 0.22 : 0.18} />
                <Circle cx={z * 0.27} cy={z * 0.74} r={z * 0.04} fill="#2A0E5E" fillOpacity={lit ? 0.2 : 0.16} />
                <Circle cx={z * 0.8} cy={z * 0.38} r={z * 0.03} fill="#2A0E5E" fillOpacity={lit ? 0.18 : 0.14} />
                <Ellipse cx={z * 0.36} cy={z * 0.22} rx={z * 0.2} ry={z * 0.09} fill="#FFFFFF" fillOpacity={lit ? 0.22 : 0.1} />
                <Circle cx={z / 2} cy={z / 2} r={z / 2 - 1} fill="none" stroke="#FFFFFF" strokeOpacity={lit ? 0.35 : 0.22} strokeWidth={1.5} />
              </Svg>
              {/* pulso suave en reposo: brillo interior que late (solo opacidad; el círculo no se mueve y se toca estable) */}
              {busy ? null : <Animated.View pointerEvents="none" {...anim(lit ? 'glow' : 'glow-calm')} style={[StyleSheet.absoluteFill, s.glow, { borderRadius: z / 2 },
                native ? { opacity: halo.interpolate({ inputRange: [0, 1], outputRange: lit ? [0.15, 0.6] : [0.1, 0.35] }) } : null]} />}
              {/* destello al apretar (solo opacidad) */}
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.flash, { borderRadius: z / 2, opacity: pressed && !busy ? 1 : 0 }, pressTransition]} />
              <View key={lit ? 'on' : 'off'} {...(WEB && lit ? anim('ignite') : {})} style={s.inner}>
                {busy ? <ActivityIndicator color={C.white} /> : <Icon name="link" size={small ? 26 : 32} color={fg} />}
                <Text style={[s.label, { color: fg, fontSize: small ? 15 : 17, lineHeight: small ? 18 : 21 }]} numberOfLines={2}>{label}</Text>
              </View>
            </>}
        </Pressable>
      </Animated.View>

      {/* Delante del círculo (sin toques): la mitad delantera de cada órbita, onda expansiva y chispas */}
      <View pointerEvents="none" style={[s.decor, center]}>
        <View style={tilted(outer)}><Body o={outer} n={2} front t={native ? orb2 : null}>{comet}</Body></View>
        <View style={tilted(inner)}><Body o={inner} n={1} front t={native ? orb1 : null}>{planet}</Body></View>
        {shock > 0 && WEB ? <View key={shock} style={StyleSheet.absoluteFill}>
          <View {...anim('shock')} style={[at(z), s.shock]} />
          <View {...anim('shock2')} style={[at(z), s.shock, { borderColor: 'rgba(201,182,255,0.8)' }]} />
          <View {...anim('burst')} style={StyleSheet.absoluteFill}>{Array.from({ length: 10 }, (_, i) => <View key={i} />)}</View>
        </View> : null}
        {shock > 0 && native ? <Animated.View style={[at(z), s.shock, { opacity: wave.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }), transform: [{ scale: wave.interpolate({ inputRange: [0, 1], outputRange: [1, 2.3] }) }] }]} /> : null}
        {busy ? <Animated.View {...anim('spin')}
          style={[at(z + 12), s.arc, !WEB ? { transform: [{ rotate: busySpin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] } : null]} /> : null}
      </View>
    </View>
  );
});

const glow = (css: string, color: string, op: number, r: number) => (WEB ? { boxShadow: css } : { shadowColor: color, shadowOpacity: op, shadowRadius: r, shadowOffset: { width: 0, height: 0 } });
const s = StyleSheet.create({
  decor: { position: 'absolute' },
  stage: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  halo: { backgroundColor: 'rgba(139,92,246,0.45)', ...glow('0 0 26px 8px rgba(139,92,246,0.55), 0 0 44px 4px rgba(255,138,61,0.22)', '#8B5CF6', 0.8, 26) } as object,
  haloCalm: { backgroundColor: 'rgba(139,92,246,0.22)', ...glow('0 0 18px 4px rgba(139,92,246,0.32)', '#8B5CF6', 0.4, 16) } as object,
  ringInner: { borderWidth: 1.5, borderColor: 'rgba(255,214,170,0.6)', borderStyle: 'dashed' },
  ringOuter: { borderWidth: 1, borderColor: 'rgba(201,182,255,0.5)', borderStyle: 'dashed' },
  planet: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFD84D', ...glow('0 0 8px 2px rgba(255,216,77,0.65)', '#FFD84D', 0.8, 6) } as object,
  planetCalm: { backgroundColor: '#E9C66A' },
  comet: { position: 'absolute', width: 18, height: 17, transform: [{ rotate: '-45deg' }] },
  shock: { borderWidth: 2, borderColor: 'rgba(255,190,120,0.9)' },
  core: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  coreLit: WEB ? { boxShadow: '0 10px 28px -6px rgba(76,29,149,0.9), inset 0 -8px 18px rgba(40,10,90,0.45)' } as object : { shadowColor: '#4C1D95', shadowOpacity: 0.8, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  coreIdle: WEB ? { boxShadow: '0 8px 22px -8px rgba(20,6,50,0.9), inset 0 -6px 14px rgba(20,6,50,0.4)' } as object : { shadowColor: '#140632', shadowOpacity: 0.7, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  glow: { opacity: 0.3, ...(WEB ? { boxShadow: 'inset 0 0 24px 5px rgba(214,196,255,0.75)' } : { borderWidth: 3, borderColor: 'rgba(214,196,255,0.45)' }) } as object,
  sonar: { opacity: 0, borderWidth: 2, borderColor: 'rgba(196,170,255,0.7)' },
  flash: { backgroundColor: 'rgba(255,255,255,0.22)', ...(WEB ? { boxShadow: 'inset 0 0 26px 6px rgba(255,236,210,0.55)' } : {}) } as object,
  inner: { alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 10 },
  label: { fontFamily: Fonts.black, textAlign: 'center', textShadowColor: 'rgba(30,8,70,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  arc: { borderWidth: 3, borderColor: 'transparent', borderTopColor: '#FFD84D', borderRightColor: 'rgba(255,216,77,0.35)' },
});
