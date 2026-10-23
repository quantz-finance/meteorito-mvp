// Foto de la tienda. Solo lectura (tienda pública) o editable por el dueño: tocarla abre la cámara o la galería.
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { haptic, Icon } from '@/components/ds';
import { C } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { AVATAR_ERROR, uploadStoreAvatar, type Store } from '@/lib/store';

export function StoreAvatar({ store, size = 48, editable, onChange, onError }: {
  store: Pick<Store, 'display_name' | 'avatar_url'>; size?: number; editable?: boolean;
  onChange?: (s: Store) => void; onError?: (msg: string | null) => void;
}) {
  if (!editable) return <Face name={store.display_name} url={store.avatar_url ?? null} size={size} />;
  return <EditableAvatar store={store} size={size} onChange={onChange} onError={onError} />;
}

function Face({ name, url, size }: { name: string; url: string | null; size: number }) {
  const round = { width: size, height: size, borderRadius: size / 2 };
  return url
    ? <Image testID="store-avatar-img" source={{ uri: url }} style={[round, { backgroundColor: C.lilacBg }]} accessibilityIgnoresInvertColors />
    : <View style={[s.ph, round]}><Text style={[s.initial, { fontSize: size / 2 }]}>{name.charAt(0).toUpperCase()}</Text></View>;
}

function EditableAvatar({ store, size, onChange, onError }: {
  store: Pick<Store, 'display_name' | 'avatar_url'>; size: number; onChange?: (s: Store) => void; onError?: (msg: string | null) => void;
}) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<string | null>(null); // la nueva foto se ve al instante, sin esperar recarga
  const round = { width: size, height: size, borderRadius: size / 2 };

  const pick = async () => {
    if (busy) return;
    haptic.tap(); onError?.(null);
    try {
      const ImagePicker = await import('expo-image-picker');
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1 });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      setBusy(true);
      const next = await uploadStoreAvatar(auth, { uri: a.uri, width: a.width, height: a.height });
      setLocal(next.avatar_url ?? null);
      onChange?.(next);
    } catch (e) { onError?.((e as Error)?.message || AVATAR_ERROR); }
    finally { setBusy(false); }
  };

  return (
    <Pressable onPress={pick} accessibilityRole="button" accessibilityLabel="Cambiar la foto de tu tienda" accessibilityState={{ busy }}
      hitSlop={6} style={({ pressed }) => [round, pressed && { opacity: 0.85 }]}>
      <Face name={store.display_name} url={local ?? store.avatar_url ?? null} size={size} />
      {busy ? <View style={[StyleSheet.absoluteFill, s.busy, round]}><ActivityIndicator color="#fff" /></View> : null}
      <View style={s.badge} pointerEvents="none"><Icon name="camera" size={12} color={C.purpleDark} /></View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  ph: { backgroundColor: C.lilac, alignItems: 'center', justifyContent: 'center' },
  initial: { fontWeight: '900', color: C.purpleDark },
  busy: { backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', borderWidth: 2, borderColor: C.purple, alignItems: 'center', justifyContent: 'center' },
});
