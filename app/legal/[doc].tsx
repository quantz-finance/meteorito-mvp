import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { Card, Chip, Screen } from '@/components/ds';
import { LEGAL, LEGAL_UPDATED, type LegalDocId } from '@/lib/legal';
import { S, T } from '@/constants/theme';

export default function LegalDoc() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const d = LEGAL[(doc === 'terminos' || doc === 'vendedor' ? doc : 'privacidad') as LegalDocId];
  return (
    <Screen back="/vender" guestBack="/" title={d.title} space="calm">
      <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
        <Chip label="BORRADOR · pendiente de revisión legal" tone="warn" icon="document-text-outline" />
      </View>
      <Text style={T.footnote}>Última actualización: {d.updated ?? LEGAL_UPDATED}{d.version ? ` · versión ${d.version}` : ''}</Text>
      {d.sections.map((s) => (
        <Card key={s.h} style={{ gap: S.sm }}>
          <Text style={T.headline}>{s.h}</Text>
          {s.p.map((p, i) => <Text key={i} style={[T.callout, { color: '#DCD2F5' }]}>{p}</Text>)}
        </Card>
      ))}
    </Screen>
  );
}
