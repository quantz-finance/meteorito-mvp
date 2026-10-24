// Accesos a "Cómo funciona Meteorito" (/como-funciona): enlace con icono (Home, Mi cuenta) y resumen de una línea
// con "Ver reglas" (pago antes de pagar, Vender). Si no cabe (compact), solo el enlace.
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { haptic, Icon } from '@/components/ds';
import { C, S, T } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { RULES_ROUTE } from '@/lib/rules';

const open = (from: string, before?: () => void) => { haptic.tap(); before?.(); track('rules_opened', { from }); router.push(RULES_ROUTE); };

/** Enlace discreto pero visible: icono + "Cómo funciona". */
export function RulesLink({ from, onNavigate, center }: { from: string; onNavigate?: () => void; center?: boolean }) {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel="Cómo funciona Meteorito" testID="rules-link" hitSlop={8}
      onPress={() => open(from, onNavigate)} style={({ pressed }) => [s.link, center && { alignSelf: 'center' }, pressed && { opacity: 0.7 }]}>
      <Icon name="help-circle-outline" size={18} color={C.lilac} />
      <Text style={[T.footnote, { color: C.lilac, fontFamily: T.headline.fontFamily }]}>Cómo funciona</Text>
    </Pressable>
  );
}

/** Resumen de una línea + "Ver reglas". compact = solo el enlace (pantallas sin espacio). */
export function RulesHint({ text, from, compact }: { text: string; from: string; compact?: boolean }) {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${compact ? 'Cómo funciona' : text} Ver reglas`} testID="rules-hint" hitSlop={6}
      onPress={() => open(from)} style={({ pressed }) => [s.hint, pressed && { opacity: 0.7 }]}>
      <Icon name="lock-closed" size={14} color={C.lilac} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={T.footnote} numberOfLines={2}>
          {compact ? null : <>{text} </>}
          <Text style={{ color: C.lilac, textDecorationLine: 'underline' }}>Ver reglas</Text>
        </Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingVertical: 4, alignSelf: 'flex-start' },
  hint: { flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: 28 },
});
