// Vendedor: "Marqué enviado" (evidencia -> hash en Supabase y en TW) y "Ingresar PIN del comprador".
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Button, ui } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/cavos';

export function SellerActions({ slug, status, onChange }: { slug: string; status: string; onChange: () => void }) {
  const auth = useAuth();
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(null); try { await f(); onChange(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };

  if (status === 'fondeado') return <View style={{ gap: 6, marginTop: 8 }}>
    <Text style={ui.muted}>El comprador pagó: los fondos están en el escrow. Coordiná la entrega.</Text>
    <TextInput style={ui.input} placeholder="Cómo lo entregás (encuentro, envío, guía…)" placeholderTextColor="#888" value={note} onChangeText={setNote} />
    <Button title={busy ? 'Guardando…' : 'Marcar como enviado / entregando'} disabled={busy || !note.trim()}
      onPress={() => run(async () => {
        const evidence = { note: note.trim(), at: new Date().toISOString() };
        const r = await api(auth, '/api/escrow/ship', { slug, evidence });
        if (r.unsignedXdr) await api(auth, '/api/tx/submit', { slug, action: 'ship', signedXdr: await auth.signXdr(r.unsignedXdr) });
      })} />
    {err && <Text style={ui.error}>{err}</Text>}
  </View>;

  if (status === 'enviado') return <View style={{ gap: 6, marginTop: 8 }}>
    <Text style={ui.muted}>Al entregar, pedile al comprador su PIN de 6 dígitos.</Text>
    <TextInput style={ui.input} placeholder="PIN" keyboardType="number-pad" maxLength={6} value={pin} onChangeText={setPin} />
    <Button title={busy ? 'Liberando…' : 'Confirmar PIN y cobrar'} disabled={busy || pin.length !== 6}
      onPress={() => run(async () => { await api(auth, '/api/escrow/confirm', { slug, reason: 'pin', pin }); })} />
    {err && <Text style={ui.error}>{err}</Text>}
  </View>;
  return null;
}
