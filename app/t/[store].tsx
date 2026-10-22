// Tienda pública del vendedor: pago.meteorito.app/t/<usuario>. Se ve sin cuenta.
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Icon, Screen, Skeleton, st, TestnetPill } from '@/components/ds';
import { BackButton } from '@/components/BackButton';
import { StoreHeader, StoreItems } from '@/components/StoreView';
import { C, R, S, T } from '@/constants/theme';
import { getStore, type Store } from '@/lib/store';
import { track } from '@/lib/analytics';

export default function Tienda() {
  const { store: slug } = useLocalSearchParams<{ store: string }>();
  const [store, setStore] = useState<Store | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!slug) return;
    let live = true;
    getStore(String(slug).toLowerCase())
      .then((s) => { if (!live) return; setStore(s); track(s ? 'store_opened' : 'store_not_found', s ? { items: s.items.length } : {}); })
      .catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [slug]);

  return (
    <Screen space="calm" scroll={false}>
      <View style={st.rowBetween}><BackButton fallback="/" /><TestnetPill /></View>
      {error ? <Notice icon="cloud-offline-outline" title="No pudimos abrir esta tienda" text={error} />
        : store === null ? <Notice icon="storefront-outline" title="Esta tienda no existe" text="Revisa el link o pídele al vendedor que te lo mande de nuevo." />
        : store === undefined ? (
          <View style={{ gap: S.md }}>
            <Skeleton w="60%" h={28} /><Skeleton w="40%" h={18} />
            <View style={{ flexDirection: 'row', gap: S.sm }}><Skeleton w="48%" h={180} r={R.lg} /><Skeleton w="48%" h={180} r={R.lg} /></View>
          </View>
        ) : <View style={{ flex: 1, gap: S.md }}>
          <StoreHeader store={store} />
          <Text style={T.caption}>Productos disponibles ({store.items.length})</Text>
          <StoreItems store={store} empty="Este vendedor no tiene productos disponibles en este momento." />
          <Text style={[T.footnote, { textAlign: 'center' }]}>Compras sin crear cuenta. Beta en testnet: sin dinero real.</Text>
        </View>}
    </Screen>
  );
}

function Notice({ icon, title, text }: { icon: any; title: string; text: string }) {
  return (
    <View style={{ alignItems: 'center', gap: S.md, paddingVertical: S.xl }}>
      <Icon name={icon} size={48} color={C.lilac} />
      <Text style={[T.title, { textAlign: 'center' }]}>{title}</Text>
      <Text style={[T.callout, { textAlign: 'center' }]}>{text}</Text>
    </View>
  );
}
