import { timeLeft, useAutoReleaseWindow } from '@/lib/autorelease';
import { ensureWalletReady, friendlyPayError, walletErrorNotice } from '@/lib/wallet';
// Comprador: Pagar seguro -> SINPE simulado -> "Ya pagué" -> fondos en escrow TW testnet. Luego "Recibí".
// Mismas llamadas a la API que antes; la UI vive en el footer fijo + bottom sheets.
import { useState } from 'react';
import { DisputeSheet } from '@/components/DisputeSheet';
import { Text, View } from 'react-native';
import { Card, ErrorText, Icon, PrimaryButton, Sheet, SuccessCheck } from '@/components/ds';
import { Fonts } from '@/constants/Colors';
import { C, S, T } from '@/constants/theme';
import { api, proof } from '@/lib/api';
import { useAuth } from '@/lib/cavos';
import { formatCRC, type PublicOrder } from '@/lib/orders';
import { track, trackError } from '@/lib/analytics';
import { DEMO_ENABLED } from '@/lib/demo';

export function PayBox({ order, onChange }: { order: PublicOrder; onChange: () => void }) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sinpe, setSinpe] = useState<{ amountUsdc: number; priceCrc: number; reference: string } | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'sinpe' | 'pin' | 'released' | 'dispute' | null>(null);

  const win = useAutoReleaseWindow();
  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(null); try { await f(); } catch (e) { trackError('paybox', e); setErr(friendlyPayError((e as Error).message)); } finally { setBusy(false); } };

  const sheets = <>
    <DisputeSheet visible={sheet === 'dispute'} onClose={() => setSheet(null)} slug={order.slug} onOpened={onChange} />
    <Sheet visible={sheet === 'sinpe' && !!sinpe && order.status === 'escrow_creado'} onClose={() => setSheet(null)} title="Pagá por SINPE Móvil"
      footer={<>
        {err && <ErrorText>{err}</ErrorText>}
        <PrimaryButton title="Ya pagué" icon="checkmark" loading={busy}
          onPress={() => run(async () => { track('pay_confirm_tapped'); const r = await api(auth, '/api/escrow/pay', { slug: order.slug, step: 'confirm_sinpe' }); track('payment_funded_client'); setPin(r.pin); setSheet('pin'); onChange(); })} />
        {!DEMO_ENABLED && <PrimaryButton title="Pagar directo con USDC (wallet Stellar)" icon="wallet-outline" variant="secondary" loading={busy}
          onPress={() => run(async () => {
            track('pay_direct_usdc_tapped');
            const x = await api(auth, '/api/escrow/pay', { slug: order.slug, step: 'fund_xdr' });
            const signedXdr = await auth.signXdr(x.unsignedXdr);
            const r = await api(auth, '/api/escrow/pay', { slug: order.slug, step: 'fund_direct', signedXdr });
            track('payment_funded_client'); setPin(r.pin); setSheet('pin'); onChange();
          })} />}
      </>}>
      {sinpe && <>
        <Card style={{ alignItems: 'center', paddingVertical: S.lg }}>
          <Text style={T.caption}>Monto</Text>
          <Text style={T.money}>{formatCRC(sinpe.priceCrc)}</Text>
          <Text style={T.footnote}>Referencia {sinpe.reference}</Text>
        </Card>
        <Row icon="lock-closed" text="Tu dinero queda apartado. El vendedor cobra cuando recibís el producto." />
        <Row icon="flask-outline" text='Modo prueba: no se mueve dinero real. Tocá "Ya pagué" para simular el pago.' />
      </>}
    </Sheet>
    <Sheet visible={sheet === 'pin' && !!pin} onClose={() => setSheet(null)}
      footer={<PrimaryButton title="Listo, lo guardé" onPress={() => setSheet(null)} />}>
      <SuccessCheck />
      <Text style={[T.title, { textAlign: 'center' }]}>¡Pago protegido!</Text>
      <Card style={{ alignItems: 'center' }}>
        <Text style={T.caption}>Tu PIN de entrega</Text>
        <Text style={{ fontFamily: Fonts.black, fontSize: 40, letterSpacing: 8, color: C.lilac, fontVariant: ['tabular-nums'] }} selectable>{pin}</Text>
      </Card>
      <Text style={[T.callout, { textAlign: 'center' }]}>Dáselo al vendedor solo cuando tengas el producto en la mano y lo hayas revisado.</Text>
    </Sheet>
    <Sheet visible={sheet === 'released'} onClose={() => setSheet(null)} footer={<PrimaryButton title="Cerrar" onPress={() => setSheet(null)} />}>
      <SuccessCheck celebrate />
      <Text style={[T.title, { textAlign: 'center' }]}>¡Listo! Pago liberado</Text>
      <Text style={[T.callout, { textAlign: 'center' }]}>Gracias por comprar seguro con Meteorito.</Text>
    </Sheet>
  </>;

  let footer: React.ReactNode = null;
  if (!auth.isAuthenticated) {
    footer = <PrimaryButton title="Entrar para pagar seguro" icon="shield-checkmark" onPress={auth.openLogin} />;
  } else if (order.status === 'creado' || (order.status === 'escrow_creado' && !sinpe)) {
    footer = <>
      {err && !sheet && <ErrorText>{err}</ErrorText>}
      <PrimaryButton title={busy ? 'Preparando…' : `Pagar seguro ${formatCRC(order.price_crc)}`} icon="shield-checkmark" loading={busy}
        onPress={() => run(async () => {
          // Comprador nuevo: activar su wallet (cuenta + trustline USDC patrocinadas) para poder recibir reembolsos.
          if (!order.contract_id) await ensureWalletReady(auth).catch((e) => { throw new Error(walletErrorNotice(e)); });
          const r = await api(auth, '/api/escrow/pay', { slug: order.slug, step: 'start', proof: await proof(auth, 'pay', order.slug) });
          setSinpe({ amountUsdc: r.amountUsdc, priceCrc: r.priceCrc, reference: r.sinpe.reference });
          setSheet('sinpe');
          onChange(); // refresca el pedido (escrow_creado) para que se abra la hoja SINPE (antes solo en demo: bug)
        })} />
    </>;
  } else if (sinpe && order.status === 'escrow_creado') {
    footer = <PrimaryButton title="Continuar pago" icon="arrow-forward" onPress={() => setSheet('sinpe')} />;
  } else if (order.status === 'enviado') {
    footer = <>
      <Text style={[T.footnote, { textAlign: 'center' }]}>
        Si no reportás un problema, el pago se libera solo{order.auto_release_at ? ` en ${timeLeft(order.auto_release_at)} (${new Date(order.auto_release_at).toLocaleString()})` : ` en ${win}`}.
      </Text>
      {err && <ErrorText>{err}</ErrorText>}
      <PrimaryButton title="Recibí y está bien" icon="checkmark-circle" loading={busy}
        onPress={() => run(async () => { await api(auth, '/api/escrow/confirm', { slug: order.slug, reason: 'buyer_confirm' }); setSheet('released'); onChange(); })} />
    </>;
  } else if (order.status === 'fondeado') {
    footer = pin ? <PrimaryButton title="Ver mi PIN de entrega" icon="keypad" variant="secondary" onPress={() => setSheet('pin')} />
      : <Text style={[T.callout, { textAlign: 'center' }]}>Pago protegido. Esperando que el vendedor lo envíe.</Text>;
  } else if (order.status === 'liberado' || order.status === 'resuelto' || order.status === 'entregado') {
    footer = <View style={{ flexDirection: 'row', gap: S.sm, justifyContent: 'center', alignItems: 'center', minHeight: 44 }}>
      <Icon name="checkmark-circle" size={22} color={C.success} /><Text style={[T.headline, { color: C.success }]}>{order.status === 'entregado' ? 'Entregado' : 'Pago liberado'}</Text>
    </View>;
  } else if (order.status === 'en_disputa') {
    footer = <Text style={[T.callout, { textAlign: 'center', color: C.orange }]}>En disputa: lo estamos revisando, respondemos en 24-48 h. El pago está en pausa.</Text>;
  }

  // Solo el comprador puede abrir disputa (la API lo verifica) y solo antes de liberar.
  const canDispute = auth.isAuthenticated && ['fondeado', 'enviado', 'entregado'].includes(order.status) && !order.released_tx;
  const problem = canDispute
    ? <PrimaryButton title="Tengo un problema" icon="alert-circle-outline" variant="ghost" onPress={() => { setErr(null); setSheet('dispute'); }} />
    : null;
  return <>{footer || problem ? <View style={{ gap: S.sm }}>{footer}{problem}</View> : null}{sheets}</>;
}

function Row({ icon, text }: { icon: React.ComponentProps<typeof Icon>['name']; text: string }) {
  return <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start' }}><Icon name={icon} size={20} color={C.lilac} /><Text style={[T.callout, { flex: 1 }]}>{text}</Text></View>;
}
