import { Text, View } from 'react-native';
import { Icon, PrimaryButton, Screen } from '@/components/ds';
import { router } from 'expo-router';
import { C, S, T } from '@/constants/theme';

export default function NotFoundScreen() {
  return (
    <Screen back="/">
      <View style={{ alignItems: 'center', gap: S.md, paddingVertical: S.xl }}>
        <Icon name="planet-outline" size={48} color={C.lilac} />
        <Text style={[T.title, { textAlign: 'center' }]}>Esta página no existe</Text>
        <Text style={[T.callout, { textAlign: 'center' }]}>Revisa el link o vuelve al inicio.</Text>
        <PrimaryButton title="Ir al inicio" onPress={() => router.replace('/')} />
      </View>
    </Screen>
  );
}
