import { timeLeft, useAutoReleaseWindow } from '@/lib/autorelease';
import { friendlyPayError, ensureWalletReady } from '@/lib/wallet';
// Comprador: Pagar en custodia -> tarjeta (formulario propio, components/CardSheet.tsx), cripto discreto (components/CryptoSheet.tsx) o SINPE simulado ("Ya pagué") -> fondos en escrow TW testnet. Luego "Recibí".
// Mismas llamadas a la API que antes; la UI vive en el footer fijo + bottom sheets.
import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { DisputeSheet } from '@/components/DisputeSheet';
import { Image, Pressable, Text, View } from 'react-native';
import { deliveryCodeVisible, F2F_CODE_HINT, F2F_PAID, PAID_WAITING } from '@/lib/shipping';
import { agreementSummary, payAcceptText } from '../api/_lib/agreement';
import { CUSTODY_RELEASE } from '@/lib/rules';
import { ExtensionBox } from '@/components/ExtensionBox';
import { Card, ErrorText, Icon, PrimaryButton, Sheet, SuccessCheck } from '@/components/ds';
import { Fonts } from '@/constants/Colors';
import { C, S, T } from '@/constants/theme';
import { api, guestApi, proof } from '@/lib/api';
import { myListingOrder, rememberListingOrder } from '@/lib/listings';
import { loadGrant, loadPin, savePin, useGuestVault } from '@/lib/guest';
import { reissuePin } from '@/lib/buyerContact';
import { useAuth } from '@/lib/cavos';
import { formatCRC, orderTitle, type PublicOrder } from '@/lib/orders';
import { rememberPurchase } from '@/lib/purchases';
import { resolvedLabel } from '@/lib/status';
import { track, trackError } from '@/lib/analytics';
import { DEMO_ENABLED } from '@/lib/demo';
import { ChainLinks } from '@/components/ChainLinks';
import { openCardWidget } from '@/lib/cardPay';
import { CardSheet, type CardPayInput } from '@/components/CardSheet';
import { CryptoSheet } from '@/components/CryptoSheet';
import { pressTransition } from '@/constants/motion';
import { BetaNotice } from '@/components/RulesLink';
import { LegalRuleRows } from '@/components/LegalRules';
import { legalRulesFor, PAY_RULES_HEADING } from '@/lib/rules';
import { replyPhase, shipDeadline } from '../api/_lib/orderRules';
import { leftLabel, useNow, whenLabel } from '@/lib/ruleTimes';

const CARD_PROCESSING = 'Tu pago con tarjeta se está procesando. Vuelve a tocar "Pagar con tarjeta" en unos segundos.';
const CARD_PROCESSING_INAPP = 'Tu pago se está procesando. Vuelve a tocar "Pagar" en unos segundos: no se te cobra dos veces.';
const CARD_POLL_MS = 2500, CARD_POLL_MAX_MS = 120_000; // "demorada": ~30 s en Lendara
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export function PayBox({ order, onChange }: { order: PublicOrder; onChange: () => void }) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sinpe, setSinpe] = useState<{ amountUsdc: number; priceCrc: number; reference: string } | null>(null);
  const vault = useGuestVault(); // la bóveda cifrada carga async: re-render al terminar
  const [pin, setPinState] = useState<string | null>(() => loadPin(order.slug)); // el PIN queda en este navegador (comprador invitado, cifrado)
  useEffect(() => { if (!pin) { const p = loadPin(order.slug); if (p) setPinState(p); } }, [vault, order.slug]); // eslint-disable-line react-hooks/exhaustive-deps
  const setPin = (p: string | null) => { setPinState(p); if (p) savePin(order.slug, p); };
  const granted = !!loadGrant(order.slug); // abrió un link de acceso (correo / WhatsApp) en este dispositivo
  const buyerHere = !!pin || granted || auth.isAuthenticated; // este dispositivo es el del comprador (PIN o link de acceso) o hay sesión
  const [sheet, setSheet] = useState<'method' | 'card' | 'sinpe' | 'crypto' | 'paid' | 'photo' | 'released' | 'dispute' | 'cancel' | null>(null);
  const [legacyGuest, setLegacyGuest] = useState(false); // identidad histórica indicada por el servidor
  const [card, setCard] = useState(false); // el servidor tiene el pago con tarjeta configurado (start -> card)
  const [crypto, setCrypto] = useState(false); // pago con cripto (USDC/XLM en Stellar) disponible (start -> crypto)
  // 'inapp' (default): nuestro formulario. 'widget': respaldo con el widget de Lendara (LENDARA_MODE=widget en el servidor).
  const [cardMode, setCardMode] = useState<'inapp' | 'widget'>('inapp');
  const startPayment = async () => {
    await ensureWalletReady(auth);
    return api(auth, '/api/escrow/pay', { slug: order.slug, step: 'start', proof: await proof(auth, 'pay', order.slug) });
  };
  const payOpen = (r: any) => {
    setLegacyGuest(r.guest === true);
    setSinpe({ amountUsdc: r.amountUsdc, priceCrc: r.priceCrc, reference: r.sinpe.reference }); setCard(!!r.card); setCrypto(!!r.crypto);
    setCardMode(r.cardMode === 'inapp' ? 'inapp' : 'widget'); setSheet(r.card || r.crypto ? 'method' : 'sinpe');
  };

  const win = useAutoReleaseWindow();
  // Reglas con texto legal que rigen para ESTE pedido (su versión): se ven en "Al pagar aceptas", antes de pagar.
  const legal = <LegalRuleRows rules={legalRulesFor(order)} heading={PAY_RULES_HEADING} />;
  // Regla v1 "Reembolso si no se envía": plazo fijo de 3 días desde el pago para "Ya lo envié" (no es el plazo acordado).
  const now = useNow();
  const sd = shipDeadline(order, now);
  // Regla v2 "Respuesta de quien vende en 48 h" (sin 034 no hay plazo en la vista pública: mensaje de siempre).
  const rp = order.dispute_reply_due_at || order.dispute_replied_at ? replyPhase(order, now) : { phase: 'na' as const, dueAt: null };
  const f2f = order.delivery_mode === 'cara_a_cara';
  // Acuerdo que el comprador ve antes de pagar (y acepta al pagar: el servidor lo registra en order_events).
  const agreement = agreementSummary(order.delivery_mode, order.protection_minutes);
  const agreementRow = <View testID="agreement" style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center', justifyContent: 'center' }}>
    <Icon name={f2f ? 'people-outline' : 'cube-outline'} size={18} color={C.lilac} />
    <Text style={[T.footnote, { color: C.text, flexShrink: 1 }]}>{agreement}</Text>
  </View>;
  const ext = buyerHere ? <ExtensionBox order={order} role="buyer" onChange={onChange} call={(b) => guestApi(auth, '/api/escrow/confirm', { slug: order.slug, ...b })} /> : null;
  const left = order.auto_release_at ? timeLeft(order.auto_release_at) : win;
  const releaseNote = <Text style={[T.footnote, { textAlign: 'center' }]}>
    {left ? `El pago se libera solo en ${left} si no reportas un problema.` : `El pago ${CUSTODY_RELEASE}.`}
  </Text>;
  const codeBox = (hint: string) => pin ? <View style={{ alignItems: 'center', gap: 2 }}>
    <Text style={T.caption}>Tu código de entrega</Text>
    <Text testID="delivery-code" style={{ fontFamily: Fonts.black, fontSize: 30, letterSpacing: 6, color: C.lilac, fontVariant: ['tabular-nums'] }} selectable>{pin}</Text>
    <Text style={[T.footnote, { textAlign: 'center' }]}>{hint}</Text>
  </View> : granted ? <View style={{ alignItems: 'center', gap: S.xs }}>
    <Text style={[T.footnote, { textAlign: 'center' }]}>Tu código de entrega quedó en el navegador donde pagaste. Si no lo tienes, genera uno nuevo: el anterior deja de servir.</Text>
    <PrimaryButton testID="pin-reissue" title="Generar código nuevo" icon="refresh" variant="ghost" loading={busy}
      onPress={() => run(async () => { const r = await reissuePin(auth, order.slug); setPin(r.pin); })} />
  </View> : <Text style={T.footnote}>Tu código de entrega está en el navegador donde pagaste.</Text>;
  const confirmBtn = <PrimaryButton title="Recibí y está bien" icon="checkmark-circle" loading={busy}
    onPress={() => run(async () => { await guestApi(auth, '/api/escrow/confirm', { slug: order.slug, reason: 'buyer_confirm' }); setSheet('released'); onChange(); })} />;
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
      const r = await startPayment();
      payOpen(r);
    });
  }, [pay, order.status]); // eslint-disable-line react-hooks/exhaustive-deps
  // Mis compras: cada compra queda registrada en este dispositivo (al iniciar y al completar el pago) para volver a /p/<pedido>.
  const remember = (slug: string, status: string) => rememberPurchase({ slug, title: orderTitle(order), price_crc: Number(order.price_crc), photo: order.photos?.[0] ?? null, status, delivery_mode: order.delivery_mode });
  const funded = (r: { pin?: string | null }, method: 'card' | 'sinpe' | 'crypto') => {
    // El código de entrega se guarda en este navegador pero NO se muestra todavía: aparece cuando el vendedor lo envía.
    remember(order.slug, 'fondeado'); track('payment_funded_client', { method }); if (r.pin) setPin(r.pin); setSheet(r.pin || pin ? 'paid' : null); onChange();
  };
  // Tarjeta in-app: el servidor cobra (card_pay) y verifica (card_confirm). Número y CVC no salen de CardSheet.
  const payCardInApp = async (p: CardPayInput) => {
    track('card_pay_submitted');
    try {
      let r = await api(auth, '/api/escrow/pay', { slug: order.slug, step: 'card_pay', name: p.name, email: p.email, scenario: p.scenario });
      const t0 = Date.now();
      while (r.pending && Date.now() - t0 < CARD_POLL_MAX_MS) {
        await sleep(CARD_POLL_MS);
        r = await api(auth, '/api/escrow/pay', { slug: order.slug, step: 'card_confirm' });
      }
      if (r.pending) throw new Error(CARD_PROCESSING_INAPP);
      funded(r, 'card');
    } catch (e: any) {
      trackError('card_pay', e);
      // unavailable: el sondeo se corta. Reintentar no cambia la respuesta.
      if (e?.code === 'unavailable') throw e;
      throw new Error(friendlyPayError((e as Error).message));
    }
  };
  // Tarjeta (respaldo widget): sesión en el servidor -> widget de Lendara (iframe) -> el servidor verifica y fondea (card_confirm).
  const payCard = () => run(async () => {
    track('card_pay_tapped');
    const s = await api(auth, '/api/escrow/pay', { slug: order.slug, step: 'card_session' });
    if (s.fundedTx) return funded(s, 'card'); // un pago anterior ya se había completado
    if (s.pending) { setErr(CARD_PROCESSING); return; }
    setSheet(null); // la hoja (Modal) atrapa el foco: el iframe del widget no recibiría el teclado
    const out = await openCardWidget(s.url);
    setSheet('method');
    if (out === 'closed') { track('card_widget_closed'); return; }
    const r = await api(auth, '/api/escrow/pay', { slug: order.slug, step: 'card_confirm' });
    if (r.pending) { setErr(CARD_PROCESSING); return; }
    funded(r, 'card');
  });
  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(null); try { await f(); } catch (e) { trackError('paybox', e); setErr(friendlyPayError((e as Error).message)); } finally { setBusy(false); } };

  const sheets = <>
    <DisputeSheet visible={sheet === 'dispute'} onClose={() => setSheet(null)} slug={order.slug} onOpened={onChange} order={order} />
    <Sheet visible={sheet === 'method' && !!sinpe && order.status === 'escrow_creado'} onClose={() => setSheet(null)} title="Elige cómo pagar"
      footer={<>
        {err && <ErrorText>{err}</ErrorText>}
        {card ? <PrimaryButton title="Pagar con tarjeta" icon="card" loading={busy}
          onPress={cardMode === 'inapp' ? () => { track('card_pay_tapped'); setErr(null); setSheet('card'); } : payCard} /> : null}
        <PrimaryButton title="Pagar por SINPE Móvil" icon="phone-portrait-outline" variant={card ? 'secondary' : 'primary'} disabled={busy} onPress={() => { setErr(null); setSheet('sinpe'); }} />
        {crypto ? <Pressable testID="pay-crypto" accessibilityRole="button" accessibilityLabel="Pagar con cripto" hitSlop={4} disabled={busy}
          onPress={() => { track('crypto_tapped'); setErr(null); setSheet('crypto'); }}
          style={({ pressed }) => [{ alignSelf: 'center', minHeight: 44, paddingHorizontal: S.md, flexDirection: 'row', alignItems: 'center', gap: 6 }, pressTransition, pressed && { opacity: 0.7 }]}>
          <Icon name="swap-horizontal" size={16} color={C.lilac} />
          <Text style={[T.footnote, { color: C.lilac, fontSize: 14 }]}>Cripto</Text>
        </Pressable> : null}
      </>}>
      {sinpe && <>
        <Card style={{ alignItems: 'center', paddingVertical: S.lg }}>
          <Text style={T.caption}>Monto</Text>
          <Text style={T.money}>{formatCRC(sinpe.priceCrc)}</Text>
        </Card>
        <Row icon="lock-closed" text="Tu pago queda en custodia. El vendedor cobra cuando recibes el producto." />
        <Row icon={f2f ? 'people-outline' : 'cube-outline'} text={payAcceptText(order.delivery_mode, order.protection_minutes)} />
        {legal}
      </>}
    </Sheet>
    <CardSheet visible={sheet === 'card' && !!sinpe && order.status === 'escrow_creado'} amountCrc={sinpe?.priceCrc ?? Number(order.price_crc)}
      onClose={() => setSheet('method')} onPay={payCardInApp} onSinpe={() => { setErr(null); setSheet('sinpe'); }} />
    <CryptoSheet visible={sheet === 'crypto' && !!sinpe && order.status === 'escrow_creado'} priceCrc={sinpe?.priceCrc ?? Number(order.price_crc)}
      onClose={() => setSheet(null)} onBack={() => setSheet('method')}
      call={(step, extra) => api(auth, '/api/escrow/pay', { slug: order.slug, step, ...extra })}
      onFunded={(r) => funded(r, 'crypto')} />
    <Sheet visible={sheet === 'sinpe' && !!sinpe && order.status === 'escrow_creado'} onClose={() => setSheet(null)} title="Paga por SINPE Móvil"
      footer={<>
        {err && <ErrorText>{err}</ErrorText>}
        <PrimaryButton title="Ya pagué" icon="checkmark" loading={busy}
          onPress={() => run(async () => { track('pay_confirm_tapped'); const r = await api(auth, '/api/escrow/pay', { slug: order.slug, step: 'confirm_sinpe' }); funded(r, 'sinpe'); })} />
      </>}>
      {sinpe && <>
        <Card style={{ alignItems: 'center', paddingVertical: S.lg }}>
          <Text style={T.caption}>Monto</Text>
          <Text style={T.money}>{formatCRC(sinpe.priceCrc)}</Text>
          <Text style={T.footnote}>Referencia {sinpe.reference}</Text>
        </Card>
        <Row icon="lock-closed" text="Tu pago queda en custodia. El vendedor cobra cuando recibes el producto." />
        <Row icon={f2f ? 'people-outline' : 'cube-outline'} text={payAcceptText(order.delivery_mode, order.protection_minutes)} />
        {legal}
        <Row icon="information-circle-outline" text="En esta prueba, el fondeo simulado procede de la tesorería testnet, no del saldo de tu cuenta." />
        <Row icon="information-circle-outline" text='No envíes dinero: toca "Ya pagué" para continuar.' />
      </>}
    </Sheet>
    <Sheet visible={sheet === 'paid'} onClose={() => setSheet(null)}
      footer={<PrimaryButton title="Entendido" onPress={() => setSheet(null)} />}>
      <SuccessCheck />
      <Text style={[T.title, { textAlign: 'center' }]}>{f2f ? F2F_PAID : PAID_WAITING}</Text>
      <Row icon="lock-closed" text="Tu pago queda en custodia. El vendedor cobra cuando recibes el producto." />
      {f2f ? codeBox(F2F_CODE_HINT) : <Row icon="cube-outline" text="Cuando lo envíe, aquí vas a ver tu código de entrega." />}
      <Text style={[T.footnote, { textAlign: 'center' }]}>{legacyGuest
        ? 'Esta compra histórica conserva el acceso mediante la llave de este navegador; iniciar sesión no la vincula automáticamente a tu cuenta.'
        : 'Tu compra queda ligada a tu cuenta. Este navegador guarda tu código de entrega. Puedes elegir cómo recibir avisos de tu compra; es opcional.'}</Text>
      <BetaNotice from="pin" onNavigate={() => setSheet(null)} />
      <ChainLinks order={order} align="center" />
    </Sheet>
    <Sheet visible={sheet === 'photo' && !!ship?.photo} onClose={() => setSheet(null)} title="Foto del envío"
      footer={<PrimaryButton title="Cerrar" variant="secondary" onPress={() => setSheet(null)} />}>
      {ship?.photo ? <Image testID="ship-photo-full" source={{ uri: ship.photo }} style={{ width: '100%', aspectRatio: 3 / 4, borderRadius: 12 }} resizeMode="contain" accessibilityLabel="Foto del envío" /> : null}
      {ship?.note ? <Text style={[T.callout, { textAlign: 'center' }]} selectable>{ship.note}</Text> : null}
    </Sheet>
    <Sheet visible={sheet === 'cancel' && order.status === 'fondeado'} onClose={() => setSheet(null)} title="Cancelar la compra"
      footer={<>
        {err && <ErrorText>{err}</ErrorText>}
        <PrimaryButton testID="ship-cancel-confirm" title="Cancelar y recibir reembolso" icon="arrow-undo-outline" loading={busy}
          onPress={() => run(async () => { await guestApi(auth, '/api/escrow/confirm', { slug: order.slug, reason: 'cancel_unshipped' }); track('ship_cancel_buyer'); setSheet(null); onChange(); })} />
        <PrimaryButton title="Seguir esperando" variant="ghost" disabled={busy} onPress={() => setSheet(null)} />
      </>}>
      <Row icon="arrow-undo-outline" text="Recibes todo tu pago de vuelta desde la custodia y la compra se cancela." />
      <Row icon="time-outline" text={sd.autoAt ? `Si no cancelas, el reembolso se hace solo el ${whenLabel(sd.autoAt)}.` : 'Si no cancelas, el reembolso se hace solo.'} />
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
      {agreementRow}
      {mine ? <PrimaryButton title="Ver mi pedido" icon="receipt-outline" variant="ghost" onPress={() => router.push({ pathname: '/p/[slug]', params: { slug: mine } })} /> : null}
      <BetaNotice from="pay" custody />
      <PrimaryButton title={busy ? 'Preparando…' : `Pagar en custodia ${formatCRC(order.price_crc)}`} icon="shield-checkmark" loading={busy}
        onPress={() => run(async () => {
          const r = await startPayment();
          remember(r.slug ?? order.slug, 'escrow_creado');
          if (r.slug && r.slug !== order.slug) { // producto permanente: seguir en el pedido propio de este comprador
            rememberListingOrder(order.slug, r.slug); track('listing_order_started');
            router.replace({ pathname: '/p/[slug]', params: { slug: r.slug, pay: '1' } }); return;
          }
          payOpen(r);
          onChange(); // refresca el pedido (escrow_creado) para que se abra la hoja SINPE (antes solo en demo: bug)
        })} />
    </>;
  } else if (sinpe && order.status === 'escrow_creado') {
    footer = <PrimaryButton title="Continuar pago" icon="arrow-forward" onPress={() => { setErr(null); setSheet(card || crypto ? 'method' : 'sinpe'); }} />;
  } else if (order.status === 'enviado' && !buyerHere) {
    footer = <Text style={[T.callout, { textAlign: 'center' }]}>Pedido enviado. El comprador confirma la recepción desde el mismo navegador donde pagó.</Text>;
  } else if (order.status === 'enviado') {
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
        {deliveryCodeVisible(order.status, order.delivery_mode) ? codeBox('Dáselo al vendedor cuando lo recibas.') : null}
      </Card>
      {releaseNote}
      {err && <ErrorText>{err}</ErrorText>}
      {confirmBtn}
      {ext}
    </>;
  } else if (order.status === 'fondeado' && f2f && buyerHere) {
    // Cara a cara: sin envío. El código se ve ya; el vendedor lo ingresa cuando el comprador revisa el producto.
    footer = <>
      <Card style={{ gap: S.sm, paddingVertical: S.sm + 2 }}>
        <View style={{ flexDirection: 'row', gap: S.sm + 2, alignItems: 'center' }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' }}><Icon name="people" size={22} color={C.purpleDark} /></View>
          <Text style={[T.headline, { flex: 1 }]}>Entrega cara a cara</Text>
        </View>
        {codeBox(F2F_CODE_HINT)}
      </Card>
      {releaseNote}
      {err && <ErrorText>{err}</ErrorText>}
      {confirmBtn}
      {ext}
    </>;
  } else if (order.status === 'fondeado' && f2f) {
    footer = <Text style={[T.callout, { textAlign: 'center' }]}>Pagado. Entrega cara a cara: el comprador tiene el código en el navegador donde pagó.</Text>;
  } else if (order.status === 'fondeado' && (sd.phase === 'cancelable' || sd.phase === 'auto_due')) {
    // Regla v1: pasaron 3 días sin "Ya lo envié" -> quien compra puede cancelar y recibir todo su pago de vuelta.
    footer = <>
      <Card testID="ship-late" style={{ gap: S.xs, paddingVertical: S.sm + 2 }}>
        <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center' }}>
          <Icon name="time-outline" size={20} color={C.orange} />
          <Text style={[T.headline, { flex: 1 }]}>Sin envío en 3 días</Text>
        </View>
        <Text style={T.callout}>{buyerHere ? "Quien vende no marcó 'Ya lo envié'. Puedes cancelar y recibir todo tu pago de vuelta." : "Quien vende no marcó 'Ya lo envié' en 3 días."}</Text>
        {sd.autoAt ? <Text testID="ship-auto-at" style={T.footnote}>{`Si no cancelas, el reembolso se hace solo el ${whenLabel(sd.autoAt)}.`}</Text> : null}
      </Card>
      {err && !sheet && <ErrorText>{err}</ErrorText>}
      {buyerHere ? <PrimaryButton testID="ship-cancel" title="Cancelar y recibir reembolso" icon="arrow-undo-outline" onPress={() => { setErr(null); setSheet('cancel'); }} /> : null}
    </>;
  } else if (order.status === 'fondeado') {
    footer = <View style={{ gap: S.xs, alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', gap: S.sm, justifyContent: 'center', alignItems: 'center', minHeight: 44 }}>
        <Icon name="time-outline" size={20} color={C.lilac} /><Text style={[T.callout, { textAlign: 'center', flexShrink: 1 }]}>{PAID_WAITING}</Text>
      </View>
      {sd.cancelAt && sd.phase !== 'na' ? <Text testID="ship-deadline" style={[T.footnote, { textAlign: 'center' }]}>
        {`Quien vende tiene hasta el ${whenLabel(sd.cancelAt)} (${leftLabel(sd.cancelAt, now)}) para marcar 'Ya lo envié'.`}
      </Text> : null}
    </View>;
  } else if (order.status === 'liberado' || order.status === 'resuelto' || order.status === 'entregado') {
    footer = <View style={{ flexDirection: 'row', gap: S.sm, justifyContent: 'center', alignItems: 'center', minHeight: 44 }}>
      <Icon name="checkmark-circle" size={22} color={C.success} /><Text style={[T.headline, { color: C.success }]}>{resolvedLabel(order)}</Text>
    </View>;
  } else if (order.status === 'en_disputa' && order.ship_cancel) {
    footer = <Text testID="ship-refund-pending" style={[T.callout, { textAlign: 'center' }]}>Compra cancelada por falta de envío: todo tu pago vuelve desde la custodia.</Text>;
  } else if (order.status === 'en_disputa' && rp.phase !== 'na') {
    // Regla v2: cuenta regresiva de las 48 h de quien vende (las dos partes la ven).
    footer = <Card testID="reply-rule-buyer" style={{ gap: S.xs, paddingVertical: S.sm + 2 }}>
      <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center' }}>
        <Icon name={rp.phase === 'replied' ? 'chatbubbles-outline' : 'timer-outline'} size={20} color={C.orange} />
        <Text style={[T.headline, { flex: 1 }]}>{rp.phase === 'replied' ? 'Quien vende respondió' : 'En disputa'}</Text>
      </View>
      <Text testID="reply-countdown" style={T.callout}>
        {rp.phase === 'replied' ? 'Una persona del equipo revisa las dos versiones y decide. El pago sigue en custodia.'
          : rp.phase === 'due' ? 'Quien vende no respondió en 48 h: se te reembolsa desde la custodia.'
          : `Quien vende tiene hasta el ${whenLabel(rp.dueAt)} (${leftLabel(rp.dueAt, now)}) para responder. Mientras tanto, el pago sigue en custodia.`}
      </Text>
    </Card>;
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
