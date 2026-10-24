// Señal SUTIL de "es de ejemplo" (productos y tiendas ficticios del feed, ventas cerradas de ejemplo): un iconito (i)
// chico, de bajo contraste, en una esquina; al tocarlo abre un popup chico que lo explica. Reemplaza las etiquetas
// "Ejemplo" y los avisos grandes (pedido del dueño: que no interfieran con la UI). Tocar el icono dentro de una tarjeta
// NO navega al producto (stopPropagation + el icono va fuera del Pressable de la tarjeta). Textos: COPY.demoProducts.
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import { haptic, Icon, PrimaryButton } from '@/components/ds';
import { C, R, S, T } from '@/constants/theme';
import { COPY } from '@/lib/copy';

type Kind = 'product' | 'store';
const copyFor = (kind: Kind) => (kind === 'store' ? COPY.demoProducts.storeInfo : COPY.demoProducts.info);

/** Solo el dibujo del iconito (sin acción), p. ej. en una tarjeta que ya abre su propia explicación al tocarla. */
export function DemoMark({ style, testID }: { style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <View style={[s.dot, style]} testID={testID} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Icon name="information-circle-outline" size={15} color={ICON} />
    </View>
  );
}

/** Iconito (i) tocable que abre el popup "Producto de ejemplo". `onDark`: sobre una foto (fondo translúcido). */
export function DemoInfo({ kind = 'product', style, onDark = true }: { kind?: Kind; style?: StyleProp<ViewStyle>; onDark?: boolean }) {
  const [open, setOpen] = useState(false);
  const c = copyFor(kind);
  const press = (e?: GestureResponderEvent) => {
    e?.stopPropagation?.(); (e as any)?.preventDefault?.();
    haptic.tap(); setOpen(true);
  };
  return (
    <>
      <Pressable testID="demo-info" accessibilityRole="button" accessibilityLabel={c.iconLabel} onPress={press} hitSlop={10}
        style={({ pressed }) => [s.dot, !onDark && s.dotPlain, style, pressed && { opacity: 0.6 }]}>
        <Icon name="information-circle-outline" size={15} color={ICON} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <View style={s.wrap}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel="Cerrar" />
          <View style={s.pop} testID="demo-info-popup" accessibilityViewIsModal>
            <View style={s.popIcon}><Icon name="information-circle-outline" size={22} color={C.lilac} /></View>
            <Text style={[T.headline, { textAlign: 'center' }]} accessibilityRole="header">{c.title}</Text>
            <Text style={[T.callout, { textAlign: 'center' }]}>{c.body}</Text>
            <PrimaryButton title={c.ok} variant="secondary" onPress={() => setOpen(false)} style={{ marginTop: S.xs }} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const ICON = 'rgba(255,255,255,0.72)';
const s = StyleSheet.create({
  // 22 px, translúcido: se ve sin tapar la foto. hitSlop lo deja cómodo de tocar (≈ 42 px).
  dot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(20,10,40,0.38)' },
  dotPlain: { backgroundColor: 'transparent' },
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: S.lg, backgroundColor: C.backdrop },
  pop: { width: '100%', maxWidth: 320, backgroundColor: C.surface, borderRadius: R.lg, padding: S.md + 4, gap: S.sm, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  popIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' },
});
