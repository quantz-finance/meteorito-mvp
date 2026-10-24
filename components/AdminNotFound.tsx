// Panel admin: lo que ve quien NO es admin (el servidor responde 404). No revela que el panel existe.
import { router } from 'expo-router';
import { Text } from 'react-native';
import { Card, Icon, PrimaryButton, Screen } from '@/components/ds';
import { C, S, T } from '@/constants/theme';

export function AdminNotFound() {
  return (
    <Screen back="/pedidos">
      <Card testID="admin-not-found" style={{ alignItems: 'center', gap: S.md, paddingVertical: S.xl }}>
        <Icon name="help-circle-outline" size={40} color={C.lilac} />
        <Text style={[T.headline, { textAlign: 'center' }]}>No encontramos esta página.</Text>
        <PrimaryButton title="Ir a Home" icon="home-outline" variant="secondary" onPress={() => router.replace('/pedidos')} />
      </Card>
    </Screen>
  );
}

