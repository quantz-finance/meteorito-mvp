import { DEVICE_NOT_AUTHORIZED, ensureSellerWalletOnLoad } from '@/lib/wallet';
import { OrphanWalletCard } from '@/components/OrphanWallet';
import { userMessage } from '@/lib/cavosSession';
import { isSessionError } from '@/lib/authUx';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { GridPager } from '@/components/GridPager';
import { Card, Chip, ErrorText, Icon, IconButton, MoneyTimeline, PrimaryButton, Screen, Sheet, SkeletonCard, statusTone } from '@/components/ds';
import { OrderCard } from '@/components/OrderRow';
import { SellerActions } from '@/components/SellerActions';
import { C, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { ChainLinks } from '@/components/ChainLinks';
import { formatCRC, getPublicOrder, getSellerOrders, type PublicOrder, orderLink, orderTitle, STATUS_LABEL, type SellerOrder } from '@/lib/orders';
import { supabaseConfigured } from '@/lib/supabase';
import { keepIfSame, needsPolling } from '@/lib/refresh';
import { useOrdersRefresh } from '@/lib/useOrdersRefresh';
import { Freshness } from '@/components/Freshness';
import { SalesSummary } from '@/components/SalesSummary';
import { AccountSheet } from '@/components/AccountSheet';
import { useStableWindow } from '@/lib/viewport';
import { useStamp } from '@/lib/freshness';
import { lazy, Suspense } from 'react';
const PushCard = lazy(() => import('@/components/PushCard')); // diferido

const NEXT_HINT: Record<string, string> = {
  creado: 'Comparte el link. Cuando el comprador pague, te avisamos acá.',
  escrow_creado: 'El comprador está pagando.',
  fondeado: 'El dinero está apartado. Coordina la entrega y márcala como enviada.',
  enviado: 'Al entregar, pídele el PIN al comprador para cobrar.',
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
  // Error de sesión (token rechazado/vencido): se muestra UNA vez arriba y la tarjeta de notificaciones se oculta.
  const [sessionError, setSessionError] = useState(false);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [account, setAccount] = useState(false);
  const short = useStableWindow().height < 740;
  const stamp = useStamp(); // hora del último refresco: solo re-renderiza <Freshness>

  const load = useCallback(async () => {
    if (!address || !supabaseConfigured) { setOrders([]); return; }
    setLoading(true); setError(null); setSessionError(false);
    try { const os = await getSellerOrders(auth); setOrders(os); stamp.set(Date.now()); ensureSellerWalletOnLoad(auth, os.length > 0).then((m) => m && setError(m)); } catch (e) { setError(userMessage((e as Error).message)); setSessionError(isSessionError(e)); setOrders((o) => o ?? []); }
    finally { setLoading(false); }
  }, [address, auth.wallet.state]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Refresco silencioso (sin spinner ni borrar errores): el vendedor ve 'Pago liberado' sin recargar.
  const silentRefresh = useCallback(async () => {
    if (!address || !supabaseConfigured) return;
    try { const os = await getSellerOrders(auth); setOrders((prev) => keepIfSame(prev, os)); stamp.set(Date.now()); } catch { /* se reintenta en el siguiente ciclo */ }
  }, [address]);
  useOrdersRefresh(silentRefresh, orders);

  // Datos públicos del pedido abierto (contrato, hashes, shipped_tx): la RPC seller_orders no los trae.
  const [detail, setDetail] = useState<PublicOrder | null>(null);
  useEffect(() => {
    setDetail(null);
    if (!openSlug) return;
    let live = true;
    getPublicOrder(openSlug).then((d) => { if (live) setDetail(d); }).catch(() => {});
    return () => { live = false; };
  }, [openSlug, orders]);
  const open = orders?.find((o) => o.slug === openSlug) ?? null;

  return (
    <Screen title="Home" subtitle={short ? undefined : 'El estado de tu dinero, siempre a la vista.'} scroll={false}
      right={<>
        <IconButton icon="person" label="Mi cuenta" onPress={() => setAccount(true)} />
        <IconButton icon="refresh" label="Actualizar" onPress={() => { if (!loading) load(); }} />
      </>}>
      <View style={{ flex: 1, gap: S.sm }}>
      <SalesSummary orders={orders} compact={short} />
      {!supabaseConfigured && <ErrorText>Falta configurar Supabase (.env)</ErrorText>}
      {error === DEVICE_NOT_AUTHORIZED || auth.wallet?.state === 'needs-approval' ? <OrphanWalletCard compact /> : error ? <ErrorText>{error}</ErrorText> : null}
      {orders !== null && !sessionError && <Suspense fallback={null}><PushCard role="seller" compact={short} onSessionError={(m) => { setError(m); setSessionError(true); }} /></Suspense>}
      {orders && orders.length > 0 && <Freshness stamp={stamp} live={needsPolling(orders)} />}
      {orders === null ? <><SkeletonCard /><SkeletonCard /><SkeletonCard /></>
        : orders.length === 0 ? (
          <Card style={{ alignItems: 'center', paddingVertical: S.xl, gap: S.md }}>
            <Icon name="cube-outline" size={40} color={C.lilac} />
            <Text style={T.headline}>Sin pedidos todavía</Text>
            <Text style={[T.callout, { textAlign: 'center' }]}>Crea un link de venta y compártelo por WhatsApp o Messenger.</Text>
            <PrimaryButton title="Crear link de venta" icon="add" onPress={() => router.push('/vender')} />
          </Card>
        ) : <GridPager items={orders} keyOf={(o) => o.slug} minCellW={300} minCellH={short ? 66 : 118} maxCols={2} label="Página de pedidos"
            renderItem={(o) => <OrderCard order={o} timeline={!short} fill onPress={() => setOpenSlug(o.slug)} />} />}
      </View>

      <AccountSheet visible={account} onClose={() => setAccount(false)} products={(orders ?? []).length} />
      <Sheet visible={!!open} onClose={() => setOpenSlug(null)} title={open ? orderTitle(open) : ''}
        footer={open ? <PrimaryButton title="Compartir link" icon="share-outline" variant="secondary"
          onPress={() => { const slug = open.slug; setOpenSlug(null); router.push({ pathname: '/compartir/[slug]', params: { slug } }); }} /> : null}>
        {open && <>
          <View style={{ gap: S.sm }}>
            <Text style={T.money}>{formatCRC(open.price_crc)}</Text>
            <Chip key={open.status} swap label={STATUS_LABEL[open.status] ?? open.status} tone={statusTone(open.status)} />
          </View>
          <Card style={{ gap: S.md }}>
            <MoneyTimeline status={open.status} shipped={!!detail?.shipped_tx} />
            <Text style={T.callout}>{NEXT_HINT[open.status] ?? ''}</Text>
          </Card>
          <SellerActions slug={open.slug} status={open.status} onChange={load} />
          <View style={{ gap: S.xs }}>
            <Text style={T.caption}>Detalles</Text>
            <Text style={T.footnote} selectable>{orderLink(open.slug)}</Text>
            <ChainLinks order={detail} />
            {open.identifier_masked ? <Text style={T.footnote}>Identificador: {open.identifier_masked}</Text> : null}
          </View>
        </>}
      </Sheet>
    </Screen>
  );
}
