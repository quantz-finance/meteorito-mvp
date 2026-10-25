// Interruptor "Datos de ejemplo" (solo el admin maestro; migración 032). Encendido: los productos, tiendas y ventas de
// ejemplo se ven para todos. Apagado (default): solo usuarios, tiendas y publicaciones reales. El servidor decide quién
// es admin (admin_me / requireAdmin) y guarda el ajuste con auditoría; aquí solo se muestra y se cambia.
// Accesible: <Switch> nativo (role="switch" con su estado en web, iOS y Android) con el mismo texto como nombre.
import { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { Card, ErrorText, haptic } from '@/components/ds';
import { C, S, T } from '@/constants/theme';
import { COPY } from '@/lib/copy';
import { useAuth } from '@/lib/cavos';
import { userMessage } from '@/lib/cavosSession';
import { getDemoData, setDemoData, useIsAdmin } from '@/lib/admin';

export function DemoDataToggle() {
  const auth = useAuth();
  const admin = useIsAdmin(auth);
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (admin !== true) return;
    let live = true;
    getDemoData(auth).then((d) => { if (live) setOn(d.enabled); }).catch((e) => { if (live) setErr(userMessage((e as Error).message)); });
    return () => { live = false; };
  }, [admin]); // eslint-disable-line react-hooks/exhaustive-deps
  if (admin !== true) return null; // nadie más lo ve
  async function change(v: boolean) {
    haptic.tap(); setOn(v); setErr(null); setBusy(true);
    try { const d = await setDemoData(auth, v); setOn(d.enabled); }
    catch (e) { setOn(!v); haptic.error(); setErr(userMessage((e as Error).message)); }
    finally { setBusy(false); }
  }
  return (
    <Card testID="demo-data">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, minHeight: 44 }}>
        <Text style={[T.headline, { flex: 1 }]}>{COPY.demoData.label}</Text>
        <Switch value={on === true} onValueChange={change} disabled={busy || on === null} accessibilityLabel={COPY.demoData.label}
          trackColor={{ true: C.purple, false: C.surface2 }} thumbColor={C.white} testID="demo-data-switch" />
      </View>
      {err ? <ErrorText>{err}</ErrorText> : null}
    </Card>
  );
}
