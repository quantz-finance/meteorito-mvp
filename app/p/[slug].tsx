import { router, useLocalSearchParams } from 'expo-router';
import { COPY } from '@/lib/copy';
import { SalesOutcomeLine, StarsInline, VerifiedBadge } from '@/components/SellerBits';
import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Reveal } from '@/components/space';
import { PayBox } from '@/components/PayBox';
import { BackButton } from '@/components/BackButton';
import { PrimaryButton, Screen } from '@/components/ds';
import { ChainLinks, chainLinks } from '@/components/ChainLinks';
import { toast, Card, Chip, Icon, MoneyTimeline, moneyProgress, Skeleton, st, statusTone, type IconName } from '@/components/ds';
import { categoryIcon } from '@/components/categoryIcons';
import { C, R, S, T } from '@/constants/theme';
import { getCategory } from '@/lib/categories';
import { useAuth } from '@/lib/cavos';
import { formatCRC, getPublicOrder, orderTitle, STATUS_LABEL, type PublicOrder } from '@/lib/orders';
import { isBuyerDevice } from '@/lib/guest';
import { SellerContact } from '@/components/SellerContact';
import { canShowContact } from '../../api/_lib/contact';
import { haptic } from '@/components/ds';
import { getOrderSeller, rateOrder, ratedStars, rememberRated, type OrderSeller } from '@/lib/store';
import { useStamp } from '@/lib/freshness';
import { keepIfSame } from '@/lib/refresh';
import { lazy, Suspense } from 'react';
const PushCard = lazy(() => import('@/components/PushCard')); // diferido: solo tras pagar

const HOW: { icon: IconName; title: string; text: string }[] = [
  { icon: 'lock-closed', title: 'Pagas en custodia', text: 'Tu pago queda en custodia (escrow). El vendedor todavía no lo recibe.' },
  { icon: 'cube', title: 'Recibes y revisas', text: 'Cuando lo tengas en la mano y funcione, le das tu PIN al vendedor.' },
  { icon: 'cash', title: 'El vendedor cobra', text: 'Recién ahí se libera el pago. Si hay un problema, lo revisamos.' },
];
import { track } from '@/lib/analytics';
import { Freshness } from '@/components/Freshness';
import { LearnSheet } from '@/components/LearnSheet';
import { useOrdersRefresh } from '@/lib/useOrdersRefresh';
import { DEMO_ENABLED } from '@/lib/demo';
import { RulesHint } from '@/components/RulesLink';
import { PAY_SUMMARY } from '@/lib/rules';

export default function LinkDeVenta() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { isAuthenticated, email } = useAuth();
  const [order, setOrder] = useState<PublicOrder | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const stamp = useStamp(); // hora del último refresco: solo re-renderiza <Freshness>
  const [learn, setLearn] = useState(false);

  const load = () => { if (slug) getPublicOrder(String(slug)).then((o) => { setOrder(o); setError(null); stamp.set(Date.now()); }).catch((e) => setError((e as Error).message)); };
  // Sincronización con el servidor: si el vendedor envía o el comprador paga, esta pantalla lo refleja sola (cada POLL_MS y al volver el foco).
  const silent = async () => { if (!slug) return; try { const o = await getPublicOrder(String(slug)); setOrder((prev) => keepIfSame(prev, o)); stamp.set(Date.now()); } catch { /* reintenta en el siguiente ciclo */ } };
  useOrdersRefresh(silent, order ? [order] : null);
  // Respaldo del pg_cron: si el plazo de liberación (AUTO_RELEASE_MINUTES) ya venció, pedirle al backend que libere (idempotente, verifica on-chain).
  useEffect(() => {
    // Cara a cara: el plazo corre desde el pago (sigue en 'fondeado').
    const running = order?.status === 'enviado' || (order?.status === 'fondeado' && order.delivery_mode === 'cara_a_cara');
    if (!DEMO_ENABLED && running && order.auto_release_at && new Date(order.auto_release_at) <= new Date())
      fetch(`/api/escrow/cron?slug=${order.slug}`).then(() => load()).catch(() => {});
  }, [order?.status, order?.auto_release_at]);
  useEffect(load, [slug]);
  // Cuando el polling trae un estado nuevo, avisar con un toast suave (el chip y el timeline animan solos).
  const prevStatus = useRef<string | null>(null);
  useEffect(() => {
    const st0 = order?.status ?? null;
    if (prevStatus.current && st0 && st0 !== prevStatus.current) toast(`Actualizado: ${STATUS_LABEL[st0] ?? st0}`, 'info');
    prevStatus.current = st0;
  }, [order?.status]);
  useEffect(() => { if (order) track('payment_link_opened', { status: order.status, logged_in: isAuthenticated, category: (order as any).category ?? null }); else if (order === null) track('payment_link_not_found'); }, [order === undefined ? 0 : order === null ? 1 : order.slug]);

  if (error) return <Center icon="cloud-offline-outline" title="No se pudo cargar" text={error} />;
  if (order === null) return <Center icon="link-outline" title="Este link no existe" text="Pídele al vendedor que te mande el link de nuevo." />;

  // Mismo encabezado y tarjeta que la invitación (/i/<code>): título grande, miniatura junto al nombre y el precio.
  const unpaid = !order || order.status === 'creado' || order.status === 'escrow_creado';
  const title = unpaid ? 'Link de pago' : 'Tu compra';
  const subtitle = unpaid ? 'Pagas sin crear cuenta. El vendedor cobra cuando recibes.' : 'Aquí ves cada paso hasta que recibas. Se actualiza sola.';
  if (order === undefined) return (
    <Screen back="/pedidos" title={title} space="calm">
      <Skeleton h={120} r={R.lg} /><Skeleton h={160} r={R.lg} />
    </Screen>
  );

  const cat = getCategory(order.category);
  const name = orderTitle(order);
  return (
    <Screen back="/pedidos" title={title} subtitle={subtitle} space="calm" footer={<PayBox order={order} onChange={load} />}>
      {/* Tarjeta de producto */}
      <Reveal i={0}><Card style={{ gap: S.sm }}>
        <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
          {order.category && order.category !== 'otro' ? <Chip label={cat?.label ?? order.category} icon={categoryIcon(order.category)} /> : null}
          {order.condition?.trim() ? <Chip label={order.condition} tone="muted" /> : null}
          <Chip key={order.status} swap label={STATUS_LABEL[order.status] ?? order.status} tone={statusTone(order.status)} />
        </View>
        <View style={{ flexDirection: 'row', gap: S.sm + 4, alignItems: 'center' }}>
          {order.photos.length > 0
            ? <Image testID="order-photo" accessibilityLabel={`Foto de ${name}`} source={{ uri: order.photos[0] }} style={s.thumb} resizeMode="cover" />
            : <View style={[s.thumb, s.noPhoto]}><Icon name={categoryIcon(order.category)} size={28} color={C.lilac} /></View>}
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={T.title} numberOfLines={3}>{name}</Text>
            <Text style={T.money}>{formatCRC(order.price_crc)}</Text>
          </View>
        </View>
        {order.photos.length > 1 ? <View style={{ flexDirection: 'row', gap: S.sm }}>
          {order.photos.slice(1).map((u, i) => <Image key={`${u}-${i}`} testID="order-photo-extra" source={{ uri: u }} style={s.extra} resizeMode="cover" />)}
        </View> : null}
        <TrustBlock order={order} />
        {order.description ? <Text style={T.callout}>{order.description}</Text> : null}
      </Card></Reveal>
      {/* Reglas en una línea, solo antes de pagar (Ver reglas -> /como-funciona). */}
      {unpaid ? <RulesHint text={PAY_SUMMARY} from="pay" /> : null}

      {moneyProgress(order.status) > 0 || order.status === 'en_disputa' ? (
        <Card style={{ gap: S.md }}>
          <Text style={T.caption}>Estado de tu pago</Text>
          <MoneyTimeline status={order.status} shipped={!!(order as any).shipped_tx} mode={order.delivery_mode} />
        </Card>
      ) : (
        <Card style={{ gap: S.md }}>
          <Text style={T.caption}>Cómo funciona</Text>
          {HOW.map((h, i) => (
            <View key={h.title} style={{ flexDirection: 'row', gap: S.md }}>
              <View style={{ alignItems: 'center' }}>
                <View style={s.stepDot}><Icon name={h.icon} size={18} color={C.purpleDark} /></View>
                {i < HOW.length - 1 && <View style={s.stepLine} />}
              </View>
              <View style={{ flex: 1, paddingBottom: i < HOW.length - 1 ? S.md : 0 }}>
                <Text style={T.headline}>{h.title}</Text>
                <Text style={T.callout}>{h.text}</Text>
              </View>
            </View>
          ))}
        </Card>
      )}

      {/* WhatsApp del vendedor: solo el comprador (su dispositivo) y solo después de pagar; el servidor lo vuelve a validar. */}
      {canShowContact(order.status) && isBuyerDevice(order.slug) ? <SellerContact slug={order.slug} /> : null}
      {RATABLE.includes(order.status) && isBuyerDevice(order.slug) ? <RateCard slug={order.slug} /> : null}
      {['fondeado', 'enviado', 'en_disputa'].includes(order.status) && isBuyerDevice(order.slug)
        ? <Suspense fallback={null}><PushCard role="buyer" /></Suspense> : null}

      {order.identifier_masked || (order.checks_summary ?? []).length > 0 ? <Card>
        <Text style={T.caption}>Lo que declara el vendedor</Text>
        {order.identifier_masked && <Text style={T.body}>Identificador: {order.identifier_masked}</Text>}
        {(order.checks_summary ?? []).map((c) => (
          <View key={c.id} style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center' }}>
            <Icon name={c.ok ? 'checkmark-circle' : 'close-circle'} size={20} color={c.ok ? C.success : C.orange} />
            <Text style={[T.body, { flex: 1 }, !c.ok && { color: C.orange }]}>{c.label}</Text>
          </View>
        ))}
        <Text style={T.footnote}>Son datos que declara el vendedor; Meteorito no los verifica (por ahora no hay verificación de IMEI ni de iCloud). Revisa el equipo cuando lo recibas, antes de darle tu PIN al vendedor.</Text>
      </Card> : null}

      {chainLinks(order).length > 0 && (
        <View style={{ gap: S.xs }}>
          <Text style={T.caption}>Evidencia en la blockchain</Text>
          <ChainLinks order={order} />
        </View>
      )}
      <PrimaryButton title="¿Qué es la custodia en blockchain?" variant="ghost" icon="help-circle-outline" onPress={() => setLearn(true)} />
      <LearnSheet visible={learn} onClose={() => setLearn(false)} />
      <Freshness stamp={stamp} live={!['liberado', 'resuelto', 'cancelado'].includes(order.status)} align="center" />
      {isAuthenticated && <Text style={[T.footnote, { textAlign: 'center' }]}>Sesión iniciada como {email}</Text>}
    </Screen>
  );
}

const RATABLE = ['entregado', 'liberado'];
/** Calificación del comprador (1-5), una sola vez por pedido. El servidor valida la llave de invitado/sesión y el estado. */
function RateCard({ slug }: { slug: string }) {
  const auth = useAuth();
  const [done, setDone] = useState<number | null>(() => ratedStars(slug));
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function send(stars: number) {
    setPick(stars); setErr(null); setBusy(true);
    try { await rateOrder(auth, slug, stars); rememberRated(slug, stars); setDone(stars); haptic.success(); }
    catch (e: any) {
      if (e?.code === 'already_rated') { rememberRated(slug, stars); setDone(stars); }
      else { setErr(e?.message ?? 'No pudimos guardar tu calificación.'); setPick(0); }
    } finally { setBusy(false); }
  }
  const shown = done ?? pick;
  return (
    <Card style={{ gap: S.sm, alignItems: 'center' }}>
      <Text style={T.headline}>{done ? '¡Gracias por calificar!' : '¿Cómo te fue con el vendedor?'}</Text>
      <View style={{ flexDirection: 'row', gap: S.xs }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} accessibilityRole="button" accessibilityLabel={`${n} estrella${n === 1 ? '' : 's'}`} disabled={!!done || busy}
            onPress={() => send(n)} hitSlop={4} style={({ pressed }) => [{ padding: 6 }, pressed && { transform: [{ scale: 0.9 }] }]}>
            <Icon name={n <= shown ? 'star' : 'star-outline'} size={34} color={n <= shown ? '#FFD84D' : C.textDim} />
          </Pressable>
        ))}
      </View>
      {err ? <Text style={[T.footnote, { color: C.orange, textAlign: 'center' }]}>{err}</Text>
        : <Text style={[T.footnote, { textAlign: 'center' }]}>{done ? 'Tu calificación ayuda a otros compradores.' : 'Toca de 1 a 5 estrellas. Solo puedes calificar una vez.'}</Text>}
    </Card>
  );
}

function TrustBlock({ order }: { order: PublicOrder }) {
  // Vendedor de la ficha (perfil corto + cómo salieron sus ventas, sin montos). Si no carga, la ficha sigue igual.
  const [seller, setSeller] = useState<OrderSeller | null>(null);
  useEffect(() => { let on = true; getOrderSeller(order.slug).then((x) => { if (on) setSeller(x); }); return () => { on = false; }; }, [order.slug]);
  const name = seller?.display_name ?? order.seller_name ?? null;
  return (
    <View style={{ gap: S.sm }}>
      {name ? (
        <Pressable disabled={!seller} accessibilityRole={seller ? 'link' : undefined} accessibilityLabel={seller ? `${COPY.ficha.seeProfile}: ${name}` : undefined}
          onPress={() => { if (!seller) return; track('feed_item_clicked', { target: 'seller', from: 'ficha', verified: seller.verified }); router.push({ pathname: '/t/[store]', params: { store: seller.store_slug } }); }}
          style={({ pressed }) => [{ gap: 6 }, pressed && { opacity: 0.7 }]} testID="ficha-seller">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
            {seller?.avatar_url ? <Image source={{ uri: seller.avatar_url }} style={s.avatar} accessibilityIgnoresInvertColors />
              : <View style={s.avatar}><Text style={[T.headline, { color: C.purpleDark }]}>{name.charAt(0).toUpperCase()}</Text></View>}
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={[T.callout, { color: C.text, flexShrink: 1 }]} numberOfLines={1}>{COPY.ficha.soldBy(name)}</Text>
                {seller?.verified ? <VerifiedBadge size={15} /> : null}
              </View>
              {seller ? <StarsInline avg={seller.rating_avg} count={seller.rating_count} /> : null}
            </View>
            {seller ? <Icon name="chevron-forward" size={18} color={C.textDim} /> : null}
          </View>
          {seller ? <SalesOutcomeLine sales={seller.sales} /> : null}
        </Pressable>
      ) : null}
      {order.identifier_masked ? <View style={{ flexDirection: 'row' }}>
        <Chip label="Identificador declarado por el vendedor" tone="muted" icon="information-circle-outline" />
      </View> : null}
    </View>
  );
}

function Center({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[st.screen, { alignItems: 'center', justifyContent: 'center', padding: S.lg, gap: S.md }]}>
      <View style={{ position: 'absolute', top: insets.top + S.md, left: S.md }}><BackButton fallback="/pedidos" /></View>
      <Icon name={icon} size={48} color={C.lilac} />
      <Text style={[T.title, { textAlign: 'center' }]}>{title}</Text>
      <Text style={[T.callout, { textAlign: 'center' }]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.lilac, alignItems: 'center', justifyContent: 'center' },
  noPhoto: { backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 64, height: 64, borderRadius: 12, backgroundColor: C.lilacBg },
  extra: { width: 48, height: 48, borderRadius: 10, backgroundColor: C.lilacBg },
  stepDot: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.lilac, alignItems: 'center', justifyContent: 'center' },
  stepLine: { flex: 1, width: 2, backgroundColor: C.surface2, marginTop: S.xs },
});
