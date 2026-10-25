// "Modo de la app" (Mi cuenta, cualquier cuenta; lib/demoPref.ts): Datos de ejemplo / Testnet / Mainnet (Próximamente,
// visible pero desactivado). Cada persona en su dispositivo: no afecta a nadie más. Default: Testnet (solo reales).
// El modo SOLO decide si se ven los ejemplos: no cambia la red, los escrows ni el pago. Accesible: radiogroup + radio.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, haptic, Icon } from '@/components/ds';
import { pressTransition } from '@/constants/motion';
import { C, R, S, T } from '@/constants/theme';
import { COPY } from '@/lib/copy';
import { setAppMode, SELECTABLE_MODES, useAppMode, type AppMode } from '@/lib/demoPref';

const OPTIONS: { id: AppMode; label: string }[] = [
  { id: 'ejemplos', label: COPY.appMode.ejemplos }, { id: 'testnet', label: COPY.appMode.testnet }, { id: 'mainnet', label: COPY.appMode.mainnet },
];

export function AppModePicker() {
  const mode = useAppMode();
  return (
    <Card testID="app-mode" style={{ gap: S.xs }}>
      <Text style={T.headline} nativeID="app-mode-label">{COPY.appMode.label}</Text>
      <View accessibilityRole="radiogroup" aria-labelledby="app-mode-label" accessibilityLabel={COPY.appMode.label} style={{ gap: S.xs }}>
        {OPTIONS.map((o) => {
          const on = o.id === mode; const off = !SELECTABLE_MODES.includes(o.id);
          return (
            <Pressable key={o.id} testID={`app-mode-${o.id}`} accessibilityRole="radio" accessibilityState={{ checked: on, disabled: off }} aria-checked={on} aria-disabled={off}
              accessibilityLabel={off ? `${o.label}, ${COPY.appMode.soon}` : o.label} disabled={off}
              onPress={() => { if (off || on) return; haptic.tap(); setAppMode(o.id); }}
              style={({ pressed }) => [s.opt, on && s.optOn, off && { opacity: 0.55 }, pressTransition, pressed && !off && { opacity: 0.85 }]}>
              <Icon name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? C.purple : C.textDim} />
              <Text style={[T.body, { flex: 1, color: off ? C.textDim : C.text }]} numberOfLines={1}>{o.label}</Text>
              {off ? <Text style={s.soon}>{COPY.appMode.soon}</Text> : null}
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  opt: { flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: 44, paddingHorizontal: S.sm, borderRadius: R.md, borderWidth: 1, borderColor: 'transparent' },
  optOn: { borderColor: C.purple, backgroundColor: C.surface2 },
  soon: { ...T.footnote, color: C.textDim, flexShrink: 0 },
});
