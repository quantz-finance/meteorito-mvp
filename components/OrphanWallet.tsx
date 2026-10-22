// Salida clara cuando el correo tiene una cuenta vieja que no se puede abrir en este dispositivo: entrar con otro correo.
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { Card, ErrorText, Icon, PrimaryButton } from '@/components/ds';
import { C, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { DEVICE_NOT_AUTHORIZED, logoutSafely } from '@/lib/wallet';
import { track } from '@/lib/analytics';

export function OrphanWalletCard({ compact }: { compact?: boolean }) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function switchAccount() {
    track('orphan_wallet_switch');
    setBusy(true); setMsg(null);
    try { const m = await logoutSafely(auth); if (m) setMsg(m); } finally { setBusy(false); }
  }
  return (
    <Card style={{ gap: S.sm, borderColor: C.orange, borderWidth: 1 }} >
      <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-start' }}>
        <Icon name="alert-circle" size={22} color={C.orange} />
        <Text style={[compact ? T.footnote : T.callout, { flex: 1, color: C.text }]} numberOfLines={compact ? 3 : 4}>{DEVICE_NOT_AUTHORIZED}</Text>
      </View>
      {msg ? <ErrorText>{msg}</ErrorText> : null}
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <View style={{ flex: 1.4 }}><PrimaryButton title="Entrar con otro correo" icon="log-out-outline" loading={busy} onPress={switchAccount} /></View>
        <View style={{ flex: 1 }}><PrimaryButton title="Ayuda" variant="secondary" icon="mail-outline" onPress={() => Linking.openURL('mailto:team@meteorito.app?subject=No%20puedo%20abrir%20mi%20cuenta')} /></View>
      </View>
    </Card>
  );
}
