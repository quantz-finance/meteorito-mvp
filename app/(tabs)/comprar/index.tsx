// Comprar › Feed (/comprar, la pantalla de entrada de la app): arriba el botón principal "Crear link para el vendedor"
// (/i/nueva: el comprador arma la invitación y el vendedor la acepta), debajo el feed (buscador, filtro y publicaciones).
// Pagar con link y Mis compras se abren con los iconos de arriba a la derecha (components/ComprarNav).
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { PrimaryButton, Screen } from '@/components/ds';
import { T } from '@/constants/theme';
import { ComprarNav, GUEST_BACK, useIsGuest } from '@/components/ComprarNav';
import { Feed } from '@/components/Feed';

const CREATE_LINK_TITLE = 'Crear link para el vendedor';
const CREATE_LINK_SUB = 'Pega el anuncio o di qué quieres y a qué precio; el vendedor acepta y pagas en custodia.';

export default function Comprar() {
  const guest = useIsGuest(); // sin cuenta: sin barra de pestañas, Volver arriba a la izquierda
  return (
    <Screen back={guest ? GUEST_BACK : undefined} backTop title="Comprar" scroll={false} right={<ComprarNav active="feed" />}>
      <View style={{ gap: 6, marginBottom: 12 }} testID="comprar-crear-link-box">
        <PrimaryButton title={CREATE_LINK_TITLE} icon="paper-plane-outline" testID="comprar-crear-link" onPress={() => router.push('/i/nueva')} />
        <Text style={[T.caption, { textAlign: 'center' }]}>{CREATE_LINK_SUB}</Text>
      </View>
      <Feed header={<></>} />
    </Screen>
  );
}
