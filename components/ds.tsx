// Componentes de UI estilo iOS fintech. Solo presentación: nada de lógica de negocio.
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator, Animated, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View,
  type PressableProps, type StyleProp, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, R, S, T, TOUCH, BUTTON_H, shadow } from '@/constants/theme';
import { Fonts } from '@/constants/Colors';

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
export function Screen({ title, subtitle, right, children, footer, scroll = true, refreshControl, contentStyle }: {
  title?: string; subtitle?: string; right?: ReactNode; children: ReactNode; footer?: ReactNode; scroll?: boolean;
  refreshControl?: React.ComponentProps<typeof ScrollView>['refreshControl']; contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const header = title ? (
    <View style={st.header}>
      <View style={{ flex: 1 }}>
        <Text style={T.largeTitle} accessibilityRole="header">{title}</Text>
        {subtitle ? <Text style={[T.callout, { marginTop: S.xs }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  ) : null;
  const body = scroll ? (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={[st.content, { paddingTop: insets.top + S.md }, contentStyle]}
      keyboardShouldPersistTaps="handled" refreshControl={refreshControl} showsVerticalScrollIndicator={false}>
      {header}{children}
    </ScrollView>
  ) : <View style={[st.content, { flex: 1, paddingTop: insets.top + S.md }, contentStyle]}>{header}{children}</View>;
  return (
    <View style={st.screen}>
      {body}
      {footer ? <StickyFooter>{footer}</StickyFooter> : null}
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
      style={({ pressed }) => [st.card, style, pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] }]}>
      {children}
    </Pressable>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: S.sm }}>
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
        (disabled && !loading) && { opacity: 0.4 }, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
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
      style={({ pressed }) => [st.iconBtn, pressed && { opacity: 0.7 }]}>
      <Icon name={icon} size={22} color={C.lilac} />
    </Pressable>
  );
}

/* ---------- Chips ---------- */
export function Chip({ label, tone = 'lilac', icon }: { label: string; tone?: 'lilac' | 'success' | 'warn' | 'muted'; icon?: IconName }) {
  const map = { lilac: [C.lilacBg, C.lilac], success: [C.successBg, C.success], warn: [C.warnBg, C.orange], muted: ['rgba(255,255,255,0.06)', C.textDim] } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[st.chip, { backgroundColor: bg }]}>
      {icon ? <Icon name={icon} size={12} color={fg} /> : null}
      <Text style={[st.chipText, { color: fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

/** Pastilla discreta de red de pruebas. */
export const TestnetPill = () => <Chip label="Modo prueba" tone="muted" icon="flask-outline" />;

/* ---------- Skeleton ---------- */
export function Skeleton({ w = '100%', h = 16, r = R.sm, style }: { w?: number | `${number}%`; h?: number; r?: number; style?: StyleProp<ViewStyle> }) {
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
export function Sheet({ visible, onClose, title, children, footer }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode; footer?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={st.sheetWrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Cerrar" />
        <View style={[st.sheet, { paddingBottom: Math.max(insets.bottom, S.md) }]}>
          <View style={st.grabber} />
          {title ? <View style={[st.rowBetween, { marginBottom: S.md }]}>
            <Text style={T.title}>{title}</Text>
            <IconButton icon="close" label="Cerrar" onPress={onClose} />
          </View> : null}
          <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ gap: S.md }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          {footer ? <View style={{ marginTop: S.md, gap: S.sm }}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

/* ---------- Éxito animado ---------- */
export function SuccessCheck({ size = 88 }: { size?: number }) {
  const sc = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    haptic.success();
    Animated.spring(sc, { toValue: 1, friction: 5, tension: 120, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [sc]);
  return (
    <Animated.View style={{ alignSelf: 'center', width: size, height: size, borderRadius: size / 2, backgroundColor: C.success,
      alignItems: 'center', justifyContent: 'center', transform: [{ scale: sc }] }}>
      <Icon name="checkmark" size={size * 0.55} color={C.purpleDark} />
    </Animated.View>
  );
}

/* ---------- Estado del dinero: 4 pasos ---------- */
export const MONEY_STEPS: { key: string; label: string; icon: IconName }[] = [
  { key: 'pagado', label: 'Pagado', icon: 'lock-closed' },
  { key: 'enviado', label: 'Enviado', icon: 'paper-plane' },
  { key: 'entregado', label: 'Entregado', icon: 'cube' },
  { key: 'liberado', label: 'Liberado', icon: 'cash' },
];
/** Cuántos pasos del dinero están completos según el status del pedido. */
export function moneyProgress(status: string): number {
  switch (status) {
    case 'fondeado': return 1;
    case 'enviado': case 'en_disputa': return 2;
    case 'entregado': return 3;
    case 'liberado': case 'resuelto': return 4;
    default: return 0;
  }
}
export function statusTone(status: string): 'lilac' | 'success' | 'warn' | 'muted' {
  if (status === 'liberado' || status === 'resuelto') return 'success';
  if (status === 'en_disputa' || status === 'cancelado') return 'warn';
  if (status === 'creado' || status === 'escrow_creado') return 'muted';
  return 'lilac';
}

export function MoneyTimeline({ status, compact }: { status: string; compact?: boolean }) {
  const done = moneyProgress(status);
  const dispute = status === 'en_disputa';
  const dot = compact ? 24 : 32;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }} accessibilityLabel={`Estado del pago: ${done} de 4 pasos`}>
      {MONEY_STEPS.map((s, i) => {
        const isDone = i < done;
        const isNext = i === done && !dispute;
        const isProblem = dispute && i === done;
        const color = isProblem ? C.orange : isDone ? C.success : isNext ? C.lilac : C.surface2;
        const fg = isDone || isProblem ? C.purpleDark : isNext ? C.purpleDark : C.textDim;
        return (
          <View key={s.key} style={{ flex: 1, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
              <View style={[st.tlLine, { backgroundColor: i === 0 ? 'transparent' : i <= done ? C.success : C.surface2 }]} />
              <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={isProblem ? 'alert' : isDone ? 'checkmark' : s.icon} size={dot * 0.5} color={fg} />
              </View>
              <View style={[st.tlLine, { backgroundColor: i === 3 ? 'transparent' : i < done ? C.success : C.surface2 }]} />
            </View>
            <Text style={[st.tlLabel, { color: isDone ? C.text : isNext || isProblem ? (isProblem ? C.orange : C.lilac) : C.textDim }]}
              numberOfLines={1}>{isProblem ? 'Revisión' : s.label}</Text>
          </View>
        );
      })}
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
  return <Pressable onPress={() => { haptic.tap(); onPress(); }} style={({ pressed }) => [st.listRow, pressed && { opacity: 0.7 }]}>{inner}</Pressable>;
}

export const ErrorText = ({ children }: { children: ReactNode }) =>
  <View style={st.errorBox}><Icon name="alert-circle" size={18} color={C.orange} /><Text style={[T.footnote, { color: C.orange, flex: 1 }]}>{children}</Text></View>;

export const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: S.md, paddingBottom: S.xxxl, gap: S.lg, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: S.sm, marginBottom: S.xs },
  footer: { paddingHorizontal: S.md, paddingTop: S.md, backgroundColor: C.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, gap: S.sm },
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: S.md, gap: S.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm },
  btn: { minHeight: BUTTON_H, borderRadius: R.md, backgroundColor: C.white, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.sm, paddingHorizontal: S.lg, width: '100%', maxWidth: 560, alignSelf: 'center' },
  btnSecondary: { backgroundColor: C.lilacBg },
  btnGhost: { backgroundColor: 'transparent', minHeight: TOUCH },
  btnText: { fontFamily: Fonts.bold, fontSize: 17 },
  iconBtn: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: S.xs, borderRadius: R.pill, paddingHorizontal: S.sm + 2, paddingVertical: S.xs, alignSelf: 'flex-start' },
  chipText: { fontFamily: Fonts.bold, fontSize: 12 },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: C.backdrop },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg, paddingHorizontal: S.md, paddingTop: S.sm, width: '100%', maxWidth: 600, alignSelf: 'center', ...shadow },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: C.surface2, marginBottom: S.md },
  tlLine: { flex: 1, height: 3, borderRadius: 2 },
  tlLabel: { fontFamily: Fonts.bold, fontSize: 11, marginTop: S.xs },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: S.md, minHeight: TOUCH + S.md, paddingVertical: S.sm },
  rowIcon: { width: 40, height: 40, borderRadius: R.sm + 4, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' },
  errorBox: { flexDirection: 'row', gap: S.sm, alignItems: 'flex-start', backgroundColor: C.warnBg, borderRadius: R.sm + 4, padding: S.sm + 4 },
});
