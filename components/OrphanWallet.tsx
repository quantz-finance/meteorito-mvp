// Cuenta abierta en otro dispositivo (la llave no está aquí todavía).
// Paso 1, "Confirma que eres tú": la passkey abre la misma cuenta. Va en un toque directo porque iPhone lo exige.
// Solo si eso no es posible (la cuenta no tiene passkey) se muestra la salida "Entrar con otro correo".
import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { Card, ErrorText, Icon, PrimaryButton } from '@/components/ds';
import { C, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { DEVICE_NOT_AUTHORIZED, DEVICE_STEP, DEVICE_STEP_HELP, DEVICE_STEP_TITLE, logoutSafely, restoreDevice, walletErrorNotice } from '@/lib/wallet';
import { track } from '@/lib/analytics';
import type { MeteoritoAuth } from '@/lib/types';

export function OrphanWalletCard({ compact, onRestored }: { compact?: boolean; onRestored?: (a: MeteoritoAuth) => void }) {
  const auth = useAuth();
  const [failed, setFailed] = useState(auth.wallet?.state !== 'needs-approval');
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function restore() {
    track('device_restore_tapped', { has_passkey: !!auth.wallet?.hasPasskey });
    setBusy(true); setMsg(null);
    try {
      const a = await restoreDevice(auth);
      track('device_restored', { has_passkey: !!auth.wallet?.hasPasskey });
      onRestored?.(a);
    } catch (e: any) {
      track('device_restore_failed', { code: String(e?.code ?? 'unknown'), has_passkey: !!auth.wallet?.hasPasskey });
      if (e?.code === 'device_restore_cancelled') setMsg(walletErrorNotice(e)); else setFailed(true);
    } finally { setBusy(false); }
  }
  async function switchAccount() {
    track('orphan_wallet_switch');
    setBusy(true); setMsg(null);
    try { const m = await logoutSafely(auth); if (m) setMsg(m); } finally { setBusy(false); }
  }
  const body = failed ? DEVICE_NOT_AUTHORIZED : help ? DEVICE_STEP_HELP : DEVICE_STEP;
  return (
    <Card style={{ gap: S.sm, borderColor: failed ? C.orange : C.lilac, borderWidth: 1 }}>
      <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start' }}>
        <Icon name={failed ? 'alert-circle' : 'finger-print'} size={22} color={failed ? C.orange : C.lilac} />
        <View style={{ flex: 1, gap: 2 }}>
          {!failed ? <Text style={[T.callout, { color: C.text, fontWeight: '700' }]}>{DEVICE_STEP_TITLE}</Text> : null}
          <Text style={[T.footnote, { color: C.text }]} numberOfLines={compact ? 3 : 4}>{body}</Text>
        </View>
      </View>
      {msg ? <ErrorText>{msg}</ErrorText> : null}
      {failed ? (
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <View style={{ flex: 1.4 }}><PrimaryButton title="Entrar con otro correo" icon="log-out-outline" loading={busy} onPress={switchAccount} /></View>
          <View style={{ flex: 1 }}><PrimaryButton title="Ayuda" variant="secondary" icon="mail-outline" onPress={() => Linking.openURL('mailto:team@meteorito.app?subject=No%20puedo%20abrir%20mi%20cuenta')} /></View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center' }}>
          <View style={{ flex: 1.4 }}><PrimaryButton title="Usar mi passkey" icon="finger-print" loading={busy} onPress={restore} /></View>
          <Pressable accessibilityRole="button" onPress={() => setHelp((h) => !h)} hitSlop={8} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={[T.footnote, { color: C.lilac, textDecorationLine: 'underline' }]}>{help ? 'Volver' : '¿Dónde está?'}</Text>
          </Pressable>
        </View>
      )}
    </Card>
  );
}
