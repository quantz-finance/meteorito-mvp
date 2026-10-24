// /mi-tienda ya no es otra pantalla: la tienda es una sola página, /t/<usuario> (la misma que ven los compradores, con
// las herramientas del dueño cuando la sesión es suya). Aquí solo se busca el usuario de la sesión y se redirige.
// Se mantiene para los links y botones viejos que abren /mi-tienda.
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Card, Icon, PrimaryButton, Screen, Skeleton } from '@/components/ds';
import { C, R, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { userMessage } from '@/lib/cavosSession';
import { getMyStore } from '@/lib/store';
import { myStoreHref } from '@/lib/storePage';

export default function MiTienda() {
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    getMyStore(auth).then((s) => router.replace(myStoreHref(s.store_slug) as never)).catch((e) => setError(userMessage((e as Error).message)));
  }, [auth.address]);
  useEffect(load, [load]);

  return (
    <Screen title="Mi tienda" back="/vender" scroll={false}>
      {error ? (
        <Card style={{ alignItems: 'center', gap: S.sm }}>
          <Icon name="storefront-outline" size={40} color={C.lilac} />
          <Text style={[T.headline, { textAlign: 'center' }]}>{error}</Text>
          <PrimaryButton title="Intentar de nuevo" variant="secondary" onPress={load} />
          <PrimaryButton title="Crear un link" variant="ghost" icon="link" onPress={() => router.replace('/vender')} />
        </Card>
      ) : <View style={{ gap: S.md }}><Skeleton w="60%" h={28} /><Skeleton h={48} r={R.md} /><Skeleton h={160} r={R.lg} /></View>}
    </Screen>
  );
}
