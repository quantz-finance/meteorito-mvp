// Mi tienda (vendedor con sesión): ver la tienda, copiar o compartir el link y cambiar nombre o usuario. Sin scroll.
import { router } from 'expo-router';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Card, ErrorText, Icon, IconButton, PrimaryButton, Screen, Sheet, Skeleton, st, toast } from '@/components/ds';
import { ShareLink } from '@/components/ShareLink';
import { StoreHeader, StoreItems } from '@/components/StoreView';
import { ui } from '@/components/ui';
import { C, R, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { getMyStore, setListingStatus, storeLink, updateMyStore, type Store, type StoreItem } from '@/lib/store';
import { formatCRC } from '@/lib/orders';
import { userMessage } from '@/lib/cavosSession';
const PayoutEntry = lazy(() => import('@/components/Payout').then((m) => ({ default: m.PayoutEntry }))); // diferido

export default function MiTienda() {
  const auth = useAuth();
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [slug, setSlug] = useState(''); const [name, setName] = useState('');
  const [saveErr, setSaveErr] = useState<string | null>(null); const [saving, setSaving] = useState(false);
  const [item, setItem] = useState<StoreItem | null>(null); // producto abierto para pausar / archivar
  async function setStatus(status: 'activa' | 'pausada' | 'archivada') {
    if (!item) return;
    setSaveErr(null); setSaving(true);
    try { setStore(await setListingStatus(auth, item.slug, status)); toast(status === 'activa' ? 'Producto activo' : status === 'pausada' ? 'Producto en pausa' : 'Producto archivado'); setItem(null); }
    catch (e) { setSaveErr(userMessage((e as Error).message)); }
    finally { setSaving(false); }
  }

  const load = useCallback(() => {
    setError(null);
    getMyStore(auth).then(setStore).catch((e) => setError(userMessage((e as Error).message)));
  }, [auth.address]);
  useEffect(load, [load]);

  async function save() {
    if (!store) return;
    setSaveErr(null); setSaving(true);
    try {
      const patch: { store_slug?: string; display_name?: string } = {};
      if (slug.trim().toLowerCase() !== store.store_slug) patch.store_slug = slug.trim().toLowerCase();
      if (name.trim() !== store.display_name) patch.display_name = name.trim();
      if (Object.keys(patch).length) { setStore(await updateMyStore(auth, patch)); toast('Tienda actualizada'); }
      setEditing(false);
    } catch (e) { setSaveErr(userMessage((e as Error).message)); }
    finally { setSaving(false); }
  }

  return (
    <Screen title="Mi tienda" back="/vender" scroll={false}>
      {error ? (
        <Card style={{ alignItems: 'center', gap: S.sm }}>
          <Icon name="storefront-outline" size={40} color={C.lilac} />
          <Text style={[T.headline, { textAlign: 'center' }]}>{error}</Text>
          <PrimaryButton title="Intentar de nuevo" variant="secondary" onPress={load} />
          <PrimaryButton title="Crear un link" variant="ghost" icon="link" onPress={() => router.replace('/vender')} />
        </Card>
      ) : !store ? (
        <View style={{ gap: S.md }}><Skeleton w="60%" h={28} /><Skeleton h={48} r={R.md} /><Skeleton h={160} r={R.lg} /></View>
      ) : <View style={{ flex: 1, gap: S.md }}>
        <View style={st.rowBetween}>
          <View style={{ flex: 1, minWidth: 0, gap: S.xs }}>
            <StoreHeader store={store} editable onChange={setStore} />
          </View>
          <IconButton icon="create-outline" label="Editar nombre o usuario" onPress={() => { setSlug(store.store_slug); setName(store.display_name); setSaveErr(null); setEditing(true); }} />
        </View>
        <ShareLink kind="store" link={storeLink(store.store_slug)} message="Mira lo que vendo en mi tienda de Meteorito:" />
        <Suspense fallback={<Skeleton h={56} r={R.md} />}><PayoutEntry /></Suspense>
        <Text style={T.caption}>Tus productos ({store.items.length}) · toca uno para pausarlo</Text>
        <StoreItems store={store} minCellW={100} minCellH={140} onItemPress={(it) => { setSaveErr(null); setItem(it); }} empty="Todavía no tienes productos disponibles. Crea un link y aparece aquí." />
      </View>}

      <Sheet visible={!!item} onClose={() => setItem(null)} title={item?.title ?? 'Producto'}
        footer={<>
          {saveErr ? <ErrorText>{saveErr}</ErrorText> : null}
          {item?.listing_status === 'pausada'
            ? <PrimaryButton title="Reactivar" icon="play" loading={saving} onPress={() => setStatus('activa')} />
            : <PrimaryButton title="Pausar ventas" icon="pause" variant="secondary" loading={saving} onPress={() => setStatus('pausada')} />}
          <PrimaryButton title="Archivar" icon="archive-outline" variant="ghost" disabled={saving} onPress={() => setStatus('archivada')} />
          <PrimaryButton title="Ver página" icon="open-outline" variant="ghost" onPress={() => { const s = item!.slug; setItem(null); router.push({ pathname: '/p/[slug]', params: { slug: s } }); }} />
        </>}>
        <Text style={T.callout}>{item ? formatCRC(item.price_crc) : ''} · Se vende las veces que quieras: cada comprador tiene su propio pedido y su propio pago en custodia.</Text>
        <Text style={T.footnote}>En pausa no se puede comprar y no aparece en tu tienda. Archivado sale de tu lista; los pedidos en curso siguen igual.</Text>
      </Sheet>

      <Sheet visible={editing} onClose={() => setEditing(false)} title="Editar mi tienda"
        footer={<PrimaryButton title="Guardar" loading={saving} onPress={save} />}>
        <Text style={T.caption}>Tu nombre</Text>
        <TextInput style={ui.input} value={name} onChangeText={setName} maxLength={40} placeholder="Ej. Rolando" placeholderTextColor={C.textDim} accessibilityLabel="Tu nombre" />
        <Text style={T.caption}>Nombre de usuario</Text>
        <View style={[ui.input, { flexDirection: 'row', alignItems: 'center' }]}>
          <Text style={[T.body, { color: C.textDim }]}>/t/</Text>
          <TextInput style={{ flex: 1, minWidth: 0, fontSize: 16, color: C.text, paddingVertical: S.sm, outlineStyle: 'none' } as object} value={slug}
            onChangeText={(v) => setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))} maxLength={30} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Nombre de usuario" />
        </View>
        <Text style={T.footnote}>De 3 a 30 letras, números o guiones. Si lo cambias, el link anterior deja de funcionar. Tu tienda muestra tu nombre, tu puntuación y tus productos; nunca tu correo, teléfono ni billetera.</Text>
        {saveErr ? <ErrorText>{saveErr}</ErrorText> : null}
      </Sheet>
    </Screen>
  );
}
