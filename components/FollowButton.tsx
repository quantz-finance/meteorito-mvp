// Botón "Seguir" / "Siguiendo" de un vendedor (perfil público y tarjetas del feed). Textos en lib/copy.ts (COPY.follow).
// Seguir es privado: el vendedor y los demás solo ven cuántos lo siguen. Sin cuenta, se sigue desde este dispositivo.
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { haptic, Icon, toast } from '@/components/ds';
import { Fonts } from '@/constants/Colors';
import { pressTransition } from '@/constants/motion';
import { C, R, TOUCH } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/cavos';
import { COPY } from '@/lib/copy';
import { setFollowing, useFollowing } from '@/lib/follows';

export function FollowButton({ store, source, size = 'md', onFollowers }: {
  store: { store_slug: string; display_name: string; verified?: boolean }; source: 'profile' | 'feed';
  /** sm: pastilla compacta (tarjeta del feed); md: botón del perfil. */ size?: 'sm' | 'md';
  onFollowers?: (n: number | null, following: boolean) => void;
}) {
  const auth = useAuth();
  const on = useFollowing(auth, store.store_slug);
  const [busy, setBusy] = useState(false);
  const sm = size === 'sm';
  const press = async () => {
    if (busy) return;
    const next = !on; haptic.tap(); setBusy(true);
    try {
      const n = await setFollowing(auth, store.store_slug, next);
      track(next ? 'seller_followed' : 'seller_unfollowed', { source, verified: !!store.verified });
      if (next && !sm) toast(COPY.follow.done(store.display_name));
      onFollowers?.(n, next);
    } catch (e: any) { toast(e?.message ?? '', 'info'); } finally { setBusy(false); }
  };
  const fg = on ? C.lilac : C.purpleDark;
  return (
    <Pressable onPress={press} accessibilityRole="button" accessibilityState={{ selected: on, busy }} aria-pressed={on}
      accessibilityLabel={on ? COPY.follow.a11yUnfollow(store.display_name) : COPY.follow.a11yFollow(store.display_name)}
      hitSlop={sm ? 8 : 0} testID={`follow-${source}`}
      style={({ pressed }) => [sm ? s.sm : s.md, on ? s.on : s.off, sm && on && s.onSm, pressTransition, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}>
      {busy ? <ActivityIndicator size="small" color={fg} /> : <Icon name={on ? 'checkmark' : 'add'} size={sm ? 14 : 18} color={fg} />}
      <Text style={[sm ? s.smText : s.mdText, { color: fg }]} numberOfLines={1}>{on ? COPY.follow.following : COPY.follow.follow}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  md: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: TOUCH, paddingHorizontal: 18, borderRadius: R.pill },
  sm: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 28, paddingHorizontal: 9, borderRadius: R.pill, flexShrink: 0 },
  off: { backgroundColor: C.lilac, borderWidth: 1, borderColor: C.lilac },
  on: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(201,182,255,0.5)' },
  // Sobre la foto de la tarjeta: fondo oscuro para que se lea.
  onSm: { backgroundColor: 'rgba(20,10,40,0.78)' },
  mdText: { fontFamily: Fonts.bold, fontSize: 16 },
  smText: { fontFamily: Fonts.bold, fontSize: 12 },
});
