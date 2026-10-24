// Invitación a mostrar la última conexión (Ley 8968: consentimiento, apagada por defecto). Aparece una sola vez, en una
// hoja chica después de "¡Tu link está listo!" (la pantalla de Vender no tiene lugar sin scroll en iPhone SE), y solo
// si el vendedor nunca eligió. El interruptor empieza APAGADO; encenderlo o apagarlo queda registrado. Sin presión:
// "Listo" cierra sin cambiar nada. Después sigue en Mi cuenta.
import { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { ErrorText, haptic, PrimaryButton, Sheet } from '@/components/ds';
import { C, S, T } from '@/constants/theme';
import { useAuth } from '@/lib/cavos';
import { userMessage } from '@/lib/cavosSession';
import { COPY } from '@/lib/copy';
import { getMyStore, updateMyStore } from '@/lib/store';

const KEY = (who: string) => `meteorito:last-seen-invite:${who}`;
const asked = (who: string) => { try { return !!globalThis.localStorage?.getItem(KEY(who)); } catch { return true; } };
const markAsked = (who: string) => { try { globalThis.localStorage?.setItem(KEY(who), '1'); } catch { /* sin almacenamiento */ } };

/** trigger: slug del link recién creado (cada link nuevo vuelve a evaluar; solo se muestra una vez). */
export function LastSeenInvite({ trigger }: { trigger: string | null }) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const who = auth.address;
    if (!trigger || !who || asked(who)) return;
    let live = true;
    const t = setTimeout(() => {
      getMyStore(auth).then((st) => {
        if (!live || st.show_last_seen === true || st.last_seen_decided === true) return; // ya eligió: no se vuelve a preguntar
        markAsked(who); setOn(false); setErr(null); setOpen(true);
      }).catch(() => { /* sin tienda o sin red: no se pregunta */ });
    }, 1200); // primero se ve "¡Tu link está listo!"
    return () => { live = false; clearTimeout(t); };
  }, [trigger, auth.address]);

  async function change(v: boolean) {
    haptic.tap(); setOn(v); setErr(null); setBusy(true);
    try { const st = await updateMyStore(auth, { show_last_seen: v }); setOn(st.show_last_seen === true); }
    catch (e) { setOn(!v); setErr(userMessage((e as Error).message)); }
    finally { setBusy(false); }
  }
  return (
    <Sheet visible={open} onClose={() => setOpen(false)} title={COPY.activity.inviteTitle}
      footer={<PrimaryButton title={COPY.activity.inviteDone} icon="checkmark" variant="secondary" onPress={() => setOpen(false)} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }} testID="last-seen-invite">
        <Text style={[T.callout, { flex: 1, color: C.text }]}>{COPY.activity.invite}</Text>
        <Switch value={on} onValueChange={change} disabled={busy} accessibilityLabel={COPY.activity.invite}
          trackColor={{ true: C.success, false: C.surface2 }} thumbColor={C.white} {...({ activeThumbColor: C.white } as object)} testID="last-seen-invite-switch" />
      </View>
      {err ? <ErrorText>{err}</ErrorText> : null}
    </Sheet>
  );
}
