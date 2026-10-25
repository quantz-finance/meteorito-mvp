// Animación de entrada única de la app: fade + subida de 10 px, 280 ms ease-out, escalonada 40 ms entre bloques hermanos
// (tope: todo visible en ~0,5 s). Se repite cada vez que la pantalla toma el foco. Valores en lib/appearCore.
// Web: CSS (compositor, sin JS por frame; alternar el nombre de la animación la reinicia sin remontar nada).
// Nativo: Animated con useNativeDriver. Reducir movimiento: instantánea. Nunca bloquea toques (solo opacity/transform).
//  - <Screen> ya agrupa sus bloques (encabezado + cada hijo): no hace falta nada más en una pantalla simple.
//  - appearSub(cycle): en el contenedor del contenido para que SUS hijos también se escalonen.
//  - <Appear i>: un ítem suelto (p. ej. tarjetas de una grilla) con su índice.
//  - <AppearGroup>: pantallas sin <Screen> (chat, bienvenida).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';
import { APPEAR, appearCycle, appearDelay } from '@/lib/appearCore';

const WEB = Platform.OS === 'web';
type Cycle = 'a' | 'b';
const Ctx = createContext<Cycle>('a');

/** Ciclo de foco de la pantalla: cambia cada vez que vuelve a tomar el foco (la primera vez no: ya se está animando). */
export function useAppearCycle(): Cycle {
  const [n, setN] = useState(0);
  const first = useRef(true);
  useFocusEffect(useCallback(() => { if (first.current) { first.current = false; return; } setN((x) => x + 1); }, []));
  return appearCycle(n);
}
export const AppearProvider = Ctx.Provider;
export const useAppear = () => useContext(Ctx);

/** Props de un grupo raíz (web): cada hijo directo entra escalonado. */
export const appearRoot = (c: Cycle): object => (WEB ? { dataSet: { appear: c } } : {});
/** Props de un grupo anidado (web): el contenedor queda quieto y sus hijos entran escalonados, después del encabezado. */
export const appearSub = (c: Cycle): object => (WEB ? { dataSet: { appearSub: c } } : {});

/** Nativo: valor 0→1 que se reinicia en cada ciclo de foco. */
function useNativeEntry(c: Cycle, delay: number) {
  const reduce = useReducedMotion();
  const v = useRef(new Animated.Value(WEB || reduce ? 1 : 0)).current;
  useEffect(() => {
    if (WEB || reduce) { v.setValue(1); return; }
    v.setValue(0);
    const a = Animated.timing(v, { toValue: 1, duration: APPEAR.durationMs, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [c, reduce]);
  return { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [APPEAR.distancePx, 0] }) }] };
}

/** Ítem suelto con índice (grillas, listas). */
export function Appear({ i = 0, children, style, testID }: { i?: number; children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const c = useAppear();
  const native = useNativeEntry(c, appearDelay(i));
  const k = Math.min(Math.max(0, Math.floor(i)), APPEAR.maxSteps);
  return <Animated.View testID={testID} {...(WEB ? { dataSet: { appearItem: c, ai: String(k) } } : {})} style={[style, WEB ? null : native]}>{children}</Animated.View>;
}

/** Grupo para pantallas sin <Screen>: lleva su propio ciclo de foco. */
export function AppearGroup({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const c = useAppearCycle();
  return <AppearProvider value={c}><AppearBlock cycle={c} style={style} testID={testID}>{children}</AppearBlock></AppearProvider>;
}

/** Contenedor raíz: en web escalona sus hijos por CSS; en nativo entra como un bloque. */
export function AppearBlock({ cycle, children, style, testID }: { cycle: Cycle; children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const native = useNativeEntry(cycle, 0);
  return <Animated.View testID={testID} {...appearRoot(cycle)} style={[style, WEB ? null : native]}>{children}</Animated.View>;
}

/** Contenedor anidado: queda quieto y sus hijos entran escalonados (después del encabezado). Mismo estilo que un View. */
export function AppearSub({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const c = useAppear();
  return <View testID={testID} {...appearSub(c)} style={style}>{children}</View>;
}
/** Contenedor de ítems que entran solos (grilla, feed): él no se anima, así no se suma a la entrada de sus ítems. */
export const appearSkip: object = WEB ? { dataSet: { appearSkip: '1' } } : {};
/** Props de un ítem suelto (web) para poner directo en su View (sin envoltorio extra; p. ej. tarjetas del feed). */
export const appearItem = (c: Cycle, i: number): object => (WEB ? { dataSet: { appearItem: c, ai: String(Math.min(Math.max(0, Math.floor(i) || 0), APPEAR.maxSteps)) } } : {});
