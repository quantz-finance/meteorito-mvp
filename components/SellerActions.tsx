// Vendedor: "Marqué enviado" (evidencia -> hash en Supabase y en TW) y "Ingresar PIN del comprador".
// La lógica (llamadas a la API y firma) es la misma; solo cambió la presentación.
import { useState } from 'react';
import { userMessage } from '@/lib/cavosSession';
import { Text, TextInput, View } from 'react-native';
import { ErrorText, PrimaryButton, SuccessCheck } from '@/components/ds';
import { ui } from '@/components/ui';
import { C, S, T } from '@/constants/theme';
import { Fonts } from '@/constants/Colors';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/cavos';

export function SellerActions({ slug, status, onChange }: { slug: string; status: string; onChange: () => void }) {
  const auth = useAuth();
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (f: () => Promise<void>, ok: string) => { setBusy(true); setErr(null); try { await f(); setDone(ok); onChange(); } catch (e) { setErr(userMessage((e as Error).message)); } finally { setBusy(false); } };

  if (done) return <View style={{ gap: S.md, alignItems: 'center', paddingVertical: S.md }}>
    <SuccessCheck celebrate={done.startsWith('¡Cobrado')} />
    <Text style={[T.headline, { textAlign: 'center' }]}>{done}</Text>
  </View>;

  if (status === 'fondeado') return <View style={{ gap: S.sm }}>
    <Text style={T.caption}>¿Cómo lo entregas?</Text>
    <TextInput style={ui.input} placeholder="Encuentro, envío, número de guía…" placeholderTextColor={C.textDim} value={note} onChangeText={setNote} />
    <PrimaryButton title="Marcar como enviado" icon="paper-plane" loading={busy} disabled={!note.trim()}
      onPress={() => run(async () => {
        const evidence = { note: note.trim(), at: new Date().toISOString() };
        const r = await api(auth, '/api/escrow/ship', { slug, evidence });
        if (r.unsignedXdr) await api(auth, '/api/tx/submit', { slug, action: 'ship', signedXdr: await auth.signXdr(r.unsignedXdr) });
      }, 'Marcado como enviado')} />
    {err && <ErrorText>{err}</ErrorText>}
  </View>;

  if (status === 'enviado') return <View style={{ gap: S.sm }}>
    <Text style={T.caption}>PIN del comprador</Text>
    <TextInput style={[ui.input, { fontFamily: Fonts.black, fontSize: 28, letterSpacing: 8, textAlign: 'center', fontVariant: ['tabular-nums'] }]}
      placeholder="••••••" keyboardType="number-pad" maxLength={6} value={pin} onChangeText={setPin} placeholderTextColor={C.textDim} />
    <PrimaryButton title="Confirmar PIN y cobrar" icon="lock-open" loading={busy} disabled={pin.length !== 6}
      onPress={() => run(async () => { await api(auth, '/api/escrow/confirm', { slug, reason: 'pin', pin }); }, '¡Cobrado! El pago fue liberado')} />
    {err && <ErrorText>{err}</ErrorText>}
  </View>;
  return null;
}
