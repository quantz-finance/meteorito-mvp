// Tarjeta "Activa las notificaciones para seguir tu venta": el permiso se pide solo al tocar el botón.
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ErrorText, haptic, Icon, IconButton, PrimaryButton, toast } from '@/components/ds';
import { anim } from '@/constants/motion';
import { C, R, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { isSessionError, sellerPushVisible } from '@/lib/authUx';
import { userMessage } from '@/lib/cavosSession';
import { dismissPush, enablePush, isDismissed, pushStatus, type PushRole, type PushStatus } from '@/lib/push';

const COPY: Record<PushRole, { title: string; body: string }> = {
  seller: { title: 'Activa las notificaciones para seguir tu venta', body: 'Te avisamos al instante cuando te paguen, cuando llegue y cuando se libere tu dinero.' },
  buyer: { title: 'Sigue tu compra al instante', body: 'Te avisamos cuando el vendedor envíe y cuando se complete la compra.' },
};

/** onSessionError: el error de sesión lo muestra la pantalla (una sola vez); la tarjeta se oculta en vez de repetirlo. */
export default function PushCard({ role, onSessionError, compact }: { role: PushRole; onSessionError?: (msg: string) => void; /** pantallas bajas: sin el texto largo */ compact?: boolean }) {
  const auth = useAuth();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setStatus(pushStatus(role)); setHidden(isDismissed(role)); }, [role]);
  if (hidden || !status || status === 'enabled' || status === 'unsupported') return null;
  // Vendedor: la suscripción se guarda con su sesión. Sin sesión válida, la tarjeta no se ofrece.
  if (role === 'seller' && !sellerPushVisible({ authed: auth.isAuthenticated, hasToken: !!auth.getAuthToken?.(), sessionError: false })) return null;
  const c = COPY[role];
  const ios = status === 'ios_install';
  const onEnable = () => {
    setBusy(true); setErr(null); haptic.tap();
    enablePush(auth, role) // sin await antes: el permiso se pide dentro del toque (requisito de iOS)
      .then(() => { haptic.success(); toast('Notificaciones activadas'); setStatus('enabled'); })
      .catch((e) => {
        if (isSessionError(e) && onSessionError) { onSessionError(userMessage((e as Error).message)); setHidden(true); return; }
        setErr(userMessage((e as Error).message)); setStatus(pushStatus(role));
      })
      .finally(() => setBusy(false));
  };
  return (
    <View style={s.card} {...anim('enter')}>
      <View style={s.icon}><Icon name="notifications" size={20} color="#fff" /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={T.headline} numberOfLines={2}>{c.title}</Text>
        {compact && !ios && status !== 'denied' ? null : <Text style={T.footnote} numberOfLines={3}>{ios ? 'En iPhone: toca Compartir y luego "Agregar a inicio". Abre Meteorito desde ahí para activarlas.' : status === 'denied' ? 'Las bloqueaste en este navegador. Puedes activarlas en sus ajustes.' : c.body}</Text>}
        {err ? <ErrorText>{err}</ErrorText> : null}
        {!ios && status !== 'denied' ? <View style={{ alignSelf: 'flex-start', marginTop: 6 }}><PrimaryButton title="Activar" icon="notifications-outline" loading={busy} onPress={onEnable} /></View> : null}
      </View>
      <IconButton icon="close" label="Ahora no" onPress={() => { dismissPush(role); setHidden(true); }} />
    </View>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: 'row', gap: S.sm + 4, alignItems: 'flex-start', backgroundColor: C.surface, borderRadius: R.lg, padding: S.sm + 4, borderWidth: 1, borderColor: 'rgba(255,138,61,0.35)' },
  icon: { width: 40, height: 40, borderRadius: 14, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center' },
});
