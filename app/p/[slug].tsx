import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, ScrollView as RNScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { LivelyMascot, Reveal, ScrollCtx, SpaceBackground } from '@/components/space';
import { PayBox } from '@/components/PayBox';
import { Card, Chip, Icon, MoneyTimeline, moneyProgress, Skeleton, StickyFooter, st, statusTone, TestnetPill, type IconName } from '@/components/ds';
import { categoryIcon } from '@/components/categoryIcons';
import { C, R, S, T } from '@/constants/theme';
import { getCategory } from '@/lib/categories';
import { useAuth } from '@/lib/cavos';
import { formatCRC, getPublicOrder, STATUS_LABEL, type PublicOrder } from '@/lib/orders';

const EXPLORER = 'https://stellar.expert/explorer/testnet';
const HOW: { icon: IconName; title: string; text: string }[] = [
  { icon: 'lock-closed', title: 'Pagas protegido', text: 'Tu dinero queda apartado. El vendedor todavía no lo recibe.' },
  { icon: 'cube', title: 'Recibes y revisas', text: 'Cuando lo tengas en la mano y funcione, le das tu PIN al vendedor.' },
  { icon: 'cash', title: 'El vendedor cobra', text: 'Recién ahí se libera el pago. Si hay un problema, lo revisamos.' },
];
import { track } from '@/lib/analytics';
import { DEMO_ENABLED } from '@/lib/demo';

export default function LinkDeVenta() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { isAuthenticated, email } = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [order, setOrder] = useState<PublicOrder | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => { scrollY.value = e.contentOffset.y; });

  const load = () => { if (slug) getPublicOrder(String(slug)).then(setOrder).catch((e) => setError((e as Error).message)); };
  // Respaldo del pg_cron: si el plazo de liberación (AUTO_RELEASE_MINUTES) ya venció, pedirle al backend que libere (idempotente, verifica on-chain).
  useEffect(() => {
    if (!DEMO_ENABLED && order?.status === 'enviado' && order.auto_release_at && new Date(order.auto_release_at) <= new Date())
      fetch(`/api/escrow/cron?slug=${order.slug}`).then(() => load()).catch(() => {});
  }, [order?.status, order?.auto_release_at]);
  useEffect(load, [slug]);
  useEffect(() => { if (order) track('payment_link_opened', { status: order.status, logged_in: isAuthenticated, category: (order as any).category ?? null }); else if (order === null) track('payment_link_not_found'); }, [order === undefined ? 0 : order === null ? 1 : order.slug]);

  const contentW = Math.min(width, 560) - S.md * 2;

  if (error) return <Center icon="cloud-offline-outline" title="No se pudo cargar" text={error} />;
  if (order === null) return <Center icon="link-outline" title="Este link no existe" text="Pedile al vendedor que te mande el link de nuevo." />;

  const cat = order ? getCategory(order.category) : undefined;
  return (
    <ScrollCtx.Provider value={order?.status === 'creado' ? scrollY : null}>
    <View style={st.screen}>
      {/* Pantalla de pago: fondo tranquilo, sin efectos detrás del monto y el botón. */}
      <SpaceBackground mode="calm" />
      <Animated.ScrollView contentContainerStyle={[st.content, { paddingTop: insets.top + S.md }]} showsVerticalScrollIndicator={false}
        onScroll={onScroll} scrollEventThrottle={16}>
        <View style={st.rowBetween}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
            <LivelyMascot size={40} parallax={0.3} variant="mini" />
            <Text style={T.headline}>Meteorito</Text>
          </View>
          <TestnetPill />
        </View>

        {order === undefined ? (
          <View style={{ gap: S.md }}>
            <Skeleton h={contentW} r={R.lg} /><Skeleton w="70%" h={28} /><Skeleton w="40%" h={40} /><Skeleton h={120} r={R.lg} />
          </View>
        ) : <>
          {/* Tarjeta de producto */}
          <Reveal i={0}><Card style={{ padding: 0, overflow: 'hidden', gap: 0 }}>
            {order.photos.length > 0 ? (
              <RNScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
                {order.photos.map((u) => <Image key={u} source={{ uri: u }} style={{ width: contentW, height: contentW }} resizeMode="cover" />)}
              </RNScrollView>
            ) : (
              <View style={[s.noPhoto, { height: contentW * 0.6 }]}><Icon name={categoryIcon(order.category)} size={64} color={C.lilac} /></View>
            )}
            <View style={{ padding: S.md, gap: S.sm }}>
              <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
                <Chip label={cat?.label ?? order.category} icon={categoryIcon(order.category)} />
                <Chip label={order.condition} tone="muted" />
                <Chip label={STATUS_LABEL[order.status] ?? order.status} tone={statusTone(order.status)} />
              </View>
              <Text style={T.title}>{order.brand} {order.model}</Text>
              <TrustBlock order={order} />
              <Text style={T.money}>{formatCRC(order.price_crc)}</Text>
              {order.description ? <Text style={T.callout}>{order.description}</Text> : null}
            </View>
          </Card></Reveal>

          {moneyProgress(order.status) > 0 || order.status === 'en_disputa' ? (
            <Card style={{ gap: S.md }}>
              <Text style={T.caption}>Estado de tu pago</Text>
              <MoneyTimeline status={order.status} />
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

          <Card>
            <Text style={T.caption}>Lo que declara el vendedor</Text>
            {order.identifier_masked && <Text style={T.body}>Identificador: {order.identifier_masked}</Text>}
            {(order.checks_summary ?? []).map((c) => (
              <View key={c.id} style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center' }}>
                <Icon name={c.ok ? 'checkmark-circle' : 'close-circle'} size={20} color={c.ok ? C.success : C.orange} />
                <Text style={[T.body, { flex: 1 }, !c.ok && { color: C.orange }]}>{c.label}</Text>
              </View>
            ))}
            <Text style={T.footnote}>Son datos que declara el vendedor; Meteorito no los verifica (por ahora no hay verificación de IMEI ni de iCloud). Revisa el equipo cuando lo recibas, antes de darle tu PIN al vendedor.</Text>
          </Card>

          {(order.contract_id || order.funded_tx || order.released_tx) && (
            <View style={{ gap: S.xs }}>
              <Text style={T.caption}>Detalles</Text>
              {order.contract_id && <DetailLink label="Ver pago protegido" url={`${EXPLORER}/contract/${order.contract_id}`} />}
              {order.funded_tx && <DetailLink label="Ver comprobante de pago" url={`${EXPLORER}/tx/${order.funded_tx}`} />}
              {order.released_tx && <DetailLink label="Ver comprobante de liberación" url={`${EXPLORER}/tx/${order.released_tx}`} />}
            </View>
          )}
          {isAuthenticated && <Text style={[T.footnote, { textAlign: 'center' }]}>Sesión iniciada como {email}</Text>}
        </>}
      </Animated.ScrollView>
      {order ? <StickyFooter><PayBox order={order} onChange={load} /></StickyFooter> : null}
    </View>
    </ScrollCtx.Provider>
  );
}

function TrustBlock({ order }: { order: PublicOrder }) {
  return (
    <View style={{ gap: S.sm }}>
      {order.seller_name ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
          <View style={s.avatar}><Text style={[T.headline, { color: C.purpleDark }]}>{order.seller_name.charAt(0).toUpperCase()}</Text></View>
          <Text style={[T.callout, { flex: 1, color: C.text }]} numberOfLines={2}>
            Vendido por {order.seller_name}{order.seller_phone_verified === true ? ' · teléfono verificado' : ''}
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row' }}>
        <Chip label={order.identifier_masked ? 'Identificador declarado por el vendedor' : 'El vendedor no declaró identificador'} tone="muted" icon="information-circle-outline" />
      </View>
    </View>
  );
}

function DetailLink({ label, url }: { label: string; url: string }) {
  return (
    <Pressable onPress={() => Linking.openURL(url)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
      <Text style={[T.callout, { color: C.lilac }]}>{label}</Text><Icon name="open-outline" size={16} color={C.lilac} />
    </Pressable>
  );
}

function Center({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <View style={[st.screen, { alignItems: 'center', justifyContent: 'center', padding: S.lg, gap: S.md }]}>
      <Icon name={icon} size={48} color={C.lilac} />
      <Text style={[T.title, { textAlign: 'center' }]}>{title}</Text>
      <Text style={[T.callout, { textAlign: 'center' }]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.lilac, alignItems: 'center', justifyContent: 'center' },
  noPhoto: { backgroundColor: C.lilacBg, alignItems: 'center', justifyContent: 'center' },
  stepDot: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.lilac, alignItems: 'center', justifyContent: 'center' },
  stepLine: { flex: 1, width: 2, backgroundColor: C.surface2, marginTop: S.xs },
});
