// Invitación de compra. Dos vistas según quién la abre:
//  - COMPRADOR (misma llave de invitado): estado en vivo + link para mandarle al vendedor + "Ir a pagar" cuando el vendedor publique.
//  - VENDEDOR (cualquier otro): resumen de lo que piden y "Publicar para esta compra" (requiere su cuenta Cavos).
import * as Clipboard from 'expo-clipboard';
import { userMessage } from '@/lib/cavosSession';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Platform, Pressable, Share, Text, View } from 'react-native';
import { Card, Chip, ErrorText, haptic, Icon, PrimaryButton, Screen, SkeletonCard, type IconName } from '@/components/ds';
import { toast } from '@/components/ds';
import { Freshness } from '@/components/Freshness';
import { C, S, T } from '@/constants/theme';
import { getCategory } from '@/lib/categories';
import { useAuth } from '@/lib/cavos';
import { cancelInvite, getInvite, inviteLink, type Invite } from '@/lib/invites';
import { inviteShareMessage, showCategoryChip } from '@/lib/inviteShare';
import { detectProvider } from '@/lib/listingImport';
import { formatCRC } from '@/lib/orders';
import { useOrdersRefresh } from '@/lib/useOrdersRefresh';
import { track } from '@/lib/analytics';
import { useStamp } from '@/lib/freshness';
import { keepIfSame } from '@/lib/refresh';

const STATUS: Record<Invite['status'], { label: string; tone: 'warn' | 'success' | 'muted' }> = {
  abierta: { label: 'Esperando al vendedor', tone: 'warn' }, aceptada: { label: 'El vendedor ya publicó', tone: 'success' }, cancelada: { label: 'Cancelada', tone: 'muted' },
};

export default function Invitacion() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const auth = useAuth();
  const [inv, setInv] = useState<Invite | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const stamp = useStamp(); // hora del último refresco: solo re-renderiza <Freshness>
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!code) return;
    try { const i = await getInvite(String(code)); setInv((prev) => keepIfSame(prev, i)); setErr(null); stamp.set(Date.now()); } catch (e) { setErr((e as Error).message); }
  }, [code]);
  useEffect(() => { load(); }, [load]);
  // Sincronización: el comprador ve al instante cuando el vendedor publica (y viceversa si la cancelan).
  useOrdersRefresh(load, inv ? [{ status: inv.status === 'abierta' ? 'creado' : 'liberado' }] : null);
  useEffect(() => { if (inv) track('invite_opened', { status: inv.status, as_buyer: inv.mine }); }, [inv?.status, inv?.mine]);

  if (err && inv === undefined) return <Msg icon="cloud-offline-outline" title="No se pudo cargar" text={err} />;
  if (inv === undefined) return <Screen back="/comprar" title="Invitación"><SkeletonCard /></Screen>;
  if (inv === null) return <Msg icon="link-outline" title="Esta invitación no existe" text="Revisa el link o pídelo de nuevo." />;

  const link = inviteLink(inv.code);
  const cat = getCategory(inv.category);
  const st = STATUS[inv.status];
  const name = `${inv.brand} ${inv.model}`.trim();
  // Mensaje listo para Messenger/WhatsApp (el link va dentro del texto: Messenger ignora `url` en algunos teléfonos).
  const src = inv.source_url ? detectProvider(inv.source_url) : null; // proveedor del anuncio (Facebook, Mercado Libre, Amazon, una tienda…)
  const where = src?.name ?? 'la tienda'; const whereIcon = (src?.icon ?? 'link') as IconName;
  const message = inviteShareMessage({ title: name, price_crc: inv.price_crc, source_url: inv.source_url }, link);

  async function share() {
    track('invite_shared', { from_facebook: src?.id === 'facebook', source_provider: src?.id ?? null });
    if (Platform.OS === 'web') {
      const nav = globalThis.navigator as Navigator | undefined;
      if (nav?.share) return nav.share({ title: 'Meteorito', text: message }).catch(() => {});
      await Clipboard.setStringAsync(message); haptic.success(); toast('Mensaje copiado. Pégalo en Messenger o WhatsApp.'); return;
    }
    await Share.share({ message });
  }
  async function copy() { await Clipboard.setStringAsync(link); haptic.success(); toast('Link copiado'); setCopied(true); setTimeout(() => setCopied(false), 2000); }

  const header = (
    <Card style={{ gap: S.sm }}>
      <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
        {showCategoryChip(inv.category) ? <Chip label={cat?.label ?? inv.category} /> : null}<Chip label={st.label} tone={st.tone} />
      </View>
      <View style={{ flexDirection: 'row', gap: S.sm + 4, alignItems: 'center' }}>
        {inv.photos?.length ? <Image testID="invite-photo" accessibilityLabel={`Foto de ${name}`} source={{ uri: inv.photos[0] }} style={{ width: 64, height: 64, borderRadius: 12, backgroundColor: C.lilacBg }} resizeMode="cover" /> : null}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={T.title} numberOfLines={3}>{name}</Text>
          <Text style={T.money}>{formatCRC(inv.price_crc)}</Text>
        </View>
      </View>
      {inv.photos && inv.photos.length > 1 ? <View style={{ flexDirection: 'row', gap: S.sm }}>{inv.photos.slice(1).map((u) => <Image key={u} source={{ uri: u }} style={{ width: 48, height: 48, borderRadius: 10 }} />)}</View> : null}
      {inv.note ? <Text style={T.callout}>“{inv.note}”</Text> : null}
      {inv.source_url ? (
        <Pressable accessibilityRole="link" accessibilityLabel={`Ver anuncio en ${where}`} hitSlop={8} onPress={() => { haptic.tap(); Linking.openURL(inv.source_url!).catch(() => {}); }}
          style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: S.xs, minHeight: 32 }, pressed && { opacity: 0.7 }]}>
          <Icon name={whereIcon} size={16} color={C.lilac} />
          <Text style={[T.footnote, { color: C.lilac, flexShrink: 1 }]} numberOfLines={1}>Ver anuncio en {where}</Text>
          <Icon name="open-outline" size={14} color={C.lilac} />
        </Pressable>
      ) : null}
    </Card>
  );

  if (inv.mine) {
    return (
      <Screen back="/comprar" title="Tu invitación" subtitle="Envíale este link al vendedor. Cuando publique el artículo, aquí aparece tu botón para pagar."
        footer={inv.status === 'aceptada' && inv.order_slug
          ? <PrimaryButton title="Ir a pagar en custodia" icon="shield-checkmark" onPress={() => router.push({ pathname: '/p/[slug]', params: { slug: inv.order_slug! } })} />
          : inv.status === 'abierta' ? <><PrimaryButton title="Enviar link al vendedor" icon="share-outline" onPress={share} />
            <PrimaryButton title={copied ? 'Link copiado' : 'Copiar link'} icon="copy-outline" variant="secondary" onPress={copy} /></> : null}>
        {header}
        <Card style={{ gap: S.sm }}>
          <Text style={T.caption}>Cómo sigue</Text>
          <Text style={T.callout}>1. El vendedor abre el link, publica el artículo con fotos y su cuenta.{'\n'}2. Tú recibes aquí el botón de pago (este link queda reservado para ti, en este navegador).{'\n'}3. Pagas en custodia y le das tu PIN solo cuando tengas el producto.</Text>
          <Freshness stamp={stamp} live={inv.status === 'abierta'} />
        </Card>
        {inv.status === 'abierta' && (
          <PrimaryButton title="Cancelar invitación" variant="ghost" loading={busy} onPress={async () => { setBusy(true); try { await cancelInvite(auth, inv.code); await load(); } catch (e) { setErr(userMessage((e as Error).message)); } finally { setBusy(false); } }} />
        )}
        {err && <ErrorText>{err}</ErrorText>}
      </Screen>
    );
  }

  // Vista del vendedor.
  const open = inv.status === 'abierta';
  return (
    <Screen back="/comprar" title="Quieren comprarte" subtitle={inv.source_url ? `Vieron tu anuncio en ${where} y quieren pagarte en custodia.` : 'Alguien te invitó a vender este artículo en custodia.'}
      footer={open ? <PrimaryButton title={auth.isAuthenticated ? 'Publicar para esta compra' : 'Entrar para publicar'} icon="add-circle-outline"
        loading={auth.isLoading}
        onPress={() => { if (!auth.isAuthenticated) return auth.openLogin(); router.push({ pathname: '/vender', params: { invite: inv.code } }); }} /> : null}>
      {header}
      {!open && <Card><Text style={T.callout}>{inv.status === 'aceptada' ? 'Esta invitación ya fue aceptada con otra publicación.' : 'El comprador canceló esta invitación.'}</Text></Card>}
      {open && <Card style={{ gap: S.sm }}>
        <Text style={T.caption}>Qué haces</Text>
        <Text style={T.callout}>Publicas el artículo (fotos, estado) al precio acordado. Te damos un link de pago que solo puede usar quien te invitó. El dinero queda en custodia hasta que entregues y el comprador confirme con su PIN.</Text>
      </Card>}
      <Freshness stamp={stamp} live={open} />
    </Screen>
  );
}

function Msg({ icon, title, text }: { icon: React.ComponentProps<typeof Icon>['name']; title: string; text: string }) {
  return <Screen back="/comprar"><View style={{ alignItems: 'center', gap: S.md, paddingVertical: S.xl }}><Icon name={icon} size={48} color={C.lilac} /><Text style={[T.title, { textAlign: 'center' }]}>{title}</Text><Text style={[T.callout, { textAlign: 'center' }]}>{text}</Text></View></Screen>;
}
