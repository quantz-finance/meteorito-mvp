// Herramientas del dueño en su propia tienda (/t/<usuario>). Solo se monta cuando isOwnerView() es true: la sesión es del
// dueño y la URL es su tienda. Visitantes e invitados nunca la ven. Lo que antes vivía en /mi-tienda: editar nombre o
// usuario, cobros, Mi cuenta (WhatsApp y su interruptor público, correo, sesión), historial, y por producto pausar,
// reactivar, archivar o copiar su anuncio. Todo sigue protegido en el API con la sesión.
import { router } from 'expo-router';
import { lazy, Suspense, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { AccountSheet } from '@/components/AccountSheet';
import { AdTemplateSheet } from '@/components/AdTemplateSheet';
import { Card, ErrorText, Icon, ListRow, PrimaryButton, Sheet, Skeleton, toast } from '@/components/ds';
import { ui } from '@/components/ui';
import { C, R, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { userMessage } from '@/lib/cavosSession';
import { COPY } from '@/lib/copy';
import { track } from '@/lib/analytics';
import { formatCRC, orderLink } from '@/lib/orders';
import { HISTORY_TITLE, type AdInput } from '@/lib/sellerTools';
import { SOCIAL_ICON, SOCIALS_TITLE, SocialInputs, socialKeysOf } from '@/components/SocialLinks';
import { SOCIAL_KEYS, type SocialKey } from '../api/_lib/socials';
import { setListingStatus, updateMyStore, type Store, type StoreItem } from '@/lib/store';
const PayoutEntry = lazy(() => import('@/components/Payout').then((m) => ({ default: m.PayoutEntry }))); // diferido

export function OwnerTools({ store, onStore, managing, onCloseManage }: {
  store: Store; onStore: (s: Store) => void; managing: StoreItem | null; onCloseManage: () => void;
}) {
  const auth = useAuth();
  const [editing, setEditing] = useState<false | 'all' | 'socials'>(false); const [account, setAccount] = useState(false); // 'socials': la hoja solo con las redes (fila "Tus redes")
  const [ad, setAd] = useState<AdInput | null>(null);
  const [promote, setPromote] = useState(false); // "Promocionar este producto": por ahora solo avisa (sin cobro)
  const [slug, setSlug] = useState(''); const [name, setName] = useState('');
  const [socials, setSocials] = useState<Partial<Record<SocialKey, string>>>({});
  const [err, setErr] = useState<string | null>(null); const [saving, setSaving] = useState(false);

  function openEdit(mode: 'all' | 'socials') { setSlug(store.store_slug); setName(store.display_name); setSocials({ ...store.socials }); setErr(null); setEditing(mode); }
  async function save() {
    setErr(null); setSaving(true);
    try {
      const patch: { store_slug?: string; display_name?: string; socials?: Partial<Record<SocialKey, string>> } = {};
      if (slug.trim().toLowerCase() !== store.store_slug) patch.store_slug = slug.trim().toLowerCase();
      if (name.trim() !== store.display_name) patch.display_name = name.trim();
      if (SOCIAL_KEYS.some((k) => (socials[k] ?? '').trim() !== (store.socials?.[k] ?? ''))) patch.socials = socials;
      if (Object.keys(patch).length) {
        const next = await updateMyStore(auth, patch); onStore(next); toast('Tienda actualizada');
        if (next.store_slug !== store.store_slug) router.replace({ pathname: '/t/[store]', params: { store: next.store_slug } });
      }
      setEditing(false);
    } catch (e) { setErr(userMessage((e as Error).message)); }
    finally { setSaving(false); }
  }
  async function setStatus(status: 'activa' | 'pausada' | 'archivada') {
    if (!managing) return;
    setErr(null); setSaving(true);
    try {
      onStore(await setListingStatus(auth, managing.slug, status));
      toast(status === 'activa' ? 'Producto activo' : status === 'pausada' ? 'Producto en pausa' : 'Producto archivado'); onCloseManage();
    } catch (e) { setErr(userMessage((e as Error).message)); }
    finally { setSaving(false); }
  }

  return (
    <View testID="owner-tools"><Card style={{ gap: S.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
        <Icon name="storefront-outline" size={20} color={C.lilac} />
        <Text style={T.headline}>{COPY.store.ownerTitle}</Text>
      </View>
      <Text style={T.footnote}>{COPY.store.ownerHint}</Text>
      <ListRow icon="create-outline" title={COPY.store.edit} right={<Icon name="chevron-forward" size={18} color={C.lilac} />}
        onPress={() => openEdit('all')} />
      {/* Redes (031): fila propia para que cualquier vendedor las encuentre (antes solo dentro de "Editar nombre o usuario"). */}
      <ListRow icon="link-outline" title={SOCIALS_TITLE} testID="owner-socials" onPress={() => openEdit('socials')}
        right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {socialKeysOf(store.socials).map((k) => <Icon key={k} name={SOCIAL_ICON[k]} size={16} color={C.textDim} />)}
          <Icon name="chevron-forward" size={18} color={C.lilac} />
        </View>} />
      <ListRow icon="person-circle-outline" title={COPY.store.account} subtitle={COPY.store.accountHint} right={<Icon name="chevron-forward" size={18} color={C.lilac} />}
        onPress={() => setAccount(true)} />
      <ListRow icon="receipt-outline" title={HISTORY_TITLE} right={<Icon name="chevron-forward" size={18} color={C.lilac} />} onPress={() => router.push('/ventas')} />
      <Suspense fallback={<Skeleton h={56} r={R.md} />}><PayoutEntry /></Suspense>
      <Text style={T.footnote}>{COPY.store.manageHint}</Text>

      <AccountSheet visible={account} onClose={() => setAccount(false)} products={store.items.length} />
      <AdTemplateSheet visible={!!ad} onClose={() => setAd(null)} ad={ad} />

      <Sheet visible={!!managing} onClose={onCloseManage} title={managing?.title ?? 'Producto'}
        footer={<>
          {err ? <ErrorText>{err}</ErrorText> : null}
          {managing?.listing_status === 'pausada'
            ? <PrimaryButton title="Reactivar" icon="play" loading={saving} onPress={() => setStatus('activa')} />
            : <PrimaryButton title="Pausar ventas" icon="pause" variant="secondary" loading={saving} onPress={() => setStatus('pausada')} />}
          <PrimaryButton title="Copiar anuncio" icon="document-text-outline" variant="ghost" disabled={saving}
            onPress={() => { const it = managing!; onCloseManage(); setAd({ title: it.title, price_crc: it.price_crc, link: orderLink(it.slug) }); }} />
          <PrimaryButton title={COPY.sponsored.promote} icon="rocket-outline" variant="ghost" disabled={saving} testID="promote"
            onPress={() => { onCloseManage(); setPromote(true); track('promote_interest', { items: store.items.length }); }} />
          <PrimaryButton title="Archivar" icon="archive-outline" variant="ghost" disabled={saving} onPress={() => setStatus('archivada')} />
          <PrimaryButton title="Ver página" icon="open-outline" variant="ghost" onPress={() => { const s = managing!.slug; onCloseManage(); router.push({ pathname: '/p/[slug]', params: { slug: s } }); }} />
        </>}>
        <Text style={T.callout}>{managing ? formatCRC(managing.price_crc) : ''} · Se vende las veces que quieras: cada comprador tiene su propio pedido y su propio pago en custodia.</Text>
        <Text style={T.footnote}>En pausa no se puede comprar y no aparece en tu tienda. Archivado sale de tu lista; los pedidos en curso siguen igual.</Text>
      </Sheet>

      <Sheet visible={promote} onClose={() => setPromote(false)} title={COPY.sponsored.promote}
        footer={<PrimaryButton title={COPY.sponsored.ok} icon="checkmark" onPress={() => setPromote(false)} />}>
        <View style={{ alignItems: 'center', gap: S.sm }} testID="promote-sheet">
          <Icon name="rocket-outline" size={40} color={C.lilac} />
          <Text style={[T.callout, { textAlign: 'center' }]}>{COPY.sponsored.promoteText}</Text>
        </View>
      </Sheet>
      <Sheet visible={!!editing} onClose={() => setEditing(false)} title={editing === 'socials' ? SOCIALS_TITLE : 'Editar mi tienda'}
        footer={<PrimaryButton title="Guardar" loading={saving} onPress={save} />}>
        {editing !== 'socials' ? <>
        <Text style={T.caption}>Tu nombre</Text>
        <TextInput style={ui.input} value={name} onChangeText={setName} maxLength={40} placeholder="Ej. Rolando" placeholderTextColor={C.textDim} accessibilityLabel="Tu nombre" />
        <Text style={T.caption}>Nombre de usuario</Text>
        <View style={[ui.input, { flexDirection: 'row', alignItems: 'center' }]}>
          <Text style={[T.body, { color: C.textDim }]}>/t/</Text>
          <TextInput style={{ flex: 1, minWidth: 0, fontSize: 16, color: C.text, paddingVertical: S.sm, outlineStyle: 'none' } as object} value={slug}
            onChangeText={(v) => setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))} maxLength={30} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Nombre de usuario" />
        </View>
        <Text style={T.footnote}>De 3 a 30 letras, números o guiones. Si lo cambias, el link anterior deja de funcionar. Tu tienda muestra tu nombre, tu puntuación y tus productos; nunca tu correo ni tu teléfono.</Text>
        </> : null}
        <SocialInputs value={socials} onChange={setSocials} hideTitle={editing === 'socials'} />
        {err ? <ErrorText>{err}</ErrorText> : null}
      </Sheet>
    </Card></View>
  );
}
