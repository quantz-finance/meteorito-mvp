import { DEVICE_NOT_AUTHORIZED, ensureSellerWalletOnLoad, logoutSafely } from '@/lib/wallet';
import { OrphanWalletCard } from '@/components/OrphanWallet';
import { router, useFocusEffect } from 'expo-router';
import { lazy, Suspense, useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useStableWindow } from '@/lib/viewport';
import { GridPager } from '@/components/GridPager';
import { useAuth } from '@/lib/cavos';
import { displayName, formatCRC, getSellerOrders, parseSlug, type SellerOrder } from '@/lib/orders';
import { supabaseConfigured } from '@/lib/supabase';
import { Card, ErrorText, haptic, Icon, IconButton, PrimaryButton, Screen, Section, Sheet, Skeleton, SkeletonCard, type IconName } from '@/components/ds';
import { LivelyMascot, Reveal } from '@/components/space';
import { HelpSheet } from '@/components/HelpSheet';
import { OrderCard } from '@/components/OrderRow';
import { ui } from '@/components/ui';
import { AnalyticsToggle, LegalLinks } from '@/components/LegalLinks';
import { C, R, S, T, TOUCH, shadow } from '@/constants/theme';
const ProfileCard = lazy(() => import('@/components/Payout').then((m) => ({ default: m.ProfileCard }))); // diferido: solo al abrir Mi cuenta

const IN_PROGRESS = ['escrow_creado', 'fondeado', 'enviado', 'en_disputa'];
const DELIVERED = ['entregado', 'liberado', 'resuelto'];

export default function Inicio() {
  const auth = useAuth();
  const { email, address } = auth;
  const [walletMsg, setWalletMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<SellerOrder[] | null>(null);
  const [help, setHelp] = useState(false);
  const [account, setAccount] = useState(false);
  const [logoutMsg, setLogoutMsg] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [link, setLink] = useState('');
  const linkSlug = parseSlug(link);
  const goPay = () => { if (!linkSlug) return; setPayOpen(false); setLink(''); router.push(`/p/${linkSlug}`); };

  const load = useCallback(async () => {
    if (!address) return;
    if (!supabaseConfigured) { setOrders([]); return; }
    setLoading(true);
    try { const os = await getSellerOrders(address); setOrders(os); ensureSellerWalletOnLoad(auth, os.length > 0).then((m) => setWalletMsg(m)); }
    catch { setOrders((o) => o ?? []); }
    finally { setLoading(false); }
  }, [address, auth.wallet.state]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const short = useStableWindow().height < 740;
  const count = (sts: string[]) => (orders ?? []).filter((o) => sts.includes(o.status)).length;
  const stats = [
    { label: 'Publicados', n: count(['creado']) },
    { label: 'En curso', n: count(IN_PROGRESS) },
    { label: 'Entregados', n: count(DELIVERED) },
  ];
  const name = displayName(email);
  const actions: { icon: IconName; label: string; hint: string; onPress: () => void }[] = [
    { icon: 'pricetag', label: 'Vender', hint: 'Crea un link de pago en custodia', onPress: () => router.push('/vender') },
    { icon: 'link', label: 'Pagar un link', hint: 'Pega el link del vendedor', onPress: () => setPayOpen(true) },
  ];

  return (
    <Screen title={name ? `Hola, ${name}` : 'Hola'} right={<IconButton icon="person" label="Mi cuenta" onPress={() => setAccount(true)} />} scroll={false}>
      <View style={{ flex: 1, gap: short ? S.sm + 4 : S.md }}>
      {/* Resumen de ventas (sin saldo: los cobros van a la cuenta de banco o SINPE del vendedor) */}
      <Reveal i={0}><View style={[s.summary, shadow, short && { padding: S.md }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 24 /* mismo alto que antes (sin la etiqueta) */ }}>
          <Text style={[T.caption, { color: C.lilac }]}>Tus ventas</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: S.sm, paddingRight: short ? 64 : 84 }}>
          {stats.map((st) => (
            <View key={st.label} style={s.stat} accessibilityLabel={`${st.label}: ${st.n}`}>
              {orders === null ? <Skeleton w={28} h={28} /> : <Text style={s.statN}>{st.n}</Text>}
              <Text style={T.footnote} numberOfLines={1}>{st.label}</Text>
            </View>
          ))}
        </View>
        <Text style={[T.footnote, { color: C.lilac }]} numberOfLines={2}>Tus cobros llegan a tu cuenta de banco o SINPE.</Text>
        {walletMsg && walletMsg !== DEVICE_NOT_AUTHORIZED ? <Text style={[T.footnote, { color: C.orange }]} numberOfLines={2}>{walletMsg}</Text> : null}
        <LivelyMascot size={short ? 72 : 96} style={s.mascot} parallax={-0.15} />
      </View></Reveal>
      {walletMsg === DEVICE_NOT_AUTHORIZED || auth.wallet?.state === 'needs-approval' ? <OrphanWalletCard compact /> : null}
      {/* 2 acciones grandes */}
      <Reveal i={1}><View style={s.grid}>
        {actions.map((a, i) => (
          <Pressable key={a.label} accessibilityRole="button" accessibilityLabel={a.label}
            onPress={() => { haptic.tap(); a.onPress(); }}
            style={({ pressed }) => [s.action, short && s.actionShort, i === 0 && s.actionPrimary, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
            <View style={[s.actionIcon, short && { width: 40, height: 40, borderRadius: 13 }, i === 0 && { backgroundColor: C.orange }]}><Icon name={a.icon} size={short ? 22 : 26} color={i === 0 ? '#fff' : C.purpleDark} /></View>
            <View style={{ gap: 2, flexShrink: 1 }}>
              <Text style={s.actionLabel} numberOfLines={short ? 2 : 1}>{a.label}</Text>
              {short ? null : <Text style={T.footnote} numberOfLines={2}>{a.hint}</Text>}
            </View>
          </Pressable>
        ))}
      </View></Reveal>

      <Reveal i={2} style={{ flex: 1 }}><Section style={{ flex: 1 }} title="Pedidos recientes" action={orders && orders.length > 0
        ? <Pressable onPress={() => router.push('/pedidos')} hitSlop={12} style={{ minHeight: TOUCH, justifyContent: 'center' }}><Text style={[T.headline, { color: C.lilac, fontSize: 15 }]}>Ver todos</Text></Pressable> : undefined}>
        {orders === null ? <><SkeletonCard /><SkeletonCard /></>
          : orders.length === 0 ? (
            <Card style={{ alignItems: 'center', paddingVertical: S.lg, gap: S.md }}>
              <Icon name="sparkles" size={28} color={C.lilac} />
              <Text style={[T.callout, { textAlign: 'center' }]}>Todavía no tienes pedidos. Crea tu primer link de venta en un minuto.</Text>
              <PrimaryButton title="Vender algo" icon="add" onPress={() => router.push('/vender')} />
            </Card>
          ) : <View style={{ flex: 1 }}><GridPager items={orders.slice(0, 6)} keyOf={(o) => o.slug} minCellW={300} minCellH={66} maxCols={1} label="Página de pedidos"
              renderItem={(o) => <OrderCard order={o} timeline={false} fill onPress={() => router.push('/pedidos')} />} /></View>}
      </Section></Reveal>
      </View>

      <Sheet visible={payOpen} onClose={() => setPayOpen(false)} title="Pagar un link"
        footer={<PrimaryButton title="Ver producto" icon="arrow-forward" disabled={!linkSlug} onPress={goPay} />}>
        <Text style={T.callout}>Pega el link que te mandó el vendedor (o solo el código).</Text>
        <TextInput style={ui.input} placeholder="meteorito.app/p/…" placeholderTextColor={C.textDim} value={link} onChangeText={setLink}
          autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="go" onSubmitEditing={goPay} autoFocus />
        {link.trim() && !linkSlug ? <ErrorText>Ese link no parece de Meteorito.</ErrorText> : null}
      </Sheet>
      <HelpSheet visible={help} onClose={() => setHelp(false)} />
      <Sheet page visible={account} onClose={() => setAccount(false)} title="Mi cuenta"
        footer={<PrimaryButton title="Cerrar sesión" icon="log-out-outline" variant="secondary" onPress={async () => { const m = await logoutSafely(auth); if (m) { setLogoutMsg(m); return; } setLogoutMsg(null); setAccount(false); }} />}>
        {logoutMsg ? <ErrorText>{logoutMsg}</ErrorText> : null}
        {account ? <Suspense fallback={<SkeletonCard />}><ProfileCard products={(orders ?? []).length} /></Suspense> : null}
        <Card><Text style={T.caption}>Correo</Text><Text style={T.body}>{email ?? '—'}</Text></Card>
        <Card><AnalyticsToggle /></Card>
        <LegalLinks onNavigate={() => setAccount(false)} />
      </Sheet>
    </Screen>
  );
}

const s = StyleSheet.create({
  summary: { backgroundColor: C.purple, borderWidth: 1, borderColor: 'rgba(255,138,61,0.35)', borderRadius: R.lg, padding: S.lg, overflow: 'hidden', gap: S.sm },
  stat: { flex: 1, minWidth: 0, gap: 2 },
  statN: { ...T.title, fontSize: 26, lineHeight: 30, fontVariant: ['tabular-nums'] },
  mascot: { position: 'absolute', right: -4, bottom: -6 },
  grid: { flexDirection: 'row', gap: S.sm },
  action: { flex: 1, backgroundColor: C.surface, borderRadius: R.lg, padding: S.md, gap: S.md, minHeight: 112, justifyContent: 'space-between', borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  actionShort: { minHeight: 64, padding: S.sm + 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: S.sm },
  actionPrimary: { borderColor: C.orange },
  actionIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: C.lilac, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { ...T.headline },
});
