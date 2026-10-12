import { Pressable, StyleSheet, Text, type PressableProps } from 'react-native';
import { Brand, Fonts } from '@/constants/Colors';

export function Button({ title, variant = 'primary', disabled, ...p }: PressableProps & { title: string; variant?: 'primary' | 'outline' }) {
  return (
    <Pressable {...p} disabled={disabled}
      style={({ pressed }) => [ui.btn, variant === 'outline' && ui.outline, (pressed || disabled) && { opacity: disabled ? 0.45 : 0.8 }]}>
      <Text style={[ui.btnText, variant === 'outline' && { color: Brand.lilac }]}>{title}</Text>
    </Pressable>
  );
}

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Brand.purpleDark },
  content: { padding: 20, gap: 14, paddingBottom: 48 },
  h1: { fontFamily: Fonts.black, fontSize: 26, color: Brand.white },
  label: { fontFamily: Fonts.bold, fontSize: 13, color: Brand.muted, textTransform: 'uppercase' },
  text: { fontFamily: Fonts.regular, fontSize: 16, color: Brand.white },
  muted: { fontFamily: Fonts.regular, fontSize: 14, color: Brand.muted },
  error: { fontFamily: Fonts.bold, fontSize: 14, color: Brand.orange },
  card: { backgroundColor: Brand.purpleMid, borderRadius: 18, padding: 16, gap: 8 },
  input: { backgroundColor: Brand.purpleMid, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: Brand.white, fontFamily: Fonts.regular, fontSize: 16 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: Brand.lilac, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { backgroundColor: Brand.lilac },
  chipText: { fontFamily: Fonts.bold, color: Brand.lilac },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btn: { backgroundColor: Brand.white, borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
  outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Brand.lilac },
  btnText: { fontFamily: Fonts.bold, fontSize: 17, color: Brand.purple },
});
