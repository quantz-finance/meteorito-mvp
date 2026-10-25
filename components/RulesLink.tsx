// Accesos a "Cómo funciona Meteorito" (/como-funciona): enlace con icono (Home, Mi cuenta) y resumen de una línea
// con "Ver reglas" (pago antes de pagar, Vender). Si no cabe (compact), solo el enlace.
import { router } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { haptic, Icon } from '@/components/ds';
import { C, S, T } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { BETA_NOTICE, BETA_NOTICE_LINK, CUSTODY_NOTICE, RULES_ROUTE } from '@/lib/rules';

/** Aviso legal (Neo): data-legal en web. constants/motion.ts LEGAL_CSS saca de toda animación de entrada al aviso y a
 *  cualquier contenedor que lo tenga dentro: nunca arranca en opacidad 0, ni sin JS ni si la animación falla o va lenta. */
export const legalMark: object = Platform.OS === 'web' ? { dataSet: { legal: '1' } } : {};

const open = (from: string, before?: () => void) => { haptic.tap(); before?.(); track('rules_opened', { from }); router.push(RULES_ROUTE); };

/** Enlace discreto pero visible: icono + "Cómo funciona". */
export function RulesLink({ from, onNavigate, center }: { from: string; onNavigate?: () => void; center?: boolean }) {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel="Cómo funciona Meteorito" testID="rules-link" hitSlop={8} {...legalMark}
      onPress={() => open(from, onNavigate)} style={({ pressed }) => [s.link, center && { alignSelf: 'center' }, pressed && { opacity: 0.7 }]}>
      <Icon name="help-circle-outline" size={18} color={C.lilac} />
      <Text style={[T.footnote, { color: C.lilac, fontFamily: T.headline.fontFamily }]}>Cómo funciona</Text>
    </Pressable>
  );
}

/** Resumen de una línea + "Ver reglas". compact = solo el enlace (pantallas sin espacio). */
export function RulesHint({ text, from, compact }: { text: string; from: string; compact?: boolean }) {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${compact ? 'Cómo funciona' : text} Ver reglas`} testID="rules-hint" hitSlop={6} {...legalMark}
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

/** Aviso de beta: footnote con icono de información, color tenue legible (C.textDim: AA sobre el fondo y las hojas)
 *  y enlace "Ver cómo funciona". onNavigate cierra la hoja (PIN, disputa) antes de navegar.
 *  custody: pie del producto antes de pagar, con CUSTODY_NOTICE (incluye la beta y "Meteorito no verifica el producto"). */
export function BetaNotice({ from, onNavigate, center, custody }: { from: string; onNavigate?: () => void; center?: boolean; custody?: boolean }) {
  return (
    <View style={[s.beta, center && { justifyContent: 'center' }]} testID="beta-notice" {...legalMark}>
      <Icon name="information-circle-outline" size={16} color={C.textDim} />
      <Text style={[T.footnote, { flexShrink: 1, color: C.textDim }, center && { textAlign: 'center' }]}>
        {custody ? CUSTODY_NOTICE : BETA_NOTICE}{' '}
        <Text accessibilityRole="link" onPress={() => open(`beta_${from}`, onNavigate)} style={{ color: C.lilac, textDecorationLine: 'underline' }}>{BETA_NOTICE_LINK}</Text>
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  beta: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingVertical: 4, alignSelf: 'flex-start' },
  hint: { flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: 28 },
});
