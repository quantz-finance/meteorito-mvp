import { timeLeft, useAutoReleaseWindow } from '@/lib/autorelease';
import { friendlyPayError } from '@/lib/wallet';
// Comprador: Pagar en custodia -> tarjeta (formulario propio, components/CardSheet.tsx) o SINPE simulado ("Ya pagué") -> fondos en escrow TW testnet. Luego "Recibí".
// Mismas llamadas a la API que antes; la UI vive en el footer fijo + bottom sheets.
import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { DisputeSheet } from '@/components/DisputeSheet';
import { Image, Pressable, Text, View } from 'react-native';
import { deliveryCodeVisible, PAID_WAITING } from '@/lib/shipping';
import { Card, ErrorText, Icon, PrimaryButton, Sheet, SuccessCheck } from '@/components/ds';
import { Fonts } from '@/constants/Colors';
import { C, S, T } from '@/constants/theme';
import { guestApi } from '@/lib/api';
import { myListingOrder, rememberListingOrder } from '@/lib/listings';
import { loadPin, savePin } from '@/lib/guest';
import { useAuth } from '@/lib/cavos';
import { formatCRC, type PublicOrder } from '@/lib/orders';
import { resolvedLabel } from '@/lib/status';
import { track, trackError } from '@/lib/analytics';
import { DEMO_ENABLED } from '@/lib/demo';
import { ChainLinks } from '@/components/ChainLinks';
import { openCardWidget } from '@/lib/cardPay';
import { CardSheet, type CardPayInput } from '@/components/CardSheet';
import { BetaNotice } from '@/components/RulesLink';

const CARD_PROCESSING = 'Tu pago con tarjeta se está procesando. Vuelve a tocar "Pagar con tarjeta" en unos segundos.';
const CARD_PROCESSING_INAPP = 'Tu pago se está procesando. Vuelve a tocar "Pagar" en unos segundos: no se te cobra dos veces.';
const CARD_POLL_MS = 2500, CARD_POLL_MAX_MS = 120_000; // "demorada": ~30 s en Lendara
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export function PayBox({ order, onChange }: { order: PublicOrder; onChange: () => void }) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sinpe, setSinpe] = useState<{ amountUsdc: number; priceCrc: number; reference: string } | null>(null);
  const [pin, setPinState] = useState<string | null>(() => loadPin(order.slug)); // el PIN queda en este navegador (comprador invitado)
  const setPin = (p: string | null) => { setPinState(p); if (p) savePin(order.slug, p); };
  const buyerHere = !!pin || auth.isAuthenticated; // este dispositivo es el del comprador (guardó el PIN) o hay sesión
  const [sheet, setSheet] = useState<'method' | 'card' | 'sinpe' | 'paid' | 'photo' | 'released' | 'dispute' | null>(null);
  const [card, setCard] = useState(false); // el servidor tiene el pago con tarjeta configurado (start -> card)
  // 'inapp' (default): nuestro formulario. 'widget': respaldo con el widget de Lendara (LENDARA_MODE=widget en el servidor).
  const [cardMode, setCardMode] = useState<'inapp' | 'widget'>('inapp');
  const payOpen = (r: any) => {
    setSinpe({ amountUsdc: r.amountUsdc, priceCrc: r.priceCrc, reference: r.sinpe.reference }); setCard(!!r.card);
    setCardMode(r.cardMode === 'inapp' ? 'inapp' : 'widget'); setSheet(r.card ? 'method' : 'sinpe');
  };

  const win = useAutoReleaseWindow();
  // Foto del envío y número de guía (solo el comprador, por el API; no van a la vista pública).
  const [ship, setShip] = useState<{ photo: string | null; note: string | null } | null>(null);
  useEffect(() => {
    if (order.status !== 'enviado' || !buyerHere) return;
    let live = true;
    guestApi<{ shipped: boolean; photo?: string | null; note?: string | null }>(auth, '/api/escrow/pay', { slug: order.slug, step: 'shipment' })
      .then((r) => { if (live && r?.shipped) setShip({ photo: r.photo ?? null, note: r.note ?? null }); }).catch(() => {});
    return () => { live = false; };
  }, [order.status, order.slug, buyerHere]); // eslint-disable-line react-hooks/exhaustive-deps
  // Producto permanente: cada comprador tiene su propio pedido (/p/<pedido>). Al llegar con ?pay=1 se abre el SINPE directo.
  const { pay } = useLocalSearchParams<{ pay?: string }>();
  const mine = order.kind === 'listing' ? myListingOrder(order.slug) : null;
  const resumed = useRef(false);
  useEffect(() => {
    if (pay !== '1' || resumed.current || order.status !== 'escrow_creado' || sinpe) return;
    resumed.current = true;
    run(async () => {
      const r = await guestApi(auth, '/api/escrow/pay', { slug: order.slug, step: 'start' });
      payOpen(r);
    });
  }, [pay, order.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const funded = (r: { pin?: string | null }, method: 'card' | 'sinpe') => {
    // El código de entrega se guarda en este navegador pero NO se muestra todavía: aparece cuando el vendedor lo envía.
    track('payment_funded_client', { method }); if (r.pin) setPin(r.pin); setSheet(r.pin || pin ? 'paid' : null); onChange();
  };
  // Tarjeta in-app: el servidor cobra (card_pay) y verifica (card_confirm). Número y CVC no salen de CardSheet.
  const payCardInApp = async (p: CardPayInput) => {
    track('card_pay_submitted');
    try {
      let r = await guestApi(auth, '/api/escrow/pay', { slug: order.slug, step: 'card_pay', name: p.name, email: p.email, scenario: p.scenario });
      const t0 = Date.now();
      while (r.pending && Date.now() - t0 < CARD_POLL_MAX_MS) { await sleep(CARD_POLL_MS); r = await guestApi(auth, '/api/escrow/pay', { slug: order.slug, step: 'card_confirm' }); }
      if (r.pending) throw new Error(CARD_PROCESSING_INAPP);
      funded(r, 'card');
    } catch (e) { trackError('card_pay', e); throw new Error(friendlyPayError((e as Error).message)); }
  };
  // Tarjeta (respaldo widget): sesión en el servidor -> widget de Lendara (iframe) -> el servidor verifica y fondea (card_confirm).
  const payCard = () => run(async () => {
    track('card_pay_tapped');
    const s = await guestApi(auth, '/api/escrow/pay', { slug: order.slug, step: 'card_session' });
    if (s.fundedTx) return funded(s, 'card'); // un pago anterior ya se había completado
    if (s.pending) { setErr(CARD_PROCESSING); return; }
    setSheet(null); // la hoja (Modal) atrapa el foco: el iframe del widget no recibiría el teclado
    const out = await openCardWidget(s.url);
    setSheet('method');
    if (out === 'closed') { track('card_widget_closed'); return; }
    const r = await guestApi(auth, '/api/escrow/pay', { slug: order.slug, step: 'card_confirm' });
    if (r.pending) { setErr(CARD_PROCESSING); return; }
    funded(r, 'card');
  });
  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(null); try { await f(); } catch (e) { trackError('paybox', e); setErr(friendlyPayError((e as Error).message)); } finally { setBusy(false); } };

  const sheets = <>
    <DisputeSheet visible={sheet === 'dispute'} onClose={() => setSheet(null)} slug={order.slug} onOpened={onChange} />
    <Sheet visible={sheet === 'method' && !!sinpe && order.status === 'escrow_creado'} onClose={() => setSheet(null)} title="Elige cómo pagar"
      footer={<>
        {err && <ErrorText>{err}</ErrorText>}
        <PrimaryButton title="Pagar con tarjeta" icon="card" loading={busy}
          onPress={cardMode === 'inapp' ? () => { track('card_pay_tapped'); setErr(null); setSheet('card'); } : payCard} />
        <PrimaryButton title="Pagar por SINPE Móvil" icon="phone-portrait-outline" variant="secondary" disabled={busy} onPress={() => { setErr(null); setSheet('sinpe'); }} />
      </>}>
      {sinpe && <>
        <Card style={{ alignItems: 'center', paddingVertical: S.lg }}>
          <Text style={T.caption}>Monto</Text>
          <Text style={T.money}>{formatCRC(sinpe.priceCrc)}</Text>
        </Card>
        <Row icon="lock-closed" text="Tu pago queda en custodia. El vendedor cobra cuando recibes el producto." />
      </>}
    </Sheet>
    <CardSheet visible={sheet === 'card' && !!sinpe && order.status === 'escrow_creado'} amountCrc={sinpe?.priceCrc ?? Number(order.price_crc)}
      onClose={() => setSheet('method')} onPay={payCardInApp} onSinpe={() => { setErr(null); setSheet('sinpe'); }} />
    <Sheet visible={sheet === 'sinpe' && !!sinpe && order.status === 'escrow_creado'} onClose={() => setSheet(null)} title="Paga por SINPE Móvil"
      footer={<>
        {err && <ErrorText>{err}</ErrorText>}
        <PrimaryButton title="Ya pagué" icon="checkmark" loading={busy}
          onPress={() => run(async () => { track('pay_confirm_tapped'); const r = await guestApi(auth, '/api/escrow/pay', { slug: order.slug, step: 'confirm_sinpe' }); funded(r, 'sinpe'); })} />
      </>}>
      {sinpe && <>
        <Card style={{ alignItems: 'center', paddingVertical: S.lg }}>
          <Text style={T.caption}>Monto</Text>
          <Text style={T.money}>{formatCRC(sinpe.priceCrc)}</Text>
          <Text style={T.footnote}>Referencia {sinpe.reference}</Text>
        </Card>
        <Row icon="lock-closed" text="Tu pago queda en custodia. El vendedor cobra cuando recibes el producto." />
        <Row icon="information-circle-outline" text='No envíes dinero: toca "Ya pagué" para continuar.' />
      </>}
    </Sheet>
    <Sheet visible={sheet === 'paid'} onClose={() => setSheet(null)}
      footer={<PrimaryButton title="Entendido" onPress={() => setSheet(null)} />}>
      <SuccessCheck />
      <Text style={[T.title, { textAlign: 'center' }]}>{PAID_WAITING}</Text>
      <Row icon="lock-closed" text="Tu pago queda en custodia. El vendedor cobra cuando recibes el producto." />
      <Row icon="cube-outline" text="Cuando lo envíe, aquí vas a ver tu código de entrega." />
      <Text style={[T.footnote, { textAlign: 'center' }]}>Pagaste sin crear cuenta: este navegador guarda tu acceso a este pedido y tu código de entrega. Si borras los datos del navegador, no podrás confirmar ni reportar un problema desde aquí.</Text>
      <BetaNotice from="pin" onNavigate={() => setSheet(null)} />
      <ChainLinks order={order} align="center" />
    </Sheet>
    <Sheet visible={sheet === 'photo' && !!ship?.photo} onClose={() => setSheet(null)} title="Foto del envío"
      footer={<PrimaryButton title="Cerrar" variant="secondary" onPress={() => setSheet(null)} />}>
      {ship?.photo ? <Image testID="ship-photo-full" source={{ uri: ship.photo }} style={{ width: '100%', aspectRatio: 3 / 4, borderRadius: 12 }} resizeMode="contain" accessibilityLabel="Foto del envío" /> : null}
      {ship?.note ? <Text style={[T.callout, { textAlign: 'center' }]} selectable>{ship.note}</Text> : null}
    </Sheet>
    <Sheet visible={sheet === 'released'} onClose={() => setSheet(null)} footer={<PrimaryButton title="Cerrar" onPress={() => setSheet(null)} />}>
      <SuccessCheck celebrate />
      <Text style={[T.title, { textAlign: 'center' }]}>¡Listo! Pago liberado</Text>
      <Text style={[T.callout, { textAlign: 'center' }]}>Gracias por usar Meteorito.</Text>
      <ChainLinks order={order} align="center" />
    </Sheet>
  </>;

  let footer: React.ReactNode = null;
  // Sin login: el comprador paga como invitado (llave en este navegador). No hay estado "Entrar para pagar".
  if (order.status === 'creado' || (order.status === 'escrow_creado' && !sinpe)) {
    footer = <>
      {err && !sheet && <ErrorText>{err}</ErrorText>}
      {mine ? <PrimaryButton title="Ver mi pedido" icon="receipt-outline" variant="ghost" onPress={() => router.push({ pathname: '/p/[slug]', params: { slug: mine } })} /> : null}
      <BetaNotice from="pay" />
      <PrimaryButton title={busy ? 'Preparando…' : `Pagar en custodia ${formatCRC(order.price_crc)}`} icon="shield-checkmark" loading={busy}
        onPress={() => run(async () => {
          const r = await guestApi(auth, '/api/escrow/pay', { slug: order.slug, step: 'start' });
          if (r.slug && r.slug !== order.slug) { // producto permanente: seguir en el pedido propio de este comprador
            rememberListingOrder(order.slug, r.slug); track('listing_order_started');
            router.replace({ pathname: '/p/[slug]', params: { slug: r.slug, pay: '1' } }); return;
          }
          payOpen(r);
          onChange(); // refresca el pedido (escrow_creado) para que se abra la hoja SINPE (antes solo en demo: bug)
        })} />
    </>;
  } else if (sinpe && order.status === 'escrow_creado') {
    footer = <PrimaryButton title="Continuar pago" icon="arrow-forward" onPress={() => { setErr(null); setSheet(card ? 'method' : 'sinpe'); }} />;
  } else if (order.status === 'enviado' && !buyerHere) {
    footer = <Text style={[T.callout, { textAlign: 'center' }]}>Pedido enviado. El comprador confirma la recepción desde el mismo navegador donde pagó.</Text>;
  } else if (order.status === 'enviado') {
    const left = order.auto_release_at ? timeLeft(order.auto_release_at) : win;
    footer = <>
      <Card style={{ gap: S.sm, paddingVertical: S.sm + 2 }}>
        <View style={{ flexDirection: 'row', gap: S.sm + 2, alignItems: 'center' }}>
          {ship?.photo
            ? <Pressable onPress={() => setSheet('photo')} accessibilityRole="imagebutton" accessibilityLabel="Ver la foto del envío" hitSlop={6}>
                <Image testID="ship-photo" source={{ uri: ship.photo }} style={{ width: 52, height: 52, borderRadius: 10, backgroundColor: C.lilacBg }} resizeMode="cover" />
              </Pressable>
            : <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' }}><Icon name="cube" size={22} color={C.purpleDark} /></View>}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={T.headline}>Va en camino</Text>
            {ship?.note ? <Text style={T.footnote} numberOfLines={1} selectable>{ship.note}</Text> : null}
          </View>
        </View>
        {deliveryCodeVisible(order.status) && pin ? <View style={{ alignItems: 'center', gap: 2 }}>
          <Text style={T.caption}>Tu código de entrega</Text>
          <Text testID="delivery-code" style={{ fontFamily: Fonts.black, fontSize: 30, letterSpacing: 6, color: C.lilac, fontVariant: ['tabular-nums'] }} selectable>{pin}</Text>
          <Text style={[T.footnote, { textAlign: 'center' }]}>Dáselo al vendedor cuando lo recibas.</Text>
        </View> : <Text style={T.footnote}>Tu código de entrega está en el navegador donde pagaste.</Text>}
      </Card>
      <Text style={[T.footnote, { textAlign: 'center' }]}>
        El pago se libera solo{left ? ` en ${left}` : ' 7 días después del envío'} si no reportas un problema.
      </Text>
      {err && <ErrorText>{err}</ErrorText>}
      <PrimaryButton title="Recibí y está bien" icon="checkmark-circle" loading={busy}
        onPress={() => run(async () => { await guestApi(auth, '/api/escrow/confirm', { slug: order.slug, reason: 'buyer_confirm' }); setSheet('released'); onChange(); })} />
    </>;
  } else if (order.status === 'fondeado') {
    footer = <View style={{ flexDirection: 'row', gap: S.sm, justifyContent: 'center', alignItems: 'center', minHeight: 44 }}>
      <Icon name="time-outline" size={20} color={C.lilac} /><Text style={[T.callout, { textAlign: 'center', flexShrink: 1 }]}>{PAID_WAITING}</Text>
    </View>;
  } else if (order.status === 'liberado' || order.status === 'resuelto' || order.status === 'entregado') {
    footer = <View style={{ flexDirection: 'row', gap: S.sm, justifyContent: 'center', alignItems: 'center', minHeight: 44 }}>
      <Icon name="checkmark-circle" size={22} color={C.success} /><Text style={[T.headline, { color: C.success }]}>{resolvedLabel(order)}</Text>
    </View>;
  } else if (order.status === 'en_disputa') {
    footer = <Text style={[T.callout, { textAlign: 'center', color: C.orange }]}>En disputa: lo estamos revisando, respondemos en 24-48 h. El pago está en pausa.</Text>;
  }

  // Solo el comprador puede abrir disputa (la API lo verifica) y solo antes de liberar.
  const canDispute = buyerHere && ['fondeado', 'enviado', 'entregado'].includes(order.status) && !order.released_tx;
  const problem = canDispute
    ? <PrimaryButton title="Tengo un problema" icon="alert-circle-outline" variant="ghost" onPress={() => { setErr(null); setSheet('dispute'); }} />
    : null;
  return <>{footer || problem ? <View style={{ gap: S.sm }}>{footer}{problem}</View> : null}{sheets}</>;
}

function Row({ icon, text }: { icon: React.ComponentProps<typeof Icon>['name']; text: string }) {
  return <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start' }}><Icon name={icon} size={20} color={C.lilac} /><Text style={[T.callout, { flex: 1 }]}>{text}</Text></View>;
}
