// Perfil público del vendedor: pago.meteorito.app/t/<usuario>. Se ve sin cuenta y se comparte (meta OG vía /api/store?og).
// Foto, nombre, identidad confirmada, estrellas, ventas y cómo salieron (sin montos), miembro desde, WhatsApp (solo si el vendedor lo puso), productos y reseñas
// de compras liberadas. Textos en lib/copy.ts. Lectura pública: GET /api/store?profile (caché corta, sin datos privados).
// Es también "Mi tienda": con la sesión del dueño viendo su propia tienda (isOwnerView) se agregan sus herramientas
// (OwnerTools) y sus productos en pausa. Visitantes e invitados nunca las ven. Compartir siempre visible.
// Tiendas de EJEMPLO (p.demo, api/_lib/demoProducts.ts): solo un iconito (i) discreto junto al nombre que abre un popup
// (components/DemoInfo.tsx); sin Seguir ni chat.
import { COPY } from '@/lib/copy';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { OwnerTools } from '@/components/OwnerTools';
import { SocialRow } from '@/components/SocialLinks';
import { clearStoreSocials, useIsAdmin } from '@/lib/admin';
import { FollowButton } from '@/components/FollowButton';
import { ChatButton } from '@/components/ChatButton';
import { DemoInfo } from '@/components/DemoInfo';
import { useAuth } from '@/lib/cavos';
import { isOwnerView, shareLink } from '@/lib/storePage';
import { Image, Linking, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { haptic, Icon, IconButton, PrimaryButton, Screen, Skeleton, st, toast, type IconName } from '@/components/ds';
import { BackButton } from '@/components/BackButton';
import { StoreAvatar } from '@/components/StoreAvatar';
import { ActivityLine, SalesOutcomeLine, StarRow, VerifiedBadge } from '@/components/SellerBits';
import { pressTransition } from '@/constants/motion';
import { C, R, S, T } from '@/constants/theme';
import { Fonts } from '@/constants/Colors';
import { formatCRC } from '@/lib/orders';
import { getMyStore, getSellerProfile, storeLink, type SellerProfile, type Store, type StoreItem } from '@/lib/store';
import { memberSince, timeAgo } from '@/lib/timeago';
import { useActivity } from '@/lib/useActivity';
import type { Activity } from '@/lib/activity';
import { track } from '@/lib/analytics';

export default function PerfilVendedor() {
  const { store: slug } = useLocalSearchParams<{ store: string }>();
  const [p, setP] = useState<SellerProfile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const auth = useAuth();
  const [mine, setMine] = useState<Store | null>(null); // tienda de la sesión (solo para saber si es el dueño)
  const [managing, setManaging] = useState<StoreItem | null>(null);
  useEffect(() => {
    if (!auth.isAuthenticated) { setMine(null); return; }
    let live = true;
    getMyStore(auth).then((x) => live && setMine(x)).catch(() => live && setMine(null));
    return () => { live = false; };
  }, [auth.isAuthenticated, auth.address]);
  const owner = !!p && isOwnerView(auth, mine?.store_slug, slug);
  const admin = useIsAdmin(auth); // solo para el botón 'Borrar redes' (el servidor decide)
  const acts = useActivity(p ? [p.store_slug] : []); // última conexión: aparte y sin caché
  useEffect(() => {
    if (!slug) return;
    let live = true;
    getSellerProfile(String(slug).toLowerCase())
      .then((x) => {
        if (!live) return; setP(x);
        if (x) track('seller_profile_viewed', { verified: x.verified, items: x.items.length, rating_count: x.rating_count, has_whatsapp: !!x.whatsapp });
        else track('store_not_found', {});
      })
      .catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [slug]);

  return (
    <Screen space="calm">
      <View style={st.rowBetween}>
        <BackButton fallback={owner ? '/vender' : '/comprar'} />
        {p ? <IconButton icon="share-outline" label={owner ? COPY.store.shareMine : COPY.store.share} onPress={() => shareProfile(p, owner)} /> : null}
      </View>
      {error ? <Notice icon="cloud-offline-outline" title="No pudimos abrir este perfil" text={error} />
        : p === null ? <Notice icon="storefront-outline" title="Este perfil no existe" text="Revisa el link o pídele al vendedor que te lo mande de nuevo." />
        : p === undefined ? <ProfileSkeleton /> : <Profile p={owner && mine ? { ...p, display_name: mine.display_name, avatar_url: mine.avatar_url ?? null, socials: mine.socials ?? p.socials } : p}
          activity={acts[p.store_slug] ?? null} owner={owner} admin={admin === true && !owner}
          onClearSocials={async () => { try { await clearStoreSocials(auth, p.store_slug); setP({ ...p, socials: {} }); toast('Redes borradas'); } catch (e) { toast((e as Error).message); } }} mine={mine} onMine={setMine} onManage={setManaging}
          tools={owner && mine ? <OwnerTools store={mine} onStore={setMine} managing={managing} onCloseManage={() => setManaging(null)} /> : null} />}
    </Screen>
  );
}

async function shareProfile(p: SellerProfile, owner = false) {
  const url = storeLink(p.store_slug);
  const text = owner ? COPY.store.shareMineText : COPY.store.shareText(p.display_name);
  const nav = Platform.OS === 'web' ? (globalThis.navigator as Navigator | undefined) : undefined;
  if (Platform.OS !== 'web') { track('seller_profile_shared', { method: 'native_share', verified: p.verified, owner }); await Share.share({ message: `${text} ${url}`, url }); return; }
  const method = await shareLink({ url, title: `${p.display_name} en Meteorito`, text }, nav?.share ? { share: (d) => nav.share!(d) } : undefined, (u) => Clipboard.setStringAsync(u).then(() => undefined));
  track('seller_profile_shared', { method, verified: p.verified, owner });
  if (method === 'copy') { haptic.success(); toast(COPY.store.linkCopied); }
}
function openWhatsApp(p: SellerProfile) {
  if (!p.whatsapp) return;
  haptic.tap(); track('seller_whatsapp_clicked', { verified: p.verified, source: 'profile' });
  const msg = encodeURIComponent(`Hola, ${p.display_name}. Vi tu perfil en Meteorito.`);
  Linking.openURL(`${p.whatsapp}?text=${msg}`).catch(() => {});
}

function Profile({ p, activity, owner, admin, onClearSocials, mine, onMine, onManage, tools }: { p: SellerProfile; activity: Activity | null; owner: boolean; admin: boolean; onClearSocials: () => void; mine: Store | null; onMine: (s: Store) => void; onManage: (it: StoreItem) => void; tools: ReactNode }) {
  // Dueño: sus productos de la sesión (incluye los en pausa) y tocar uno lo gestiona; visitante: los activos y tocar abre la ficha.
  const managed = new Set(owner && mine ? mine.items.map((i) => i.slug) : []);
  const items: StoreItem[] = owner && mine ? [...mine.items, ...p.items.filter((i) => !managed.has(i.slug))] : p.items;
  const rated = p.rating_count > 0 && p.rating_avg != null;
  const avg = rated ? Math.round(p.rating_avg! * 10) / 10 : 0;
  // Seguidores: solo el número (privado: nunca quiénes). null = todavía no disponible (sin migración 022): no se muestra.
  const [followers, setFollowers] = useState<number | null>(typeof p.followers === 'number' ? p.followers : null);
  useEffect(() => { setFollowers(typeof p.followers === 'number' ? p.followers : null); }, [p.store_slug, p.followers]);
  return (
    <View style={{ gap: S.lg }}>
      <View style={s.hero} testID="profile-hero">
        {/* Tarjeta horizontal: foto a la izquierda; nombre, insignias, seguidores, actividad y Seguir a la derecha. */}
        <View style={s.top}>
          {owner && mine ? <StoreAvatar store={mine} size={72} editable onChange={onMine} /> : <StoreAvatar store={p} size={72} />}
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
              <Text style={[T.title, { flexShrink: 1, fontSize: 22, lineHeight: 27 }]} numberOfLines={2} accessibilityRole="header">{p.display_name}</Text>
              {p.verified ? <VerifiedBadge size={18} /> : null}
              {p.demo ? <DemoInfo kind="store" onDark={false} /> : null}
            </View>
            <Text style={T.callout} numberOfLines={1}>@{p.store_slug}</Text>
            {followers != null ? <Text style={T.footnote} testID="followers-count"><Text style={{ color: C.text, fontFamily: Fonts.bold }}>{followers}</Text> {COPY.follow.followers(followers)}</Text> : null}
            <ActivityLine activity={activity} />
            {p.location ? <View style={s.metaRow}><Icon name="location-outline" size={14} color={C.textDim} /><Text style={T.footnote}>{p.location}</Text></View> : null}
            {!p.demo ? <SocialRow socials={p.socials} /> : null}
            {admin && !p.demo && p.socials && Object.keys(p.socials).length ? <PrimaryButton title="Borrar redes" icon="close-circle" variant="ghost" testID="admin-clear-socials" onPress={onClearSocials} /> : null}
            {!p.verified ? <View style={s.unverified} testID="unverified-note"><Icon name="information-circle-outline" size={14} color={C.textDim} /><Text style={[T.footnote, { flexShrink: 1 }]}>{COPY.identity.unconfirmed}</Text></View> : null}
            {!owner && !p.demo ? <View style={{ alignItems: 'flex-start', marginTop: S.xs }}>
              <FollowButton store={p} source="profile" onFollowers={(n, on) => setFollowers((cur) => (n != null ? n : cur == null ? null : Math.max(0, cur + (on ? 1 : -1))))} />
            </View> : null}
          </View>
        </View>
        {p.bio ? <Text style={[T.body, { paddingHorizontal: S.md }]} numberOfLines={4}>{p.bio}</Text> : null}
        <View style={s.stats}>
          <Stat icon="star" iconColor="#FFD84D" value={rated ? avg.toFixed(1) : 'Nuevo'} label={rated ? `${p.rating_count} reseña${p.rating_count === 1 ? '' : 's'}` : 'sin reseñas'} />
          <View style={s.statSep} />
          <Stat icon="bag-check-outline" value={String(p.sales_completed)} label={COPY.profile.salesDone(p.sales_completed)} />
          <View style={s.statSep} />
          <Stat icon="calendar-outline" value={memberSince(p.member_since) || '—'} label="miembro desde" />
        </View>
        <SalesOutcomeLine sales={p.sales} center />
      </View>

      <View style={{ gap: S.sm }}>
        {/* Chat dentro de Meteorito primero (la compra sigue en custodia); WhatsApp queda como alternativa. */}
        {!owner && !p.demo ? <ChatButton as="buyer" target={{ store_slug: p.store_slug }} source="store" variant="primary" testID="store-chat" /> : null}
        {p.whatsapp ? <PrimaryButton title="Escribir por WhatsApp" icon="logo-whatsapp" variant="secondary" onPress={() => openWhatsApp(p)} /> : null}
        <PrimaryButton testID="share-store" title={owner ? COPY.store.shareMine : COPY.store.share} icon="share-outline" variant={owner ? 'primary' : 'secondary'} onPress={() => shareProfile(p, owner)} />
        <View style={[s.metaRow, { justifyContent: 'center' }]}>
          <Icon name="lock-closed" size={13} color={C.textDim} />
          <Text style={[T.footnote, { textAlign: 'center', flexShrink: 1 }]}>{COPY.profile.escrowNote}</Text>
        </View>
      </View>

      {tools}

      <View style={{ gap: S.sm }}>
        <Text style={T.caption}>Productos ({items.length})</Text>
        {items.length ? (
          <View style={s.grid}>
            {items.map((it) => (
              <Pressable key={it.slug} accessibilityRole="link" accessibilityLabel={`${it.title}, ${formatCRC(it.price_crc)}`}
                onPress={() => { haptic.tap(); if (managed.has(it.slug)) onManage(it); else router.push({ pathname: '/p/[slug]', params: { slug: it.slug } }); }}
                style={({ pressed }) => [s.tile, pressTransition, pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] }]}>
                {it.photo ? <Image source={{ uri: it.photo }} style={s.tilePhoto} resizeMode="cover" accessibilityIgnoresInvertColors />
                  : <View style={[s.tilePhoto, s.noPhoto]}><Icon name="image-outline" size={28} color={C.lilac} /></View>}
                <View style={{ padding: S.sm, gap: 2 }}>
                  <Text style={[T.body, { fontSize: 14, lineHeight: 19 }]} numberOfLines={2}>{it.title}</Text>
                  <Text style={[T.headline, { fontSize: 15 }]} numberOfLines={1}>{formatCRC(it.price_crc)}</Text>
                  {owner && it.listing_status === 'pausada' ? <View style={s.metaRow}><Icon name="pause-circle-outline" size={13} color={C.textDim} /><Text style={T.footnote}>{COPY.store.paused}</Text></View> : null}
                </View>
              </Pressable>
            ))}
          </View>
        ) : <Empty icon="pricetags-outline" text={owner ? COPY.store.ownerEmpty : 'Este vendedor no tiene productos disponibles en este momento.'} />}
      </View>

      <View style={{ gap: S.sm }} testID="reviews">
        <Text style={T.caption}>Reseñas ({p.rating_count})</Text>
        {rated ? (
          <View style={s.summary}>
            <Text style={[T.money, { fontSize: 30 }]}>{avg.toFixed(1)}</Text>
            <View style={{ gap: 2 }}><StarRow value={avg} size={18} /><Text style={T.footnote}>{COPY.profile.reviewsCount(p.rating_count)}</Text></View>
          </View>
        ) : null}
        {p.reviews.length ? p.reviews.map((r, i) => (
          <View key={i} style={s.review}>
            <View style={st.rowBetween}><StarRow value={r.stars} size={14} /><Text style={T.footnote}>{timeAgo(r.created_at)}</Text></View>
            {r.comment ? <Text style={T.body}>{r.comment}</Text> : null}
            <View style={s.metaRow}><Icon name="shield-checkmark-outline" size={13} color={C.success} /><Text style={T.footnote}>{p.demo ? COPY.demoProducts.reviewBy(r.buyer_name) : COPY.profile.reviewBy(r.buyer_name)}</Text></View>
          </View>
        )) : <Empty icon="chatbubble-ellipses-outline" text={COPY.profile.noReviews} />}
      </View>
      <Text style={[T.footnote, { textAlign: 'center' }]}>Compras sin crear cuenta.</Text>
    </View>
  );
}

function Stat({ icon, iconColor = C.lilac, value, label }: { icon: IconName; iconColor?: string; value: string; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2, minWidth: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name={icon} size={15} color={iconColor} /><Text style={[T.headline, { fontSize: 17 }]} numberOfLines={1}>{value}</Text></View>
      <Text style={[T.footnote, { textAlign: 'center' }]} numberOfLines={2}>{label}</Text>
    </View>
  );
}
function Empty({ icon, text }: { icon: IconName; text: string }) {
  return <View style={s.emptyBox}><Icon name={icon} size={28} color={C.lilac} /><Text style={[T.callout, { textAlign: 'center' }]}>{text}</Text></View>;
}
function ProfileSkeleton() {
  return (
    <View style={{ gap: S.md, alignItems: 'center' }} testID="profile-skeleton">
      <View style={{ flexDirection: 'row', gap: S.md, alignSelf: 'stretch', alignItems: 'center' }}><Skeleton w={72} h={72} r={36} /><View style={{ flex: 1, gap: S.xs }}><Skeleton w="70%" h={24} /><Skeleton w="40%" h={16} /></View></View><Skeleton h={60} r={R.md} /><Skeleton h={50} r={R.pill} />
      <View style={{ flexDirection: 'row', gap: S.sm, alignSelf: 'stretch' }}><Skeleton w="48%" h={180} r={R.md} /><Skeleton w="48%" h={180} r={R.md} /></View>
    </View>
  );
}
function Notice({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <View style={{ alignItems: 'center', gap: S.md, paddingVertical: S.xl }}>
      <Icon name={icon} size={48} color={C.lilac} />
      <Text style={[T.title, { textAlign: 'center' }]}>{title}</Text>
      <Text style={[T.callout, { textAlign: 'center' }]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  hero: { backgroundColor: C.surface, borderRadius: R.lg, overflow: 'hidden', borderWidth: 0.5, borderColor: C.line, paddingTop: S.md, paddingBottom: S.md, gap: S.sm },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: S.md, paddingHorizontal: S.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  unverified: { alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: S.xs, paddingHorizontal: 10, paddingVertical: 3, borderRadius: R.pill, backgroundColor: 'rgba(255,255,255,0.06)' },
  stats: { flexDirection: 'row', alignItems: 'flex-start', marginHorizontal: S.md, marginTop: S.xs, paddingTop: S.sm + 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  statSep: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: C.line },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: S.sm },
  tile: { width: '48.5%', backgroundColor: C.surface, borderRadius: R.md, overflow: 'hidden', borderWidth: 0.5, borderColor: C.line },
  tilePhoto: { width: '100%', aspectRatio: 1, backgroundColor: C.lilacBg },
  noPhoto: { alignItems: 'center', justifyContent: 'center' },
  summary: { flexDirection: 'row', alignItems: 'center', gap: S.md, backgroundColor: C.surface, borderRadius: R.md, padding: S.md, borderWidth: 0.5, borderColor: C.line },
  review: { gap: S.xs + 2, backgroundColor: C.surface, borderRadius: R.md, padding: S.md, borderWidth: 0.5, borderColor: C.line },
  emptyBox: { alignItems: 'center', gap: S.sm, padding: S.lg, borderRadius: R.md, borderWidth: 1, borderStyle: 'dashed', borderColor: C.line },
});
