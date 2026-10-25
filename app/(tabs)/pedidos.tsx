import { Appear, AppearSub, appearSkip } from '@/components/Appear';
import { DEVICE_NOT_AUTHORIZED, ensureSellerWalletOnLoad } from '@/lib/wallet';
import { OrphanWalletCard } from '@/components/OrphanWallet';
import { userMessage } from '@/lib/cavosSession';
import { isSessionError } from '@/lib/authUx';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Card, Chip, ErrorText, IconButton, MoneyTimeline, PrimaryButton, Screen, Sheet, statusTone } from '@/components/ds';
import { BuysSection, BUYS_CHROME, BUYS_EMPTY_H, HomeSummaryCard, ROW_GAP, ROW_H, SALES_CHROME, SALES_EMPTY_H, SaleRow, SalesBox } from '@/components/HomeSections';
import { SellerActions } from '@/components/SellerActions';
import { SellerOrderChat } from '@/components/OrderChat';
import { SellerInboxButton } from '@/components/ChatInbox';
import { AdminDisputesButton } from '@/components/AdminDisputesButton';
import { SellerDisputeReply } from '@/components/SellerDisputeReply';
import { S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { ChainLinks } from '@/components/ChainLinks';
import { formatCRC, getPublicOrder, getSellerOrders, type PublicOrder, orderLink, orderTitle, STATUS_LABEL, type SellerOrder } from '@/lib/orders';
import { supabaseConfigured } from '@/lib/supabase';
import { keepIfSame, needsPolling } from '@/lib/refresh';
import { useOrdersRefresh } from '@/lib/useOrdersRefresh';
import { Freshness } from '@/components/Freshness';
import { allocateRows, HOME_COPY, homeSummary, isBuy, sortBuys, sortSales } from '@/lib/home';
import { loadMyPurchases } from '@/lib/myPurchases';
import type { PurchaseRow } from '@/lib/purchases';
import { getMyStore } from '@/lib/store';
import { AccountSheet } from '@/components/AccountSheet';
import { AdTemplateButton, AdTemplateSheet } from '@/components/AdTemplateSheet';
import type { AdInput } from '@/lib/sellerTools';
import { RulesLink } from '@/components/RulesLink';
import { useStableWindow } from '@/lib/viewport';
import { useStamp } from '@/lib/freshness';
import { lazy, Suspense } from 'react';
const PushCard = lazy(() => import('@/components/PushCard')); // diferido

const NEXT_HINT: Record<string, string> = {
  creado: 'Comparte el link. Cuando el comprador pague, te avisamos acá.',
  escrow_creado: 'El comprador está pagando.',
  fondeado: 'El dinero está apartado. Envíalo y toca "Ya lo envié".',
  enviado: 'Cuando lo reciba, pídele al comprador su código de entrega para cobrar. Si no reporta un problema, el pago se libera solo al terminar el plazo acordado.',
  entregado: 'Entregado. El pago se está liberando.',
  liberado: 'Cobrado. ¡Buena venta!',
  en_disputa: 'Estamos revisando un problema reportado. El pago está en pausa.',
};

/** Cara a cara: no hay envío; el plazo corre desde el pago. */
const F2F_HINT: Record<string, string> = {
  fondeado: 'El dinero está apartado. Entrega el producto en persona y cobra con el código del comprador.',
};

export default function Pedidos() {
  const auth = useAuth();
  const { address } = auth;
  const [orders, setOrders] = useState<SellerOrder[] | null>(null);
  const [, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Error de sesión (token rechazado/vencido): se muestra UNA vez arriba y la tarjeta de notificaciones se oculta.
  const [sessionError, setSessionError] = useState(false);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [account, setAccount] = useState(false);
  const [allSales, setAllSales] = useState(false); // "Ver todas" de Tus ventas (hoja con la lista completa)
  const [ad, setAd] = useState<AdInput | null>(null); // plantilla de anuncio (se abre al cerrar la hoja del pedido)
  const win = useStableWindow();
  const short = win.height < 740;
  const stamp = useStamp(); // hora del último refresco: solo re-renderiza <Freshness>
  // Compras de esta cuenta y de este dispositivo (mismo origen que Mis compras: lib/myPurchases, sin función nueva).
  const [buys, setBuys] = useState<PurchaseRow[] | null>(null);
  // Calificación de tu tienda (/api/store 'me'): solo se muestra si ya tienes reseñas.
  const [rating, setRating] = useState<{ rating_avg: number | null; rating_count: number } | null>(null);

  const load = useCallback(async () => {
    loadMyPurchases(auth).then((r) => setBuys(r.rows)).catch(() => setBuys((b) => b ?? []));
    if (!address || !supabaseConfigured) { setOrders([]); return; }
    getMyStore(auth).then((st) => setRating({ rating_avg: st.rating_avg, rating_count: st.rating_count })).catch(() => {});
    setLoading(true); setError(null); setSessionError(false);
    try { const os = await getSellerOrders(auth); setOrders(os); stamp.set(Date.now()); ensureSellerWalletOnLoad(auth, os.length > 0).then((m) => m && setError(m)); } catch (e) { setError(userMessage((e as Error).message)); setSessionError(isSessionError(e)); setOrders((o) => o ?? []); }
    finally { setLoading(false); }
  }, [address, auth.wallet.state, auth.isAuthenticated]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Refresco silencioso (sin spinner ni borrar errores): el vendedor ve 'Pago liberado' sin recargar.
  const silentRefresh = useCallback(async () => {
    if (!address || !supabaseConfigured) return;
    try { const os = await getSellerOrders(auth); setOrders((prev) => keepIfSame(prev, os)); stamp.set(Date.now()); } catch { /* se reintenta en el siguiente ciclo */ }
  }, [address]);
  useOrdersRefresh(silentRefresh, orders);
  // Compras: mismo polling mientras alguna siga en curso (enviada, pagada, en disputa).
  const silentBuys = useCallback(async () => {
    try { const r = await loadMyPurchases(auth); setBuys((prev) => keepIfSame(prev, r.rows)); } catch { /* siguiente ciclo */ }
  }, [auth.isAuthenticated]);
  useOrdersRefresh(silentBuys, buys ? buys.filter(isBuy).map((b) => ({ status: b.status ?? '' })) : null);

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

  // Home = resumen + listas compactas (sin la línea de tiempo ni las acciones: viven en la hoja del pedido).
  const sales = useMemo(() => sortSales(orders ?? []), [orders]);
  const myBuys = useMemo(() => sortBuys(buys ?? []), [buys]);
  const sum = homeSummary(orders, buys);
  const loaded = orders !== null && buys !== null;
  const hasData = sales.length + myBuys.length > 0;
  // Filas que caben sin scroll en el alto medido (lib/home allocateRows); el resto, en "Ver todas".
  const [listH, setListH] = useState(0);
  const stride = ROW_H + ROW_GAP;
  const fixed = (sales.length ? SALES_CHROME : SALES_EMPTY_H) + (myBuys.length ? BUYS_CHROME : BUYS_EMPTY_H) + S.sm;
  const fit = allocateRows({ slots: listH ? (listH - fixed + ROW_GAP * 2) / stride : 2, sales: sales.length, buys: myBuys.length });

  return (
    <Screen title="Home" subtitle={short ? undefined : 'El estado de tu dinero, siempre a la vista.'} scroll={false}
      right={<><AdminDisputesButton /><SellerInboxButton /><IconButton icon="storefront-outline" label="Mi tienda" onPress={() => router.push('/mi-tienda')} /><IconButton icon="person" label="Mi cuenta" onPress={() => setAccount(true)} /></>}>
      {/* Sin botón "Actualizar" (era de pruebas): Home carga al enfocar, hace polling mientras haya pedidos o compras no
          finales y vuelve a pedir al regresar a la app/pestaña (useFocusEffect + useOrdersRefresh). */}
      <AppearSub style={{ flex: 1, gap: S.sm }}>
      {!supabaseConfigured && <ErrorText>Falta configurar Supabase (.env)</ErrorText>}
      {error === DEVICE_NOT_AUTHORIZED || auth.wallet?.state === 'needs-approval' ? <OrphanWalletCard compact /> : error ? <ErrorText>{error}</ErrorText> : null}
      {loaded && hasData ? <HomeSummaryCard sum={sum} rating={rating} /> : null}
      {orders !== null && !sessionError && <Suspense fallback={null}><PushCard role="seller" slim onSessionError={(m) => { setError(m); setSessionError(true); }} /></Suspense>}
      <View {...appearSkip} style={{ flex: 1, gap: S.sm, overflow: 'hidden' }} onLayout={(e) => { const h = Math.round(e.nativeEvent.layout.height); if (Math.abs(h - listH) > 1) setListH(h); }}>
        <Appear i={2}><SalesBox rows={sales.slice(0, fit.sales)} total={sales.length} loading={orders === null} compact={short}
          onOpen={setOpenSlug} onHistory={() => router.push('/ventas')} onSeeAll={() => setAllSales(true)} /></Appear>
        <Appear i={3}><BuysSection rows={myBuys.slice(0, fit.buys)} total={myBuys.length} loading={buys === null} /></Appear>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: S.sm }}>
        {orders && orders.length > 0 ? <Freshness stamp={stamp} live={needsPolling(orders)} align="center" /> : <View />}
        <RulesLink from="home" />
      </View>
      </AppearSub>

      <Sheet visible={allSales} onClose={() => setAllSales(false)} title={HOME_COPY.sales}>
        <View style={{ gap: ROW_GAP }}>
          {sales.map((o) => <SaleRow key={o.slug} o={o} onPress={() => { setAllSales(false); setOpenSlug(o.slug); }} />)}
        </View>
      </Sheet>
      <AdTemplateSheet visible={!!ad} onClose={() => setAd(null)} ad={ad} />
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
            <MoneyTimeline status={open.status} shipped={!!detail?.shipped_tx} mode={open.delivery_mode ?? (detail?.slug === open.slug ? detail?.delivery_mode : null)} />
            <Text style={T.callout}>{(detail?.slug === open.slug && detail?.delivery_mode === 'cara_a_cara' && F2F_HINT[open.status]) || NEXT_HINT[open.status] || ''}</Text>
          </Card>
          <SellerActions slug={open.slug} status={open.status} order={detail?.slug === open.slug ? detail : null} onChange={load} />
          {open.status === 'en_disputa' ? <SellerDisputeReply slug={open.slug} /> : null}
          {open.status !== 'creado' ? <SellerOrderChat slug={open.slug} onOpen={() => setOpenSlug(null)} /> : null}
          {open.status === 'creado' ? <AdTemplateButton onPress={() => {
            const d = detail?.slug === open.slug ? detail : null;
            setAd({ title: orderTitle(open), price_crc: open.price_crc, link: orderLink(open.slug), description: d?.description ?? null, delivery_mode: d?.delivery_mode ?? open.delivery_mode, protection_minutes: d?.protection_minutes ?? null });
            setOpenSlug(null);
          }} /> : null}
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
