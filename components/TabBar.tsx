// Barra de pestañas flotante "vidrio espacial": píldora con indicador luminoso que se desliza (spring),
// íconos de trazo consistente (estilo lucide, SVG propio) y háptica en nativo.
// Accesible: objetivos >= 44pt, contraste >= 4.5:1, y sin deslizamiento/spring con "Reducir movimiento".
import type { Tabs } from 'expo-router';
type BottomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { haptic } from '@/components/ds';
import { Fonts } from '@/constants/Colors';
import { C, TOUCH } from '@/constants/theme';

const GREEN = '#3DDC97';
type IconP = { color: string; fill: string };
const P = { strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
export const TAB_ICONS: Record<string, (p: IconP) => React.ReactElement> = {
  index: ({ color, fill }) => <><Path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" stroke={color} {...P} fill={fill} /></>,
  vender: ({ color, fill }) => <><Path d="M12.6 2.6a2 2 0 0 0-1.4-.6H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z" stroke={color} {...P} fill={fill} /><Circle cx="7.5" cy="7.5" r="1.4" fill={color} /></>,
  pedidos: ({ color, fill }) => <><Path d="M11 21.7a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7z" stroke={color} {...P} fill={fill} /><Path d="M3.3 7 12 12l8.7-5M12 22V12" stroke={color} {...P} /></>,
  comprar: ({ color, fill }) => <><Path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" stroke={color} {...P} fill={fill} /><Path d="M3 6h18M16 10a4 4 0 0 1-8 0" stroke={color} {...P} /></>,
};

const BAR_H = 64, PAD = 6;

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const n = state.routes.length;
  const tabW = w ? (w - PAD * 2) / n : 0;
  const x = useSharedValue(0);
  useEffect(() => {
    const to = state.index * tabW;
    x.value = reduce || !tabW ? withTiming(to, { duration: 0 }) : withSpring(to, { damping: 18, stiffness: 220, mass: 0.7 });
  }, [state.index, tabW, reduce]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View pointerEvents="box-none" style={[s.wrap, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={s.bar} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityRole="tablist">
        {tabW > 0 && <Animated.View style={[s.pill, { width: tabW }, pill]}><View style={s.pillInner} /><View style={s.dot} /></Animated.View>}
        {state.routes.map((route, i) => {
          const focused = state.index === i;
          const { options } = descriptors[route.key];
          const label = String(options.title ?? route.name);
          const Ico = TAB_ICONS[route.name];
          const onPress = () => {
            const ev = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !ev.defaultPrevented) { haptic.tap(); navigation.navigate(route.name, route.params); }
          };
          return (
            <Pressable key={route.key} onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel={label}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })} style={s.tab} hitSlop={4}>
              <TabIcon focused={focused} reduce={reduce}>{Ico?.({ color: focused ? C.white : C.textDim, fill: focused ? 'rgba(201,182,255,0.28)' : 'none' })}</TabIcon>
              <Text style={[s.label, { color: focused ? C.white : C.textDim }]} numberOfLines={1}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function TabIcon({ focused, reduce, children }: { focused: boolean; reduce: boolean; children: React.ReactNode }) {
  const sc = useSharedValue(focused ? 1.12 : 1);
  useEffect(() => { sc.value = reduce ? withTiming(focused ? 1.12 : 1, { duration: 0 }) : withSpring(focused ? 1.12 : 1, { damping: 12, stiffness: 260 }); }, [focused, reduce]);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: sc.value }] }));
  return (
    <Animated.View style={[st, focused && s.iconGlow]}>
      <Svg width={24} height={24} viewBox="0 0 24 24">{children}</Svg>
    </Animated.View>
  );
}

const glass: any = Platform.OS === 'web'
  ? { backgroundColor: 'rgba(29,12,64,0.72)', backdropFilter: 'blur(20px) saturate(160%)', WebkitBackdropFilter: 'blur(20px) saturate(160%)' }
  : { backgroundColor: 'rgba(29,12,64,0.94)' };

const s = StyleSheet.create({
  wrap: { backgroundColor: C.bg, paddingTop: 8, alignItems: 'center', paddingHorizontal: 16 },
  bar: {
    ...glass, flexDirection: 'row', width: '100%', maxWidth: 440, height: BAR_H, padding: PAD, borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(201,182,255,0.28)',
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 16,
  },
  pill: { position: 'absolute', top: PAD, bottom: PAD, left: PAD, alignItems: 'center' },
  pillInner: {
    ...StyleSheet.absoluteFill, borderRadius: 999, backgroundColor: 'rgba(108,43,217,0.55)',
    borderWidth: 1, borderColor: 'rgba(201,182,255,0.45)',
    shadowColor: '#8B5CF6', shadowOpacity: 0.9, shadowRadius: 14, shadowOffset: { width: 0, height: 0 },
  },
  dot: { position: 'absolute', bottom: 3, width: 4, height: 4, borderRadius: 2, backgroundColor: GREEN, shadowColor: GREEN, shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  tab: { flex: 1, minHeight: Math.max(TOUCH, BAR_H - PAD * 2), alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { fontFamily: Fonts.bold, fontSize: 11, letterSpacing: 0.2 },
  iconGlow: Platform.OS === 'web' ? ({ filter: 'drop-shadow(0 0 6px rgba(196,181,253,0.9))' } as any) : { shadowColor: C.lilac, shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
});
