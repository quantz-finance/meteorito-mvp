// Componentes de UI estilo iOS fintech. Solo presentación: nada de lógica de negocio.
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useHoldUpdate } from '@/lib/updater';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View,
  type PressableProps, type StyleProp, type ViewStyle,
} from 'react-native';
import { useStableWindow } from '@/lib/viewport';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, R, S, T, TOUCH, BUTTON_H, shadow } from '@/constants/theme';
import { Fonts } from '@/constants/Colors';
import Reanimated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { moneyProgress } from '@/lib/progress';
import { anim, pressTransition } from '@/constants/motion';
import { BackButton, goBack } from '@/components/BackButton';
import type { Href } from 'expo-router';
import { MeteorBurst, ScrollCtx, SpaceBackground, type SpaceMode } from '@/components/space';

const WEB = Platform.OS === 'web';
export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export const Icon = ({ name, size = 22, color = C.text }: { name: IconName; size?: number; color?: string }) =>
  <Ionicons name={name} size={size} color={color} />;

/* ---------- Haptics (no-op en web) ---------- */
export const haptic = {
  tap: () => { if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); },
  success: () => { if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); },
  error: () => { if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}); },
};

/* ---------- Layout ---------- */
/** Pantalla con título grande iOS, safe area superior y footer fijo opcional (zona del pulgar). */
export function Screen({ title, subtitle, right, children, footer, scroll = true, refreshControl, contentStyle, space = 'full', back }: {
  /** Muestra el botón Volver arriba a la izquierda; el valor es a dónde ir si no hay historial. */
  back?: Href;
  title?: string; subtitle?: string; right?: ReactNode; children: ReactNode; footer?: ReactNode; scroll?: boolean; space?: SpaceMode;
  refreshControl?: React.ComponentProps<typeof ScrollView>['refreshControl']; contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => { scrollY.value = e.contentOffset.y; });
  // Con título, Volver va a la derecha (icono): el título empieza SIEMPRE en el mismo punto (arriba/izquierda) en todas
  // las pantallas, con o sin botones, y nada salta al cambiar de pestaña. Sin título, Volver queda arriba a la izquierda.
  const backBtn = back && !title ? <BackButton fallback={back} /> : null;
  const header = title ? <ScreenHeader title={title} subtitle={subtitle} right={right} back={back} /> : null;
  const body = scroll ? (
    <Reanimated.ScrollView style={{ flex: 1 }} contentContainerStyle={[st.content, { paddingTop: insets.top + S.md }, contentStyle]}
      keyboardShouldPersistTaps="handled" refreshControl={refreshControl} showsVerticalScrollIndicator={false}
      onScroll={onScroll} scrollEventThrottle={16}>
      <View {...anim('enter')} style={{ gap: S.lg }}>{backBtn}{header}{children}</View>
    </Reanimated.ScrollView>
  ) : <View style={[st.content, { flex: 1, paddingTop: insets.top + S.md, paddingBottom: S.sm }, contentStyle]}><View {...anim('enter')} style={{ flex: 1, gap: S.lg }}>{backBtn}{header}{children}</View></View>;
  return (
    <ScrollCtx.Provider value={scrollY}>
      <View style={st.screen}>
        <SpaceBackground mode={space} scrollY={scrollY} />
        {body}
        {footer ? <StickyFooter>{footer}</StickyFooter> : null}
      </View>
    </ScrollCtx.Provider>
  );
}

/** Encabezado compartido: fila de alto fijo (TOUCH) con el título arriba a la izquierda y acciones a la derecha. */
export function ScreenHeader({ title, subtitle, right, back }: { title: string; subtitle?: string; right?: ReactNode; back?: Href }) {
  return (
    <View style={{ gap: S.xs }}>
      <View style={st.header}>
        <Text style={[T.largeTitle, st.headerTitle]} numberOfLines={2} accessibilityRole="header" testID="screen-title">{title}</Text>
        {right || back ? <View style={st.headerRight}>{right}{back ? <IconButton icon="close" label="Volver" onPress={() => goBack(back)} /> : null}</View> : null}
      </View>
      {subtitle ? <Text style={T.callout}>{subtitle}</Text> : null}
    </View>
  );
}

export function StickyFooter({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return <View style={[st.footer, { paddingBottom: Math.max(insets.bottom, S.md) }]}>{children}</View>;
}

export function Card({ children, style, onPress, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string }) {
  if (!onPress) return <View style={[st.card, style]}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={() => { haptic.tap(); onPress(); }}
      style={({ pressed }) => [st.card, style, pressTransition, pressed && st.pressed]}>
      {children}
    </Pressable>
  );
}

export function Section({ title, action, children, style }: { title: string; action?: ReactNode; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: S.sm }, style]}>
      <View style={st.rowBetween}><Text style={T.caption}>{title}</Text>{action}</View>
      {children}
    </View>
  );
}

/* ---------- Botones ---------- */
type BtnVariant = 'primary' | 'secondary' | 'ghost';
export function PrimaryButton({ title, icon, variant = 'primary', loading, disabled, onPress, ...p }:
  Omit<PressableProps, 'children'> & { title: string; icon?: IconName; variant?: BtnVariant; loading?: boolean }) {
  const fg = variant === 'primary' ? C.purple : C.lilac;
  return (
    <Pressable {...p} accessibilityRole="button" accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      disabled={disabled || loading}
      onPress={(e) => { haptic.tap(); onPress?.(e); }}
      style={({ pressed }) => [st.btn, variant === 'secondary' && st.btnSecondary, variant === 'ghost' && st.btnGhost,
        (disabled && !loading) && { opacity: 0.4 }, pressTransition, pressed && st.pressed]}>
      {loading ? <ActivityIndicator color={fg} /> : <>
        {icon ? <Icon name={icon} size={20} color={fg} /> : null}
        <Text style={[st.btnText, { color: fg }]}>{title}</Text>
      </>}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label }: { icon: IconName; onPress: () => void; label: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => { haptic.tap(); onPress(); }} hitSlop={8}
      style={({ pressed }) => [st.iconBtn, pressTransition, pressed && st.pressed]}>
      <Icon name={icon} size={22} color={C.lilac} />
    </Pressable>
  );
}

/* ---------- Chips ---------- */
/** swap: anima el cambio (usar con key={valor} para que re-anime cuando llega un update). */
export function Chip({ label, tone = 'lilac', icon, swap }: { label: string; tone?: 'lilac' | 'success' | 'warn' | 'muted'; icon?: IconName; swap?: boolean }) {
  const map = { lilac: [C.lilacBg, C.lilac], success: [C.successBg, C.success], warn: [C.warnBg, C.orange], muted: ['rgba(255,255,255,0.06)', C.textDim] } as const;
  const [bg, fg] = map[tone];
  return (
    <View {...(swap ? anim('swap') : {})} style={[st.chip, { backgroundColor: bg }]}>
      {icon ? <Icon name={icon} size={12} color={fg} /> : null}
      <Text style={[st.chipText, { color: fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

/** Pastilla discreta de red de pruebas. */

/* ---------- Skeleton ---------- */
export function Skeleton({ w = '100%', h = 16, r = R.sm, style }: { w?: number | `${number}%`; h?: number; r?: number; style?: StyleProp<ViewStyle> }) {
  if (Platform.OS === 'web') return <View {...anim('skeleton')} style={[{ width: w, height: h, borderRadius: r, backgroundColor: C.surface2 }, style]} />;
  return <SkeletonNative w={w} h={h} r={r} style={style} />;
}
function SkeletonNative({ w, h, r, style }: { w: number | `${number}%`; h: number; r: number; style?: StyleProp<ViewStyle> }) {
  const o = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(o, { toValue: 0.9, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(o, { toValue: 0.4, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
    ]));
    a.start(); return () => a.stop();
  }, [o]);
  return <Animated.View style={[{ width: w, height: h, borderRadius: r, backgroundColor: C.surface2, opacity: o }, style]} />;
}

export function SkeletonCard() {
  return <Card style={{ gap: S.sm }}><Skeleton w="60%" h={20} /><Skeleton w="40%" /><Skeleton h={8} r={4} style={{ marginTop: S.sm }} /></Card>;
}

/* ---------- Bottom sheet ---------- */
export function Sheet({ visible, onClose, title, children, footer, page }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode; footer?: ReactNode; /** Pantalla completa con el mismo encabezado que Screen (p. ej. Mi cuenta). */ page?: boolean }) {
  useHoldUpdate(visible); // con una hoja abierta (formulario, pago, disputa) la app no se recarga por actualización
  const insets = useSafeAreaInsets();
  if (page) return (
    <Modal visible={visible} transparent animationType={WEB ? 'none' : 'slide'} onRequestClose={onClose} statusBarTranslucent>
      <View {...anim('fade')} style={st.screen}>
        <SpaceBackground mode="calm" />
        <View style={[st.content, { flex: 1, paddingTop: insets.top + S.md, paddingBottom: S.sm }]}>
          <View style={{ flex: 1, gap: S.lg }}>
            <ScreenHeader title={title ?? ''} right={<IconButton icon="close" label="Cerrar" onPress={onClose} />} />
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: S.md, paddingBottom: S.md }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView>
          </View>
        </View>
        {footer ? <StickyFooter>{footer}</StickyFooter> : null}
      </View>
    </Modal>
  );
  // La hoja nunca supera la pantalla (iPhone SE 568 px): título y botón cerrar siempre visibles, el contenido hace scroll.
  const { height } = useStableWindow();
  const maxH = Math.min(height - insets.top - S.md, 760);
  return (
    <Modal visible={visible} transparent animationType={WEB ? 'none' : 'slide'} onRequestClose={onClose} statusBarTranslucent>
      <View {...anim('fade')} style={st.sheetWrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Cerrar" />
        <View {...anim('sheet')} style={[st.sheet, { paddingBottom: Math.max(insets.bottom, S.md), maxHeight: maxH }]}>
          <View style={st.grabber} />
          {title ? <View style={[st.rowBetween, { marginBottom: S.md }]}>
            <Text style={T.title}>{title}</Text>
            <IconButton icon="close" label="Cerrar" onPress={onClose} />
          </View> : null}
          <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ gap: S.md }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          {footer ? <View style={{ marginTop: S.md, gap: S.sm }}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

/* ---------- Éxito animado ---------- */
/** celebrate: meteorito de una pasada. Usar SOLO tras respuesta exitosa de una operación on-chain. */
export function SuccessCheck({ size = 88, celebrate = false }: { size?: number; celebrate?: boolean }) {
  const sc = useRef(new Animated.Value(WEB ? 1 : 0)).current;
  useEffect(() => {
    haptic.success();
    if (!WEB) Animated.spring(sc, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }).start();
  }, [sc]);
  const check = (
    <Animated.View {...anim('pop')} style={{ alignSelf: 'center', width: size, height: size, borderRadius: size / 2, backgroundColor: C.success,
      alignItems: 'center', justifyContent: 'center', transform: [{ scale: sc }] }}>
      <View {...anim('check')}><Icon name="checkmark" size={size * 0.55} color={C.purpleDark} /></View>
    </Animated.View>
  );
  if (!celebrate) return check;
  return (
    <View style={{ alignSelf: 'stretch', alignItems: 'center' }}>
      <MeteorBurst height={size * 1.6} />
      <View style={{ width: size, height: size, alignSelf: 'center' }}>
        {check}
        {WEB ? <View {...anim('confetti')} style={StyleSheet.absoluteFill}>{Array.from({ length: 14 }, (_, i) => <View key={i} />)}</View> : null}
      </View>
    </View>
  );
}

/* ---------- Estado del dinero: 4 pasos ---------- */
export const MONEY_STEPS: { key: string; label: string; icon: IconName }[] = [
  { key: 'pagado', label: 'Pagado', icon: 'lock-closed' },
  { key: 'enviado', label: 'Enviado', icon: 'paper-plane' },
  { key: 'entregado', label: 'Entregado', icon: 'cube' },
  { key: 'liberado', label: 'Liberado', icon: 'cash' },
];
export { moneyProgress };
export function statusTone(status: string): 'lilac' | 'success' | 'warn' | 'muted' {
  if (status === 'liberado' || status === 'resuelto') return 'success';
  if (status === 'en_disputa' || status === 'cancelado') return 'warn';
  if (status === 'creado' || status === 'escrow_creado') return 'muted';
  return 'lilac';
}

export function MoneyTimeline({ status, compact, shipped }: { status: string; compact?: boolean; shipped?: boolean }) {
  const done = moneyProgress(status, shipped);
  const dispute = status === 'en_disputa';
  const note = dispute ? <View style={st.disputeNote}><Icon name="alert-circle" size={18} color={C.orange} /><Text style={[T.footnote, { color: C.orange, flex: 1 }]}>Lo estamos revisando, respondemos en 24-48h.</Text></View> : null;
  const dot = compact ? 24 : 32;
  return (
    <View style={{ gap: S.sm }}>
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }} accessibilityLabel={`Estado del pago: ${done} de 4 pasos`}>
      {MONEY_STEPS.map((s, i) => {
        const isDone = i < done;
        const isNext = i === done && done > 0 && !dispute; // antes del pago nada está "en curso"
        const isProblem = dispute && i === done;
        const color = isProblem ? C.orange : isDone ? C.success : isNext ? C.lilac : C.surface2;
        const fg = isDone || isProblem ? C.purpleDark : isNext ? C.purpleDark : C.textDim;
        return (
          <View key={s.key} style={{ flex: 1, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
              <TlLine hidden={i === 0} on={i <= done} />
              <View style={{ width: dot, height: dot }}>
                {isNext ? <View {...anim('ring')} style={[StyleSheet.absoluteFill, { borderRadius: dot / 2, backgroundColor: C.lilac }]} /> : null}
                <View key={`${s.key}-${isDone}-${isProblem}`} {...(isDone || isProblem ? anim('pop') : {})}
                  style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={isProblem ? 'alert' : isDone ? 'checkmark' : s.icon} size={dot * 0.5} color={fg} />
                </View>
              </View>
              <TlLine hidden={i === 3} on={i < done} />
            </View>
            <Text style={[st.tlLabel, { color: isDone ? C.text : isNext || isProblem ? (isProblem ? C.orange : C.lilac) : C.textDim }]}
              numberOfLines={1}>{isProblem ? 'En disputa' : s.label}</Text>
          </View>
        );
      })}
    </View>
    {note}
    </View>
  );
}

/** Segmento del timeline: el relleno verde avanza con scaleX (GPU) cuando el paso se completa. */
function TlLine({ hidden, on }: { hidden: boolean; on: boolean }) {
  if (hidden) return <View style={st.tlLine} />;
  return (
    <View style={[st.tlLine, { backgroundColor: C.surface2, overflow: 'hidden' }]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: C.success, transform: [{ scaleX: on ? 1 : 0 }], transformOrigin: 'left' } as ViewStyle,
        WEB ? ({ transitionProperty: 'transform', transitionDuration: '320ms', transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' } as object) : null]} />
    </View>
  );
}

/* ---------- Toast ---------- */
type ToastMsg = { id: number; text: string; tone: 'ok' | 'info' };
let toastListener: ((m: ToastMsg | null) => void) | null = null;
let toastSeq = 0;
/** Toast suave (2.4 s). Requiere <ToastHost /> montado en el layout raíz. */
export function toast(text: string, tone: 'ok' | 'info' = 'ok') { toastListener?.({ id: ++toastSeq, text, tone }); }
export function ToastHost() {
  const [m, setM] = useState<ToastMsg | null>(null);
  const insets = useSafeAreaInsets();
  useEffect(() => { toastListener = setM; return () => { toastListener = null; }; }, []);
  useEffect(() => { if (!m) return; const t = setTimeout(() => setM(null), 2400); return () => clearTimeout(t); }, [m]);
  if (!m) return null;
  return (
    <View pointerEvents="none" style={[st.toastWrap, { top: insets.top + S.sm }]}>
      <View key={m.id} {...anim('toast')} accessibilityLiveRegion="polite" style={st.toast}>
        <Icon name={m.tone === 'ok' ? 'checkmark-circle' : 'sync'} size={18} color={m.tone === 'ok' ? C.success : C.lilac} />
        <Text style={[T.footnote, { color: C.text, fontSize: 14 }]}>{m.text}</Text>
      </View>
    </View>
  );
}

/* ---------- Lista ---------- */
export function ListRow({ icon, title, subtitle, right, onPress }: { icon?: IconName; title: string; subtitle?: string; right?: ReactNode; onPress?: () => void }) {
  const inner = <>
    {icon ? <View style={st.rowIcon}><Icon name={icon} size={20} color={C.lilac} /></View> : null}
    <View style={{ flex: 1 }}>
      <Text style={T.headline} numberOfLines={1}>{title}</Text>
      {subtitle ? <Text style={T.footnote} numberOfLines={2}>{subtitle}</Text> : null}
    </View>
    {right}
  </>;
  if (!onPress) return <View style={st.listRow}>{inner}</View>;
  return <Pressable onPress={() => { haptic.tap(); onPress(); }} style={({ pressed }) => [st.listRow, pressTransition, pressed && st.pressed]}>{inner}</Pressable>;
}

export const ErrorText = ({ children }: { children: ReactNode }) =>
  <View style={st.errorBox}><Icon name="alert-circle" size={18} color={C.orange} /><Text style={[T.footnote, { color: C.orange, flex: 1 }]}>{children}</Text></View>;

export const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: S.md, paddingBottom: S.xxxl, gap: S.lg, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: S.sm, minHeight: TOUCH },
  headerTitle: { flex: 1, paddingTop: (TOUCH - 34) / 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: S.sm, height: TOUCH },
  footer: { paddingHorizontal: S.md, paddingTop: S.md, backgroundColor: C.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, gap: S.sm },
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: S.md, gap: S.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm },
  btn: { minHeight: BUTTON_H, borderRadius: R.md, backgroundColor: C.white, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.sm, paddingHorizontal: S.lg, width: '100%', maxWidth: 560, alignSelf: 'center' },
  btnSecondary: { backgroundColor: C.lilacBg },
  btnGhost: { backgroundColor: 'transparent', minHeight: TOUCH },
  btnText: { fontFamily: Fonts.bold, fontSize: 16 },
  iconBtn: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' },
  disputeNote: { flexDirection: 'row', gap: S.sm, alignItems: 'center', backgroundColor: C.warnBg, borderRadius: R.sm, padding: S.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: S.xs, borderRadius: R.pill, paddingHorizontal: S.sm + 2, paddingVertical: S.xs, alignSelf: 'flex-start' },
  chipText: { fontFamily: Fonts.bold, fontSize: 12 },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: C.backdrop },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg, paddingHorizontal: S.md, paddingTop: S.sm, width: '100%', maxWidth: 600, alignSelf: 'center', ...shadow },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: C.surface2, marginBottom: S.md },
  tlLine: { flex: 1, height: 3, borderRadius: 2 },
  pressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },
  toastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: S.md },
  toast: { flexDirection: 'row', alignItems: 'center', gap: S.sm, backgroundColor: C.surface, borderRadius: R.pill, paddingHorizontal: S.md, paddingVertical: S.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, maxWidth: 440, ...shadow },
  tlLabel: { fontFamily: Fonts.bold, fontSize: 11, marginTop: S.xs },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: S.md, minHeight: TOUCH + S.md, paddingVertical: S.sm },
  rowIcon: { width: 40, height: 40, borderRadius: R.sm + 4, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' },
  errorBox: { flexDirection: 'row', gap: S.sm, alignItems: 'flex-start', backgroundColor: C.warnBg, borderRadius: R.sm + 4, padding: S.sm + 4 },
});
