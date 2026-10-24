// Perfil público del vendedor: pago.meteorito.app/t/<usuario>. Se ve sin cuenta y se comparte (meta OG vía /api/store?og).
// Foto, nombre, identidad confirmada, estrellas, ventas y cómo salieron (sin montos), miembro desde, WhatsApp (solo si el vendedor lo puso), productos y reseñas
// de compras liberadas. Textos en lib/copy.ts. Lectura pública: GET /api/store?profile (caché corta, sin datos privados).
import { COPY } from '@/lib/copy';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Linking, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { haptic, Icon, IconButton, PrimaryButton, Screen, Skeleton, st, toast, type IconName } from '@/components/ds';
import { BackButton } from '@/components/BackButton';
import { StoreAvatar } from '@/components/StoreAvatar';
import { SalesOutcomeLine, StarRow, VerifiedBadge } from '@/components/SellerBits';
import { pressTransition } from '@/constants/motion';
import { C, R, S, T } from '@/constants/theme';
import { formatCRC } from '@/lib/orders';
import { getSellerProfile, storeLink, type SellerProfile } from '@/lib/store';
import { memberSince, timeAgo } from '@/lib/timeago';
import { track } from '@/lib/analytics';

export default function PerfilVendedor() {
  const { store: slug } = useLocalSearchParams<{ store: string }>();
  const [p, setP] = useState<SellerProfile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
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
        <BackButton fallback="/comprar" />
        {p ? <IconButton icon="share-outline" label="Compartir perfil" onPress={() => shareProfile(p)} /> : null}
      </View>
      {error ? <Notice icon="cloud-offline-outline" title="No pudimos abrir este perfil" text={error} />
        : p === null ? <Notice icon="storefront-outline" title="Este perfil no existe" text="Revisa el link o pídele al vendedor que te lo mande de nuevo." />
        : p === undefined ? <ProfileSkeleton /> : <Profile p={p} />}
    </Screen>
  );
}

async function shareProfile(p: SellerProfile) {
  const url = storeLink(p.store_slug);
  const text = `Mira el perfil de ${p.display_name} en Meteorito: compras sin crear cuenta y con el pago en custodia.`;
  const nav = Platform.OS === 'web' ? (globalThis.navigator as Navigator | undefined) : undefined;
  const method = Platform.OS !== 'web' ? 'native_share' : nav?.share ? 'web_share' : 'copy';
  track('seller_profile_shared', { method, verified: p.verified });
  if (Platform.OS !== 'web') { await Share.share({ message: `${text} ${url}`, url }); return; }
  if (nav?.share) {
    try { await nav.share({ title: `${p.display_name} en Meteorito`, text, url }); return; }
    catch (e: any) { if (e?.name === 'AbortError') return; }
  }
  try { await Clipboard.setStringAsync(url); } catch { /* sin portapapeles */ }
  haptic.success(); toast('Link del perfil copiado');
}
function openWhatsApp(p: SellerProfile) {
  if (!p.whatsapp) return;
  haptic.tap(); track('seller_whatsapp_clicked', { verified: p.verified, source: 'profile' });
  const msg = encodeURIComponent(`Hola, ${p.display_name}. Vi tu perfil en Meteorito.`);
  Linking.openURL(`${p.whatsapp}?text=${msg}`).catch(() => {});
}

function Profile({ p }: { p: SellerProfile }) {
  const rated = p.rating_count > 0 && p.rating_avg != null;
  const avg = rated ? Math.round(p.rating_avg! * 10) / 10 : 0;
  return (
    <View style={{ gap: S.lg }}>
      <View style={s.hero} testID="profile-hero">
        <View style={s.cover}><View style={s.orb1} /><View style={s.orb2} /></View>
        <View style={s.avatarRing}><StoreAvatar store={p} size={92} /></View>
        <View style={{ alignItems: 'center', gap: 2, paddingHorizontal: S.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
            <Text style={[T.title, { flexShrink: 1, textAlign: 'center' }]} numberOfLines={2} accessibilityRole="header">{p.display_name}</Text>
            {p.verified ? <VerifiedBadge size={20} /> : null}
          </View>
          <Text style={T.callout} numberOfLines={1}>@{p.store_slug}</Text>
          {p.bio ? <Text style={[T.body, { textAlign: 'center', marginTop: S.xs }]} numberOfLines={4}>{p.bio}</Text> : null}
          {p.location ? <View style={s.metaRow}><Icon name="location-outline" size={14} color={C.textDim} /><Text style={T.footnote}>{p.location}</Text></View> : null}
          {!p.verified ? <View style={s.unverified} testID="unverified-note"><Icon name="information-circle-outline" size={14} color={C.textDim} /><Text style={T.footnote}>{COPY.identity.unconfirmed}</Text></View> : null}
        </View>
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
        {p.whatsapp ? <PrimaryButton title="Escribir por WhatsApp" icon="logo-whatsapp" onPress={() => openWhatsApp(p)} /> : null}
        <PrimaryButton title="Compartir perfil" icon="share-outline" variant={p.whatsapp ? 'secondary' : 'primary'} onPress={() => shareProfile(p)} />
        <View style={[s.metaRow, { justifyContent: 'center' }]}>
          <Icon name="lock-closed" size={13} color={C.textDim} />
          <Text style={[T.footnote, { textAlign: 'center', flexShrink: 1 }]}>{COPY.profile.escrowNote}</Text>
        </View>
      </View>

      <View style={{ gap: S.sm }}>
        <Text style={T.caption}>Productos ({p.items.length})</Text>
        {p.items.length ? (
          <View style={s.grid}>
            {p.items.map((it) => (
              <Pressable key={it.slug} accessibilityRole="link" accessibilityLabel={`${it.title}, ${formatCRC(it.price_crc)}`}
                onPress={() => { haptic.tap(); router.push({ pathname: '/p/[slug]', params: { slug: it.slug } }); }}
                style={({ pressed }) => [s.tile, pressTransition, pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] }]}>
                {it.photo ? <Image source={{ uri: it.photo }} style={s.tilePhoto} resizeMode="cover" accessibilityIgnoresInvertColors />
                  : <View style={[s.tilePhoto, s.noPhoto]}><Icon name="image-outline" size={28} color={C.lilac} /></View>}
                <View style={{ padding: S.sm, gap: 2 }}>
                  <Text style={[T.body, { fontSize: 14, lineHeight: 19 }]} numberOfLines={2}>{it.title}</Text>
                  <Text style={[T.headline, { fontSize: 15 }]} numberOfLines={1}>{formatCRC(it.price_crc)}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : <Empty icon="pricetags-outline" text="Este vendedor no tiene productos disponibles en este momento." />}
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
            <View style={s.metaRow}><Icon name="shield-checkmark-outline" size={13} color={C.success} /><Text style={T.footnote}>{COPY.profile.reviewBy(r.buyer_name)}</Text></View>
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
      <Skeleton h={96} r={R.lg} /><Skeleton w={92} h={92} r={46} style={{ marginTop: -60 }} />
      <Skeleton w="55%" h={24} /><Skeleton w="30%" h={16} /><Skeleton h={60} r={R.md} /><Skeleton h={50} r={R.pill} />
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
  hero: { backgroundColor: C.surface, borderRadius: R.lg, overflow: 'hidden', borderWidth: 0.5, borderColor: C.line, paddingBottom: S.md, gap: S.sm },
  cover: { height: 96, backgroundColor: C.purple, overflow: 'hidden' },
  orb1: { position: 'absolute', width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(201,182,255,0.35)', top: -90, right: -30 },
  orb2: { position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,138,61,0.30)', bottom: -70, left: 20 },
  avatarRing: { alignSelf: 'center', marginTop: -58, padding: 4, borderRadius: 60, backgroundColor: C.surface },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  unverified: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: S.xs, paddingHorizontal: 10, paddingVertical: 3, borderRadius: R.pill, backgroundColor: 'rgba(255,255,255,0.06)' },
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
