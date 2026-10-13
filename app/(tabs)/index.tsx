import { ensureSellerWalletOnLoad, logoutSafely } from '@/lib/wallet';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '@/lib/cavos';
import { fetchBalances, type Balances } from '@/lib/horizon';
import { CRC_USDC_RATE, displayName, formatCRC, getSellerOrders, parseSlug, type SellerOrder } from '@/lib/orders';
import { supabaseConfigured } from '@/lib/supabase';
import { Card, ErrorText, haptic, Icon, IconButton, PrimaryButton, Screen, Section, Sheet, Skeleton, SkeletonCard, TestnetPill, type IconName } from '@/components/ds';
import { LivelyMascot, Reveal } from '@/components/space';
import { HelpSheet } from '@/components/HelpSheet';
import { OrderCard } from '@/components/OrderRow';
import { ui } from '@/components/ui';
import { AnalyticsToggle, LegalLinks } from '@/components/LegalLinks';
import { C, R, S, T, TOUCH, shadow } from '@/constants/theme';

const TESTNET = true; // MVP corre solo en testnet

export default function Inicio() {
  const auth = useAuth();
  const { email, address } = auth;
  const [bal, setBal] = useState<Balances | null>(null);
  const [err, setErr] = useState<string | null>(null);
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
    setLoading(true); setErr(null);
    try { setBal(await fetchBalances(address)); } catch (e) { setErr(String((e as Error).message ?? e)); }
    finally { setLoading(false); }
    if (supabaseConfigured) getSellerOrders(address).then((os) => { setOrders(os); ensureSellerWalletOnLoad(auth, os.length > 0).then((m) => m && setErr(m)); }).catch(() => setOrders([]));
    else setOrders([]);
  }, [address, auth.wallet.state]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const crc = bal ? Number(bal.usdc ?? 0) * CRC_USDC_RATE : 0;
  const name = displayName(email);
  const actions: { icon: IconName; label: string; hint: string; onPress: () => void }[] = [
    { icon: 'pricetag', label: 'Vender', hint: 'Creá un link de pago seguro', onPress: () => router.push('/vender') },
    { icon: 'link', label: 'Pagar un link', hint: 'Pegá el link del vendedor', onPress: () => setPayOpen(true) },
  ];

  return (
    <Screen title={name ? `Hola, ${name}` : 'Hola'} right={<IconButton icon="person" label="Mi cuenta" onPress={() => setAccount(true)} />}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.lilac} />}>
      {/* Tarjeta de saldo */}
      <Reveal i={0}><View style={[s.balance, shadow]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[T.caption, { color: C.lilac }]}>{TESTNET ? 'Saldo de prueba' : 'Saldo disponible'}</Text>
          <TestnetPill />
        </View>
        {!bal && !err ? <Skeleton w="70%" h={48} style={{ marginTop: S.sm }} />
          : <Text style={[T.money, { marginTop: S.sm }]} adjustsFontSizeToFit numberOfLines={1}>{formatCRC(crc)}</Text>}
        {err ? <Text style={[T.footnote, { color: C.orange }]}>No pudimos leer tu saldo. Deslizá hacia abajo para reintentar.</Text>
          : <Text style={[T.footnote, { color: C.lilac }]}>Tus cobros protegidos llegan acá.</Text>}
        <LivelyMascot size={104} style={s.mascot} parallax={-0.15} />
      </View></Reveal>
      {/* 2 acciones grandes */}
      <Reveal i={1}><View style={s.grid}>
        {actions.map((a, i) => (
          <Pressable key={a.label} accessibilityRole="button" accessibilityLabel={a.label}
            onPress={() => { haptic.tap(); a.onPress(); }}
            style={({ pressed }) => [s.action, i === 0 && s.actionPrimary, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
            <View style={[s.actionIcon, i === 0 && { backgroundColor: C.orange }]}><Icon name={a.icon} size={26} color={i === 0 ? '#fff' : C.purpleDark} /></View>
            <View style={{ gap: 2 }}>
              <Text style={s.actionLabel} numberOfLines={1}>{a.label}</Text>
              <Text style={T.footnote} numberOfLines={2}>{a.hint}</Text>
            </View>
          </Pressable>
        ))}
      </View></Reveal>

      <Reveal i={2}><Section title="Pedidos recientes" action={orders && orders.length > 0
        ? <Pressable onPress={() => router.push('/pedidos')} hitSlop={12} style={{ minHeight: TOUCH, justifyContent: 'center' }}><Text style={[T.headline, { color: C.lilac, fontSize: 15 }]}>Ver todos</Text></Pressable> : undefined}>
        {orders === null ? <><SkeletonCard /><SkeletonCard /></>
          : orders.length === 0 ? (
            <Card style={{ alignItems: 'center', paddingVertical: S.lg, gap: S.md }}>
              <Icon name="sparkles" size={28} color={C.lilac} />
              <Text style={[T.callout, { textAlign: 'center' }]}>Todavía no tenés pedidos. Creá tu primer link de venta en un minuto.</Text>
              <PrimaryButton title="Vender algo" icon="add" onPress={() => router.push('/vender')} />
            </Card>
          ) : orders.slice(0, 3).map((o, i) => <Reveal key={o.slug} i={3 + i}><OrderCard order={o} timeline={false} onPress={() => router.push('/pedidos')} /></Reveal>)}
      </Section></Reveal>

      <Sheet visible={payOpen} onClose={() => setPayOpen(false)} title="Pagar un link"
        footer={<PrimaryButton title="Ver producto" icon="arrow-forward" disabled={!linkSlug} onPress={goPay} />}>
        <Text style={T.callout}>Pegá el link que te mandó el vendedor (o solo el código).</Text>
        <TextInput style={ui.input} placeholder="meteorito.app/p/…" placeholderTextColor={C.textDim} value={link} onChangeText={setLink}
          autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="go" onSubmitEditing={goPay} autoFocus />
        {link.trim() && !linkSlug ? <ErrorText>Ese link no parece de Meteorito.</ErrorText> : null}
      </Sheet>
      <HelpSheet visible={help} onClose={() => setHelp(false)} />
      <Sheet visible={account} onClose={() => setAccount(false)} title="Mi cuenta"
        footer={<PrimaryButton title="Cerrar sesión" icon="log-out-outline" variant="secondary" onPress={async () => { const m = await logoutSafely(auth); if (m) { setLogoutMsg(m); return; } setLogoutMsg(null); setAccount(false); }} />}>
        {logoutMsg ? <ErrorText>{logoutMsg}</ErrorText> : null}
        <Card><Text style={T.caption}>Correo</Text><Text style={T.body}>{email ?? '—'}</Text></Card>
        <Card>
          <Text style={T.caption}>Detalles</Text>
          <Text style={T.footnote}>ID de cuenta (red de pruebas)</Text>
          <Text style={[T.footnote, { color: C.text }]} selectable>{address}</Text>
        </Card>
        <Card><AnalyticsToggle /></Card>
        <LegalLinks onNavigate={() => setAccount(false)} />
      </Sheet>
    </Screen>
  );
}

const s = StyleSheet.create({
  balance: { backgroundColor: C.purple, borderWidth: 1, borderColor: 'rgba(255,138,61,0.35)', borderRadius: R.lg, padding: S.lg, overflow: 'hidden', minHeight: 148, gap: S.xs },
  mascot: { position: 'absolute', right: -4, bottom: -6 },
  grid: { flexDirection: 'row', gap: S.sm },
  action: { flex: 1, backgroundColor: C.surface, borderRadius: R.lg, padding: S.md, gap: S.md, minHeight: 112, justifyContent: 'space-between', borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  actionPrimary: { borderColor: C.orange },
  actionIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: C.lilac, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { ...T.headline },
});
