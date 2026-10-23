import { timeLeft, useAutoReleaseWindow } from '@/lib/autorelease';
import { friendlyPayError } from '@/lib/wallet';
// Comprador: Pagar en custodia -> SINPE simulado -> "Ya pagué" -> fondos en escrow TW testnet. Luego "Recibí".
// Mismas llamadas a la API que antes; la UI vive en el footer fijo + bottom sheets.
import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { DisputeSheet } from '@/components/DisputeSheet';
import { Text, View } from 'react-native';
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

export function PayBox({ order, onChange }: { order: PublicOrder; onChange: () => void }) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sinpe, setSinpe] = useState<{ amountUsdc: number; priceCrc: number; reference: string } | null>(null);
  const [pin, setPinState] = useState<string | null>(() => loadPin(order.slug)); // el PIN queda en este navegador (comprador invitado)
  const setPin = (p: string | null) => { setPinState(p); if (p) savePin(order.slug, p); };
  const buyerHere = !!pin || auth.isAuthenticated; // este dispositivo es el del comprador (guardó el PIN) o hay sesión
  const [sheet, setSheet] = useState<'sinpe' | 'pin' | 'released' | 'dispute' | null>(null);

  const win = useAutoReleaseWindow();
  // Producto permanente: cada comprador tiene su propio pedido (/p/<pedido>). Al llegar con ?pay=1 se abre el SINPE directo.
  const { pay } = useLocalSearchParams<{ pay?: string }>();
  const mine = order.kind === 'listing' ? myListingOrder(order.slug) : null;
  const resumed = useRef(false);
  useEffect(() => {
    if (pay !== '1' || resumed.current || order.status !== 'escrow_creado' || sinpe) return;
    resumed.current = true;
    run(async () => {
      const r = await guestApi(auth, '/api/escrow/pay', { slug: order.slug, step: 'start' });
      setSinpe({ amountUsdc: r.amountUsdc, priceCrc: r.priceCrc, reference: r.sinpe.reference }); setSheet('sinpe');
    });
  }, [pay, order.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(null); try { await f(); } catch (e) { trackError('paybox', e); setErr(friendlyPayError((e as Error).message)); } finally { setBusy(false); } };

  const sheets = <>
    <DisputeSheet visible={sheet === 'dispute'} onClose={() => setSheet(null)} slug={order.slug} onOpened={onChange} />
    <Sheet visible={sheet === 'sinpe' && !!sinpe && order.status === 'escrow_creado'} onClose={() => setSheet(null)} title="Paga por SINPE Móvil"
      footer={<>
        {err && <ErrorText>{err}</ErrorText>}
        <PrimaryButton title="Ya pagué" icon="checkmark" loading={busy}
          onPress={() => run(async () => { track('pay_confirm_tapped'); const r = await guestApi(auth, '/api/escrow/pay', { slug: order.slug, step: 'confirm_sinpe' }); track('payment_funded_client'); setPin(r.pin); setSheet('pin'); onChange(); })} />
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
    <Sheet visible={sheet === 'pin' && !!pin} onClose={() => setSheet(null)}
      footer={<PrimaryButton title="Listo, lo guardé" onPress={() => setSheet(null)} />}>
      <SuccessCheck />
      <Text style={[T.title, { textAlign: 'center' }]}>Pago en custodia</Text>
      <Card style={{ alignItems: 'center' }}>
        <Text style={T.caption}>Tu PIN de entrega</Text>
        <Text style={{ fontFamily: Fonts.black, fontSize: 40, letterSpacing: 8, color: C.lilac, fontVariant: ['tabular-nums'] }} selectable>{pin}</Text>
      </Card>
      <Text style={[T.callout, { textAlign: 'center' }]}>Dáselo al vendedor solo cuando tengas el producto en la mano y lo hayas revisado.</Text>
      <Text style={[T.footnote, { textAlign: 'center' }]}>Pagaste sin crear cuenta: este navegador guarda tu acceso a este pedido (PIN y confirmación). Si borras los datos del navegador, no podrás confirmar ni reportar un problema desde aquí. Anota el PIN.</Text>
      <ChainLinks order={order} align="center" />
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
      <PrimaryButton title={busy ? 'Preparando…' : `Pagar en custodia ${formatCRC(order.price_crc)}`} icon="shield-checkmark" loading={busy}
        onPress={() => run(async () => {
          const r = await guestApi(auth, '/api/escrow/pay', { slug: order.slug, step: 'start' });
          if (r.slug && r.slug !== order.slug) { // producto permanente: seguir en el pedido propio de este comprador
            rememberListingOrder(order.slug, r.slug); track('listing_order_started');
            router.replace({ pathname: '/p/[slug]', params: { slug: r.slug, pay: '1' } }); return;
          }
          setSinpe({ amountUsdc: r.amountUsdc, priceCrc: r.priceCrc, reference: r.sinpe.reference });
          setSheet('sinpe');
          onChange(); // refresca el pedido (escrow_creado) para que se abra la hoja SINPE (antes solo en demo: bug)
        })} />
    </>;
  } else if (sinpe && order.status === 'escrow_creado') {
    footer = <PrimaryButton title="Continuar pago" icon="arrow-forward" onPress={() => setSheet('sinpe')} />;
  } else if (order.status === 'enviado' && !buyerHere) {
    footer = <Text style={[T.callout, { textAlign: 'center' }]}>Pedido enviado. El comprador confirma la recepción desde el mismo navegador donde pagó.</Text>;
  } else if (order.status === 'enviado') {
    footer = <>
      <Text style={[T.footnote, { textAlign: 'center' }]}>
        Si no reportas un problema, el pago se libera solo{order.auto_release_at ? ` en ${timeLeft(order.auto_release_at)} (${new Date(order.auto_release_at).toLocaleString()})` : win ? ` en ${win}` : ' al vencer el plazo de liberación automática'}.
      </Text>
      {err && <ErrorText>{err}</ErrorText>}
      <PrimaryButton title="Recibí y está bien" icon="checkmark-circle" loading={busy}
        onPress={() => run(async () => { await guestApi(auth, '/api/escrow/confirm', { slug: order.slug, reason: 'buyer_confirm' }); setSheet('released'); onChange(); })} />
    </>;
  } else if (order.status === 'fondeado') {
    footer = pin ? <PrimaryButton title="Ver mi PIN de entrega" icon="keypad" variant="secondary" onPress={() => setSheet('pin')} />
      : <Text style={[T.callout, { textAlign: 'center' }]}>Pago en custodia. Esperando que el vendedor lo envíe.</Text>;
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
