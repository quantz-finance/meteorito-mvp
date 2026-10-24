// "Cómo funciona Meteorito": las reglas en lenguaje simple. Pública: funciona sin cuenta (los compradores no tienen).
// El contenido vive en lib/rules.ts (un solo lugar).
import { StyleSheet, Text, View } from 'react-native';
import { Card, Icon, PrimaryButton, Screen } from '@/components/ds';
import { C, S, T } from '@/constants/theme';
import { RULES, RULES_INTRO, RULES_TITLE, TOUR } from '@/lib/rules';

export default function ComoFunciona() {
  return (
    <Screen back="/vender" guestBack="/" title={RULES_TITLE} subtitle={RULES_INTRO} space="calm">
      {RULES.map((r, i) => (
        <Card key={r.id} style={s.card}>
          <View style={s.row}>
            <View style={s.icon}><Icon name={r.icon} size={20} color={C.purpleDark} /></View>
            <Text style={[T.headline, { flex: 1 }]} accessibilityRole="header">{i + 1}. {r.title}</Text>
          </View>
          <Text style={[T.callout, { color: '#DCD2F5' }]}>{r.text}</Text>
          {r.points?.map((p) => (
            <View key={p} style={s.point}>
              <Text style={[T.callout, { color: C.lilac }]}>•</Text>
              <Text style={[T.callout, { flex: 1, color: '#DCD2F5' }]}>{p}</Text>
            </View>
          ))}
        </Card>
      ))}
      {TOUR.enabled && TOUR.start ? <PrimaryButton title="Ver recorrido" icon="compass-outline" variant="secondary" onPress={TOUR.start} /> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  card: { gap: S.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: S.sm + 4 },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.lilac, alignItems: 'center', justifyContent: 'center' },
  point: { flexDirection: 'row', gap: S.sm, paddingLeft: S.xs },
});
