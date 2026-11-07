// Comprar (/comprar, la pantalla de entrada de la app): el botón principal "Crear link para el vendedor" (/i/nueva: el
// comprador entra con Cavos, arma la invitación y se la manda al vendedor, que la acepta). El feed (buscador, filtro y
// publicaciones) está oculto (lib/marketplace.ts) y solo se muestra debajo si se vuelve a activar.
// Pagar con link y Mis compras se abren con los iconos de arriba a la derecha (components/ComprarNav).
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { PrimaryButton, Screen } from '@/components/ds';
import { T } from '@/constants/theme';
import { ComprarNav, GUEST_BACK, useIsGuest } from '@/components/ComprarNav';
import { Feed } from '@/components/Feed';
import { MARKETPLACE_VISIBLE } from '@/lib/marketplace';

const CREATE_LINK_TITLE = 'Crear link para el vendedor';
const CREATE_LINK_SUB = 'Pega el anuncio o di qué quieres y a qué precio; el vendedor acepta y pagas en custodia.';

export default function Comprar() {
  const guest = useIsGuest(); // sin cuenta: sin barra de pestañas, Volver arriba a la izquierda
  const box = (
    <View style={{ gap: 6, marginBottom: 12 }} testID="comprar-crear-link-box">
      <PrimaryButton title={CREATE_LINK_TITLE} icon="paper-plane-outline" testID="comprar-crear-link" onPress={() => router.push('/i/nueva')} />
      <Text style={[T.caption, { textAlign: 'center' }]}>{CREATE_LINK_SUB}</Text>
    </View>
  );
  return (
    <Screen back={guest ? GUEST_BACK : undefined} backTop title="Comprar" scroll={false} right={<ComprarNav active="feed" />}>
      {MARKETPLACE_VISIBLE ? <>{box}<Feed header={<></>} /></> : (
        <View style={{ flex: 1, justifyContent: 'center', gap: 16 }}>
          {box}
          <PrimaryButton title="Ya tengo un link de pago" icon="link" variant="secondary" testID="comprar-pagar-link" onPress={() => router.push('/comprar/link')} />
        </View>
      )}
    </Screen>
  );
}
