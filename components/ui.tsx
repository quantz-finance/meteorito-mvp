// Compat: estilos y Button heredados, ahora sobre el design system (constants/theme + components/ds).
import { StyleSheet, type PressableProps } from 'react-native';
import { Fonts } from '@/constants/Colors';
import { C, R, S, TOUCH } from '@/constants/theme';
import { PrimaryButton } from './ds';

export function Button({ title, variant = 'primary', ...p }: Omit<PressableProps, 'children'> & { title: string; variant?: 'primary' | 'outline' }) {
  return <PrimaryButton {...p} title={title} variant={variant === 'outline' ? 'secondary' : 'primary'} />;
}

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: S.md, gap: S.md, paddingBottom: S.xxxl },
  h1: { fontFamily: Fonts.black, fontSize: 28, color: C.text },
  label: { fontFamily: Fonts.bold, fontSize: 12, color: C.textDim, textTransform: 'uppercase', letterSpacing: 0.6 },
  text: { fontFamily: Fonts.regular, fontSize: 16, lineHeight: 24, color: C.text },
  muted: { fontFamily: Fonts.regular, fontSize: 14, lineHeight: 20, color: C.textDim },
  error: { fontFamily: Fonts.bold, fontSize: 14, color: C.orange },
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: S.md, gap: S.sm },
  input: { backgroundColor: C.surface, borderRadius: R.md, paddingHorizontal: S.md, minHeight: TOUCH + 8, color: C.text, fontFamily: Fonts.regular, fontSize: 17, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  chip: { borderRadius: R.pill, borderWidth: 1, borderColor: C.lilac, paddingHorizontal: S.md, minHeight: TOUCH, justifyContent: 'center' },
  chipOn: { backgroundColor: C.lilac },
  chipText: { fontFamily: Fonts.bold, color: C.lilac },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
});
