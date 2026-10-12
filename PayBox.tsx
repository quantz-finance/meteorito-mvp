// Comprador: Pagar seguro -> SINPE simulado -> "Ya pagué" -> fondos en escrow TW testnet. Luego "Recibí".
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, ui } from '@/components/ui';
import { Brand } from '@/constants/Colors';
import { api, proof } from '@/lib/api';
import { useAuth } from '@/lib/cavos';
import { formatCRC, formatUSDC, type PublicOrder } from '@/lib/orders';

const EXPLORER = 'https://stellar.expert/explorer/testnet';

export function PayBox({ order, onChange }: { order: PublicOrder; onChange: () => void }) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sinpe, setSinpe] = useState<{ amountUsdc: number; priceCrc: number; reference: string } | null>(null);
  const [pin, setPin] = useState<string | null>(null);

  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(null); try { await f(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };

  if (!auth.isAuthenticated) return <Button title="Entrar para pagar seguro" onPress={auth.openLogin} />;

  if (order.status === 'creado' || (order.status === 'escrow_creado' && !sinpe)) {
    return <View style={{ gap: 8 }}>
      <Button title={busy ? 'Preparando…' : `Pagar seguro ${formatCRC(order.price_crc)}`} disabled={busy}
        onPress={() => run(async () => {
          const r = await api(auth, '/api/escrow/pay', { slug: order.slug, step: 'start', proof: await proof(auth, 'pay', order.slug) });
          setSinpe({ amountUsdc: r.amountUsdc, priceCrc: r.priceCrc, reference: r.sinpe.reference });
        })} />
      {err && <Text style={ui.error}>{err}</Text>}
    </View>;
  }

  if (sinpe && order.status === 'escrow_creado') {
    return <View style={[ui.card, { gap: 8 }]}>
      <Text style={ui.label}>SINPE Móvil (simulado · testnet)</Text>
      <Text style={[ui.h1, { fontSize: 28 }]}>{formatCRC(sinpe.priceCrc)}</Text>
      <Text style={ui.muted}>Referencia {sinpe.reference} · en escrow: {formatUSDC(sinpe.amountUsdc)} (incluye 0.3% Trustless Work)</Text>
      <Text style={ui.muted}>Es una demo: no se mueve dinero real. Al tocar "Ya pagué", Meteorito aparta los fondos de prueba en el escrow.</Text>
      <Button title={busy ? 'Apartando fondos…' : 'Ya pagué'} disabled={busy}
        onPress={() => run(async () => { const r = await api(auth, '/api/escrow/pay', { slug: order.slug, step: 'confirm_sinpe' }); setPin(r.pin); onChange(); })} />
      {err && <Text style={ui.error}>{err}</Text>}
    </View>;
  }

  return <View style={[ui.card, { gap: 8 }]}>
    {pin && <>
      <Text style={ui.label}>Tu PIN de entrega</Text>
      <Text style={[ui.h1, { fontSize: 36, letterSpacing: 6, color: Brand.lilac }]}>{pin}</Text>
      <Text style={ui.muted}>Guardalo. Dáselo al vendedor solo cuando tengas el producto en la mano y lo hayas revisado.</Text>
    </>}
    {order.contract_id && <Text style={ui.muted}>Escrow: {EXPLORER}/contract/{order.contract_id}</Text>}
    {order.status === 'enviado' && <>
      <Text style={ui.muted}>Si no reportás un problema, el pago se libera solo{order.auto_release_at ? ` el ${new Date(order.auto_release_at).toLocaleString()}` : ' en 24 h'}.</Text>
      <Button title={busy ? 'Liberando…' : 'Recibí y está bien'} disabled={busy}
        onPress={() => run(async () => { await api(auth, '/api/escrow/confirm', { slug: order.slug, reason: 'buyer_confirm' }); onChange(); })} />
    </>}
    {order.status === 'liberado' && order.released_tx && <Text style={ui.muted}>Pago liberado: {EXPLORER}/tx/{order.released_tx}</Text>}
    {err && <Text style={ui.error}>{err}</Text>}
  </View>;
}
