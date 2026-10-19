import { ensureSellerWalletOnLoad } from '@/lib/wallet';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { Card, Chip, ErrorText, Icon, MoneyTimeline, PrimaryButton, Screen, Sheet, SkeletonCard, statusTone } from '@/components/ds';
import { OrderCard } from '@/components/OrderRow';
import { Reveal } from '@/components/space';
import { SellerActions } from '@/components/SellerActions';
import { C, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { formatCRC, getSellerOrders, orderLink, STATUS_LABEL, type SellerOrder } from '@/lib/orders';
import { supabaseConfigured } from '@/lib/supabase';

const NEXT_HINT: Record<string, string> = {
  creado: 'Comparte el link. Cuando el comprador pague, te avisamos acá.',
  escrow_creado: 'El comprador está pagando.',
  fondeado: 'El dinero está apartado. Coordina la entrega y márcala como enviada.',
  enviado: 'Al entregar, pedile el PIN al comprador para cobrar.',
  entregado: 'Entregado. El pago se está liberando.',
  liberado: 'Cobrado. ¡Buena venta!',
  en_disputa: 'Estamos revisando un problema reportado. El pago está en pausa.',
};

export default function Pedidos() {
  const auth = useAuth();
  const { address } = auth;
  const [orders, setOrders] = useState<SellerOrder[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!address || !supabaseConfigured) { setOrders([]); return; }
    setLoading(true); setError(null);
    try { const os = await getSellerOrders(address); setOrders(os); ensureSellerWalletOnLoad(auth, os.length > 0).then((m) => m && setError(m)); } catch (e) { setError((e as Error).message); setOrders((o) => o ?? []); }
    finally { setLoading(false); }
  }, [address, auth.wallet.state]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = orders?.find((o) => o.slug === openSlug) ?? null;

  return (
    <Screen title="Mis pedidos" subtitle="El estado de tu dinero, siempre a la vista."
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.lilac} />}>
      {!supabaseConfigured && <ErrorText>Falta configurar Supabase (.env)</ErrorText>}
      {error && <ErrorText>{error}</ErrorText>}
      {orders === null ? <><SkeletonCard /><SkeletonCard /><SkeletonCard /></>
        : orders.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: S.xl, gap: S.md }}>
            <Icon name="cube-outline" size={40} color={C.lilac} />
            <Text style={T.headline}>Sin pedidos todavía</Text>
            <Text style={[T.callout, { textAlign: 'center' }]}>Crea un link de venta y compartilo por WhatsApp o Messenger.</Text>
            <PrimaryButton title="Crear link de venta" icon="add" onPress={() => router.push('/vender')} />
          </Card>
        ) : orders.map((o, i) => <Reveal key={o.slug} i={i}><OrderCard order={o} onPress={() => setOpenSlug(o.slug)} /></Reveal>)}

      <Sheet visible={!!open} onClose={() => setOpenSlug(null)} title={open ? `${open.brand} ${open.model}` : ''}
        footer={open ? <PrimaryButton title="Compartir link" icon="share-outline" variant="secondary"
          onPress={() => { const slug = open.slug; setOpenSlug(null); router.push({ pathname: '/compartir/[slug]', params: { slug } }); }} /> : null}>
        {open && <>
          <View style={{ gap: S.sm }}>
            <Text style={T.money}>{formatCRC(open.price_crc)}</Text>
            <Chip label={STATUS_LABEL[open.status] ?? open.status} tone={statusTone(open.status)} />
          </View>
          <Card style={{ gap: S.md }}>
            <MoneyTimeline status={open.status} />
            <Text style={T.callout}>{NEXT_HINT[open.status] ?? ''}</Text>
          </Card>
          <SellerActions slug={open.slug} status={open.status} onChange={load} />
          <View style={{ gap: S.xs }}>
            <Text style={T.caption}>Detalles</Text>
            <Text style={T.footnote} selectable>{orderLink(open.slug)}</Text>
            {open.identifier_masked ? <Text style={T.footnote}>Identificador: {open.identifier_masked}</Text> : null}
          </View>
        </>}
      </Sheet>
    </Screen>
  );
}
