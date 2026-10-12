import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { Card, Chip, IconButton, Screen } from '@/components/ds';
import { LEGAL, LEGAL_UPDATED } from '@/lib/legal';
import { S, T } from '@/constants/theme';

export default function LegalDoc() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const d = LEGAL[(doc === 'terminos' ? 'terminos' : 'privacidad')];
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <Screen title={d.title} space="calm" right={<IconButton icon="close" label="Cerrar" onPress={back} />}>
      <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
        <Chip label="BORRADOR · pendiente de revisión legal" tone="warn" icon="document-text-outline" />
      </View>
      <Text style={T.footnote}>Última actualización: {LEGAL_UPDATED}</Text>
      {d.sections.map((s) => (
        <Card key={s.h} style={{ gap: S.sm }}>
          <Text style={T.headline}>{s.h}</Text>
          {s.p.map((p, i) => <Text key={i} style={[T.callout, { color: '#DCD2F5' }]}>{p}</Text>)}
        </Card>
      ))}
    </Screen>
  );
}
