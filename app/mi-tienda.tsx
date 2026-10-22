// Mi tienda (vendedor con sesión): ver la tienda, copiar o compartir el link y cambiar el nombre de usuario.
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Card, ErrorText, Icon, PrimaryButton, Screen, Skeleton, TestnetPill, toast } from '@/components/ds';
import { ShareLink } from '@/components/ShareLink';
import { StoreHeader, StoreItems } from '@/components/StoreView';
import { ui } from '@/components/ui';
import { C, R, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { getMyStore, storeLink, updateMyStore, type Store } from '@/lib/store';
import { userMessage } from '@/lib/cavosSession';

export default function MiTienda() {
  const auth = useAuth();
  const [store, setStore] = useState<Store | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [slug, setSlug] = useState(''); const [name, setName] = useState('');
  const [saveErr, setSaveErr] = useState<string | null>(null); const [saving, setSaving] = useState(false);

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
    <Screen title="Mi tienda" back="/vender" right={<TestnetPill />}>
      {error ? (
        <Card style={{ alignItems: 'center', gap: S.sm }}>
          <Icon name="storefront-outline" size={40} color={C.lilac} />
          <Text style={[T.headline, { textAlign: 'center' }]}>{error}</Text>
          <PrimaryButton title="Intentar de nuevo" variant="secondary" onPress={load} />
          <PrimaryButton title="Crear un link" variant="ghost" icon="link" onPress={() => router.replace('/vender')} />
        </Card>
      ) : !store ? (
        <View style={{ gap: S.md }}><Skeleton w="60%" h={28} /><Skeleton h={48} r={R.md} /><Skeleton h={160} r={R.lg} /></View>
      ) : <>
        <StoreHeader store={store} />
        <View style={{ gap: S.sm }}>
          <Text style={T.caption}>El link de tu tienda</Text>
          <ShareLink kind="store" link={storeLink(store.store_slug)} message={`Mira lo que vendo en mi tienda de Meteorito:`} />
        </View>
        {editing ? (
          <Card style={{ gap: S.sm }}>
            <Text style={T.caption}>Tu nombre</Text>
            <TextInput style={ui.input} value={name} onChangeText={setName} maxLength={40} placeholder="Ej. Rolando" placeholderTextColor={C.textDim} accessibilityLabel="Tu nombre" />
            <Text style={T.caption}>Nombre de usuario</Text>
            <View style={[ui.input, { flexDirection: 'row', alignItems: 'center' }]}>
              <Text style={[T.body, { color: C.textDim }]}>/t/</Text>
              <TextInput style={{ flex: 1, minWidth: 0, fontSize: 16, color: C.text, paddingVertical: S.sm, outlineStyle: 'none' } as object} value={slug}
                onChangeText={(v) => setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))} maxLength={30} autoCapitalize="none" autoCorrect={false} accessibilityLabel="Nombre de usuario" />
            </View>
            <Text style={T.footnote}>De 3 a 30 letras, números o guiones. Si lo cambias, el link anterior deja de funcionar.</Text>
            {saveErr ? <ErrorText>{saveErr}</ErrorText> : null}
            <View style={{ flexDirection: 'row', gap: S.sm }}>
              <View style={{ flex: 1 }}><PrimaryButton title="Cancelar" variant="secondary" onPress={() => { setEditing(false); setSaveErr(null); }} /></View>
              <View style={{ flex: 1 }}><PrimaryButton title="Guardar" loading={saving} onPress={save} /></View>
            </View>
          </Card>
        ) : (
          <PrimaryButton title="Editar nombre o usuario" icon="create-outline" variant="ghost" onPress={() => { setSlug(store.store_slug); setName(store.display_name); setEditing(true); }} />
        )}
        <Text style={T.caption}>Productos disponibles ({store.items.length})</Text>
        <StoreItems store={store} empty="Todavía no tienes productos disponibles. Crea un link y aparece aquí." />
        <Text style={[T.footnote, { textAlign: 'center' }]}>Tu tienda muestra tu nombre, tu puntuación y tus productos. Nunca tu correo, teléfono ni billetera.</Text>
      </>}
    </Screen>
  );
}
