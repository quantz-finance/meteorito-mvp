import { StyleSheet, Text, View } from 'react-native';
import { Brand, Fonts } from '@/constants/Colors';

export default function EmptyTab({ title, text }: { title: string; text: string }) {
  return (
    <View style={s.root}>
      <Text style={s.title}>{title}</Text>
      <Text style={s.text}>{text}</Text>
      <Text style={s.soon}>Próximamente</Text>
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.purpleDark, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontFamily: Fonts.black, fontSize: 28, color: Brand.white },
  text: { fontFamily: Fonts.regular, fontSize: 16, color: Brand.lilac, textAlign: 'center', marginTop: 8 },
  soon: { fontFamily: Fonts.bold, fontSize: 13, color: Brand.orange, marginTop: 16 },
});
