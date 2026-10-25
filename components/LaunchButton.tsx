// Botón circular "Generar link" de Vender: un planeta-sol que se aprieta, con órbitas, un meteorito que gira, halo que
// respira, partículas que flotan y onda expansiva al lanzar. Solo presentación: la lógica (validar, crear) es de Vender.
// Web: animaciones CSS (constants/motion.ts, solo transform/opacity en el compositor, 0 JS por frame).
// Nativo: Animated con useNativeDriver. "Reducir movimiento": quieto (sin bucles, sin onda ni partículas).
// idle (falta algo): se ve apagado pero se puede tocar; al tocarlo tiembla y Vender muestra qué falta.
import { memo, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useReducedMotion } from 'react-native-reanimated';
import { anim, pressTransition } from '@/constants/motion';
import { Fonts } from '@/constants/Colors';
import { C } from '@/constants/theme';
import { haptic, Icon } from '@/components/ds';
import { launchSize, launchState } from '@/lib/launchCore';

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
  }, [on]);
  return v;
}

export const LaunchButton = memo(function LaunchButton({ label, ready, busy, short, onPress }: {
  label: string; ready: boolean; busy: boolean; short: boolean; onPress: () => void;
}) {
  const reduce = useReducedMotion();
  const state = launchState(ready, busy);
  const z = launchSize(short);
  const [shock, setShock] = useState(0); // cada lanzamiento remonta la onda (web) / la reinicia (nativo)
  const [shake, setShake] = useState(0);
  const native = !WEB && !reduce;
  const spin = useLoop(native, 16000);
  const halo = useLoop(native && state !== 'idle', 2800, true);
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

  const rot = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const rotR = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-220deg'] });
  const lit = state !== 'idle';
  const fg = lit ? C.white : 'rgba(255,255,255,0.72)';
  const ring = (d: number) => ({ position: 'absolute' as const, width: d, height: d, borderRadius: d / 2, left: (z.outer - d) / 2, top: (z.outer - d) / 2 });

  return (
    <View testID="launch-stage" pointerEvents="box-none" style={{ width: z.outer, height: z.stage, alignItems: 'center', justifyContent: 'center' }}>
      {/* Decoración (hermanos del botón, sin toques): halo, órbitas, meteorito, partículas, onda */}
      <View pointerEvents="none" style={[s.decor, { width: z.outer, height: z.outer, left: 0, top: (z.stage - z.outer) / 2 }]}>
        <Animated.View {...(WEB && lit ? anim('halo') : {})} style={[ring(z.core + 10), s.halo, !lit && { opacity: 0 },
          native && lit ? { opacity: halo.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }), transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [1, 1.09] }) }] } : null]} />
        <Animated.View {...anim('orbit')} style={[ring(z.orbit), s.orbit, { opacity: lit ? 1 : 0.45 }, native ? { transform: [{ rotate: rot }] } : null]}>
          <View style={[s.planet, { left: z.orbit / 2 - 5, top: -5 }]} />
        </Animated.View>
        <Animated.View {...anim('orbit-r')} style={[ring(z.outer), s.outer, { opacity: lit ? 0.9 : 0.35 }, native ? { transform: [{ rotate: rotR }] } : null]}>
          <Image source={COMET} style={[s.comet, { left: z.outer * 0.86 - 9, top: z.outer * 0.86 - 9 }]} />
          <View style={[s.moon, { left: z.outer * 0.07, top: z.outer * 0.3 }]} />
        </Animated.View>
        {WEB && lit && !busy ? <View {...anim('floaters')} style={StyleSheet.absoluteFill}>
          {[0, 1, 2, 3, 4, 5].map((i) => <View key={i} style={{ backgroundColor: i % 3 === 0 ? C.orange : i % 3 === 1 ? C.lilac : C.white }} />)}
        </View> : null}
      </View>

      <Animated.View key={`shake${shake}`} {...(WEB && shake > 0 ? anim('shake') : {})}
        style={native ? { transform: [{ translateX: jolt.interpolate({ inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1], outputRange: [0, -7, 6, -4, 2, 0] }) }] } : null}>
        <Pressable onPress={press} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ busy }} aria-busy={busy}
          testID="launch-button" {...(WEB ? { dataSet: { state } } : {})}
          style={({ pressed }) => [s.core, { width: z.core, height: z.core, borderRadius: z.core / 2 }, lit ? s.coreLit : s.coreIdle,
            pressTransition, pressed && !busy && { transform: [{ scale: 0.92 }] }]}>
          <Svg pointerEvents="none" width={z.core} height={z.core} style={StyleSheet.absoluteFill}>
            <Defs>
              <RadialGradient id="lg-on" cx="36%" cy="30%" r="75%">
                <Stop offset="0" stopColor="#FFE2B8" /><Stop offset="0.35" stopColor="#FFA552" /><Stop offset="0.75" stopColor="#FF7A3D" /><Stop offset="1" stopColor="#E0507A" />
              </RadialGradient>
              <RadialGradient id="lg-off" cx="36%" cy="30%" r="75%">
                <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.2" /><Stop offset="1" stopColor="#FFFFFF" stopOpacity="0.05" />
              </RadialGradient>
            </Defs>
            <Circle cx={z.core / 2} cy={z.core / 2} r={z.core / 2} fill={`url(#${lit ? 'lg-on' : 'lg-off'})`} />
            {lit ? <>
              <Circle cx={z.core * 0.68} cy={z.core * 0.7} r={z.core * 0.06} fill="#C2452F" fillOpacity={0.22} />
              <Circle cx={z.core * 0.3} cy={z.core * 0.72} r={z.core * 0.035} fill="#C2452F" fillOpacity={0.18} />
            </> : null}
          </Svg>
          <View key={lit ? 'on' : 'off'} {...(WEB && lit ? anim('ignite') : {})} style={s.inner}>
            {busy ? <ActivityIndicator color={C.white} /> : <Icon name="link" size={short ? 24 : 30} color={fg} />}
            <Text style={[s.label, { color: fg, fontSize: short ? 14 : 16 }]} numberOfLines={2}>{label}</Text>
          </View>
        </Pressable>
      </Animated.View>

      {/* Onda expansiva y chispas: encima del círculo (salen de él), sin toques */}
      <View pointerEvents="none" style={[s.decor, { width: z.outer, height: z.outer, left: 0, top: (z.stage - z.outer) / 2 }]}>
          {shock > 0 && WEB ? <View key={shock} style={StyleSheet.absoluteFill}>
          <View {...anim('shock')} style={[ring(z.core), s.shock]} />
          <View {...anim('shock2')} style={[ring(z.core), s.shock, { borderColor: 'rgba(201,182,255,0.8)' }]} />
          <View {...anim('burst')} style={StyleSheet.absoluteFill}>{Array.from({ length: 10 }, (_, i) => <View key={i} />)}</View>
          </View> : null}
          {shock > 0 && native ? <Animated.View style={[ring(z.core), s.shock, { opacity: wave.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }), transform: [{ scale: wave.interpolate({ inputRange: [0, 1], outputRange: [1, 2.3] }) }] }]} /> : null}
      </View>

      {busy ? <Animated.View pointerEvents="none" {...anim('spin')}
        style={[s.arc, { width: z.core + 12, height: z.core + 12, borderRadius: (z.core + 12) / 2, left: (z.outer - z.core - 12) / 2, top: (z.stage - z.core - 12) / 2 },
          !WEB ? { transform: [{ rotate: busySpin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] } : null]} /> : null}
    </View>
  );
});

const s = StyleSheet.create({
  decor: { position: 'absolute' },
  halo: { backgroundColor: 'rgba(255,138,61,0.28)', ...(WEB ? { boxShadow: '0 0 34px 10px rgba(255,138,61,0.38)' } : { shadowColor: C.orange, shadowOpacity: 0.6, shadowRadius: 24, shadowOffset: { width: 0, height: 0 } }) } as object,
  orbit: { borderWidth: 1, borderColor: 'rgba(255,214,170,0.45)', borderStyle: 'dashed' },
  outer: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)' },
  planet: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFD84D', ...(WEB ? { boxShadow: '0 0 8px 2px rgba(255,216,77,0.6)' } : {}) } as object,
  moon: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: '#B8A4FF', ...(WEB ? { boxShadow: '0 0 6px 1px rgba(184,164,255,0.55)' } : {}) } as object,
  comet: { position: 'absolute', width: 18, height: 17, transform: [{ rotate: '-45deg' }] },
  shock: { borderWidth: 2, borderColor: 'rgba(255,190,120,0.9)' },
  core: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  coreLit: WEB ? { boxShadow: '0 10px 30px -6px rgba(255,122,61,0.65), inset 0 -6px 14px rgba(160,40,70,0.35)' } as object : { shadowColor: C.orange, shadowOpacity: 0.55, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  coreIdle: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.28)' },
  inner: { alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 8 },
  label: { fontFamily: Fonts.black, textAlign: 'center', lineHeight: 18 },
  arc: { position: 'absolute', borderWidth: 3, borderColor: 'transparent', borderTopColor: '#FFD84D', borderRightColor: 'rgba(255,216,77,0.35)' },
});
