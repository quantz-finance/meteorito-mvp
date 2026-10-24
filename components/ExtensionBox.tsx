// Extensión de mutuo acuerdo del plazo de liberación (+1, +3 o +7 días). La pide comprador o vendedor; la otra parte
// acepta o rechaza. Tope 30 días desde el pago (lo valida el servidor). Mismo endpoint: /api/escrow/confirm.
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ErrorText, haptic, Icon, PrimaryButton } from '@/components/ds';
import { C, R, S, T } from '@/constants/theme';
import { daysLabel, EXTENSION_DAYS, extensionRequestText, pendingExtension } from '../api/_lib/agreement';
import { userMessage } from '@/lib/cavosSession';

type Role = 'buyer' | 'seller';
export function extensionRunning(o: { status?: string; delivery_mode?: string | null } | null | undefined) {
  return !!o && (o.status === 'enviado' || (o.status === 'fondeado' && o.delivery_mode === 'cara_a_cara'));
}

export function ExtensionBox({ order, role, call, onChange }: {
  order: { status: string; delivery_mode?: string | null; release_ext?: any } | null;
  role: Role; call: (body: Record<string, unknown>) => Promise<any>; onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [local, setLocal] = useState<any>(undefined); // respuesta optimista hasta que llegue el pedido actualizado
  const serverExt = JSON.stringify(order?.release_ext ?? null);
  useEffect(() => { setLocal(undefined); }, [serverExt]); // llegó el pedido actualizado: manda el servidor
  if (!extensionRunning(order)) return null;
  const pending = pendingExtension({ release_ext: local === undefined ? order!.release_ext : local });
  const run = async (key: string, body: Record<string, unknown>, next: any) => {
    setBusy(key); setErr(null);
    try { await call(body); haptic.success(); setLocal(next); setOpen(false); onChange(); }
    catch (e) { haptic.error(); setErr(userMessage((e as Error).message)); }
    finally { setBusy(null); }
  };

  if (pending && pending.by !== role) return <View testID="ext-request" style={box}>
    <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center' }}>
      <Icon name="time-outline" size={20} color={C.lilac} />
      <Text style={[T.headline, { flex: 1, fontSize: 15 }]}>{extensionRequestText(pending.by, pending.days)}</Text>
    </View>
    <View style={{ flexDirection: 'row', gap: S.sm }}>
      <View style={{ flex: 1 }}><PrimaryButton title="Rechazar" variant="secondary" disabled={!!busy} loading={busy === 'no'}
        onPress={() => run('no', { reason: 'extend_answer', accept: false }, null)} /></View>
      <View style={{ flex: 1 }}><PrimaryButton title="Aceptar" icon="checkmark" disabled={!!busy} loading={busy === 'yes'}
        onPress={() => run('yes', { reason: 'extend_answer', accept: true }, null)} /></View>
    </View>
    {err ? <ErrorText>{err}</ErrorText> : null}
  </View>;

  if (pending) return <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center', justifyContent: 'center', minHeight: 44 }}>
    <Icon name="time-outline" size={18} color={C.textDim} />
    <Text testID="ext-waiting" style={[T.footnote, { flexShrink: 1 }]}>Pediste {daysLabel(pending.days)} más. Esperando respuesta.</Text>
  </View>;

  if (!open) return <Pressable onPress={() => { haptic.tap(); setErr(null); setOpen(true); }} accessibilityRole="button" accessibilityLabel="Pedir más tiempo"
    style={({ pressed }) => [{ flexDirection: 'row', gap: S.xs + 2, alignItems: 'center', justifyContent: 'center', minHeight: 44 }, pressed && { opacity: 0.7 }]}>
    <Icon name="time-outline" size={18} color={C.lilac} />
    <Text style={[T.callout, { color: C.lilac }]}>Pedir más tiempo</Text>
  </Pressable>;

  return <View style={box}>
    <Text style={T.caption}>¿Cuántos días más? La otra parte acepta o rechaza.</Text>
    <View style={{ flexDirection: 'row', gap: S.sm }}>
      {EXTENSION_DAYS.map((d) => <Pressable key={d} disabled={!!busy} accessibilityRole="button" accessibilityLabel={`Pedir ${daysLabel(d)} más`}
        onPress={() => run(`d${d}`, { reason: 'extend', days: d }, { by: role, days: d, at: new Date().toISOString() })}
        style={({ pressed }) => [chip, pressed && { opacity: 0.8 }]}>
        <Text style={[T.headline, { color: C.lilac, fontSize: 15 }]}>{busy === `d${d}` ? '…' : `+${daysLabel(d)}`}</Text>
      </Pressable>)}
    </View>
    <Pressable onPress={() => setOpen(false)} accessibilityRole="button" style={{ alignSelf: 'center', minHeight: 32, justifyContent: 'center' }}>
      <Text style={T.footnote}>Cancelar</Text>
    </Pressable>
    {err ? <ErrorText>{err}</ErrorText> : null}
  </View>;
}

const box = { gap: S.sm, padding: S.sm + 4, borderRadius: R.md, borderWidth: 1, borderColor: C.lilac, backgroundColor: C.lilacBg } as const;
const chip = { flex: 1, minHeight: 44, borderRadius: R.md, borderWidth: 1, borderColor: C.lilac, alignItems: 'center', justifyContent: 'center' } as const;
