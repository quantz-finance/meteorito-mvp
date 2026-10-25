// Pago con cripto: USDC o XLM en Stellar TESTNET (no es dinero real; aviso de beta en la hoja). Se abre desde el botón discreto "Cripto" de "Elige cómo pagar" (la tarjeta sigue siendo
// el camino principal). Muestra monto, dirección, memo, QR (SEP-7) y botones para copiar; detecta el pago solo (consulta al
// servidor cada 4 s, que lo busca en Horizon) y al llegar sigue igual que un pago con tarjeta. Sirve para invitados.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ErrorText, haptic, Icon, PrimaryButton, Sheet, toast } from '@/components/ds';
import { Qr } from '@/components/Qr';
import { pressTransition } from '@/constants/motion';
import { C, R, S, T } from '@/constants/theme';
import { Fonts } from '@/constants/Colors';
import { CRYPTO_POLL_MS, countdown, fmtAmount, shortAddress, statusLine, type CryptoAsset, type CryptoQuoteView, type CryptoStatusView } from '@/lib/cryptoPay';
import { formatCRC } from '@/lib/orders';
import { track } from '@/lib/analytics';
import { BetaNotice } from '@/components/RulesLink';

// Testnet: todo el pago con cripto es de prueba (Stellar testnet, sin dinero real). El servidor solo acepta la red de prueba
// (api/_lib/crypto.ts: passphrase testnet, USDC del emisor de testnet, Horizon testnet).
export const CRYPTO_ONLY = 'Solo USDC o XLM de testnet (no es dinero real).';
export const CRYPTO_ESCROW_NOTE = 'El pago queda en el escrow de testnet, en USDC.';

export function CryptoSheet({ visible, priceCrc, onClose, onBack, call, onFunded }: {
  visible: boolean; priceCrc: number; onClose: () => void; onBack: () => void;
  /** POST /api/escrow/pay con { slug, step, ...extra } (guestApi del PayBox). */
  call: <R>(step: 'crypto_quote' | 'crypto_status', extra?: Record<string, unknown>) => Promise<R>;
  onFunded: (r: { pin?: string | null; fundedTx?: string }) => void;
}) {
  const [asset, setAsset] = useState<CryptoAsset>('USDC');
  const [quote, setQuote] = useState<CryptoQuoteView | null>(null);
  const [status, setStatus] = useState<CryptoStatusView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState(false); const [buyer, setBuyer] = useState('');
  const [, tick] = useState(0);
  const done = useRef(false);

  const load = async (a: CryptoAsset, extra: Record<string, unknown> = {}) => {
    setBusy(true); setErr(null);
    try { const q = await call<CryptoQuoteView>('crypto_quote', { asset: a, ...extra }); setQuote(q); setStatus(null); track('crypto_quote', { asset: a, path_tx: !!q.pathTx }); return q; }
    catch (e) { setErr((e as Error).message); setQuote(null); return null; }
    finally { setBusy(false); }
  };
  useEffect(() => { if (visible) { done.current = false; setPath(false); load(asset); } else { setQuote(null); setStatus(null); setErr(null); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  // Detección automática: el servidor consulta Horizon; al llegar el pago fondea el escrow (USDC) y devuelve el PIN.
  useEffect(() => {
    if (!visible || !quote) return;
    let live = true;
    const id = setInterval(async () => {
      tick((n) => n + 1);
      try {
        const s = await call<CryptoStatusView>('crypto_status');
        if (!live) return;
        setStatus(s);
        if (s.state === 'funded' && !done.current) { done.current = true; track('crypto_funded', { asset: s.asset }); haptic.success(); onFunded(s); }
      } catch { /* red: se reintenta en el próximo ciclo */ }
    }, CRYPTO_POLL_MS);
    return () => { live = false; clearInterval(id); };
  }, [visible, quote]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (a: CryptoAsset) => { if (a === asset && quote) return; haptic.tap(); setAsset(a); setPath(false); load(a); };
  const copy = async (v: string, what: string) => { try { await Clipboard.setStringAsync(v); haptic.success(); toast(`${what} copiado`); } catch { /* sin portapapeles */ } };
  const open = async (uri: string) => { track('crypto_open_wallet', { asset }); try { await Linking.openURL(uri); } catch { setErr('No encontramos una wallet que abra este link. Copia la dirección, el monto y el memo.'); } };
  const left = countdown(quote?.expiresAt);
  const line = statusLine(status ?? (quote && !left && asset === 'XLM' ? { state: 'expired', asset, received: { USDC: 0, XLM: 0 } } : null), asset);
  const expired = status?.state === 'expired' || (asset === 'XLM' && !!quote && !left);
  const validG = /^G[A-Z2-7]{55}$/.test(buyer.trim());

  return (
    <Sheet visible={visible} onClose={onClose} title="Pagar con cripto"
      footer={<>
        {err ? <ErrorText>{err}</ErrorText> : null}
        {expired
          ? <PrimaryButton title="Actualizar precio" icon="refresh" loading={busy} onPress={() => load(asset)} />
          : path
            ? <PrimaryButton title="Firmar en tu wallet" icon="open-outline" loading={busy} disabled={!validG}
                onPress={async () => { const q = await load('XLM', { buyer: buyer.trim() }); if (q?.pathTx) open(q.pathTx.uri); }} />
            : <PrimaryButton title="Abrir en tu wallet" icon="open-outline" disabled={!quote} loading={busy && !quote} onPress={() => quote && open(quote.uri)} testID="crypto-open" />}
        <PrimaryButton title="Volver" icon="arrow-back" variant="ghost" onPress={onBack} />
      </>}>
      <Text style={T.callout}>{CRYPTO_ONLY}</Text>
      <View style={s.seg} accessibilityRole="tablist">
        {(['USDC', 'XLM'] as const).map((a) => (
          <Pressable key={a} accessibilityRole="tab" accessibilityState={{ selected: asset === a }} accessibilityLabel={`${a} de Stellar testnet`} testID={`crypto-${a}`}
            onPress={() => pick(a)} style={({ pressed }) => [s.segBtn, asset === a && s.segOn, pressTransition, pressed && { opacity: 0.85 }]}>
            <Text style={[s.segText, asset === a && { color: C.purple }]}>{a}</Text>
            <Text style={[T.footnote, asset === a && { color: C.purple }]}>testnet</Text>
          </Pressable>
        ))}
      </View>
      {quote ? <>
        <View style={s.top}>
          {path
            ? <View style={{ flex: 1, gap: S.xs }}>
                <Text style={T.caption}>Tu dirección de Stellar</Text>
                <TextInput style={s.input} value={buyer} onChangeText={(v) => setBuyer(v.replace(/\s/g, '').toUpperCase().slice(0, 56))} placeholder="G…" placeholderTextColor={C.textDim}
                  autoCapitalize="characters" autoCorrect={false} accessibilityLabel="Tu dirección de Stellar" testID="crypto-buyer" />
                <Text style={T.footnote}>Tu wallet hace un path payment: envía XLM y aquí llegan {fmtAmount(quote.amountUsdc)} USDC exactos.</Text>
              </View>
            : <Qr value={quote.uri} size={104} label={`Código QR para pagar ${fmtAmount(quote.amount)} ${quote.asset}`} />}
          {!path ? <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
            <Text style={T.caption}>Monto exacto</Text>
            <CopyRow label={`${fmtAmount(quote.amount)} ${quote.asset}`} big onCopy={() => copy(quote.amount, 'Monto')} testID="crypto-amount" />
            <Text style={T.footnote}>{formatCRC(priceCrc)}{asset === 'XLM' ? ` · ${fmtAmount(quote.amountUsdc)} USDC` : ''}</Text>
            {asset === 'XLM' ? <Text style={[T.footnote, !left && { color: C.orange }]}>{left ? `Precio válido ${left}` : 'Precio vencido'}</Text> : null}
          </View> : null}
        </View>
        <View style={s.box}>
          <Field k="Dirección" v={shortAddress(quote.destination)} onCopy={() => copy(quote.destination, 'Dirección')} testID="crypto-address" />
          <View style={s.sep} />
          <Field k="Memo (obligatorio)" v={quote.memo} onCopy={() => copy(quote.memo, 'Memo')} testID="crypto-memo" />
        </View>
        <View style={{ gap: 6 }}>
        <View style={s.status} accessibilityLiveRegion="polite" testID="crypto-status">
          {line.tone === 'wait' ? <ActivityIndicator size="small" color={C.lilac} /> : <Icon name={line.tone === 'ok' ? 'checkmark-circle' : 'alert-circle-outline'} size={18} color={line.tone === 'ok' ? C.success : C.orange} />}
          <Text style={[T.footnote, { flex: 1, color: line.tone === 'warn' ? C.orange : C.text }]}>{line.text}</Text>
        </View>
        {asset === 'XLM' && !expired
          ? <Pressable onPress={() => { haptic.tap(); setPath((x) => !x); }} accessibilityRole="button" hitSlop={6} testID="crypto-path-toggle">
              <Text style={[T.footnote, { color: C.lilac, textAlign: 'center' }]}>{path ? 'Ver QR y memo' : '¿Tu wallet firma transacciones? Usa path payment'}</Text>
            </Pressable>
          : <Text style={[T.footnote, { textAlign: 'center' }]} testID="crypto-escrow-note">{CRYPTO_ESCROW_NOTE}</Text>}
        <BetaNotice from="crypto" onNavigate={onClose} />
        </View>
      </> : busy ? <View style={{ height: 180, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.lilac} /></View> : null}
    </Sheet>
  );
}

function CopyRow({ label, big, onCopy, testID }: { label: string; big?: boolean; onCopy: () => void; testID: string }) {
  return (
    <Pressable onPress={onCopy} accessibilityRole="button" accessibilityLabel={`Copiar ${label}`} hitSlop={6} testID={testID}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6 }, pressTransition, pressed && { opacity: 0.7 }]}>
      <Text style={[big ? T.moneySm : T.headline, { flexShrink: 1, fontSize: big ? 18 : 16 }]} numberOfLines={1} adjustsFontSizeToFit selectable>{label}</Text>
      <Icon name="copy-outline" size={18} color={C.lilac} />
    </Pressable>
  );
}
function Field({ k, v, onCopy, testID }: { k: string; v: string; onCopy: () => void; testID: string }) {
  return (
    <Pressable onPress={onCopy} accessibilityRole="button" accessibilityLabel={`Copiar ${k}`} testID={testID}
      style={({ pressed }) => [s.field, pressTransition, pressed && { opacity: 0.7 }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={T.footnote}>{k}</Text>
        <Text style={[T.headline, { fontVariant: ['tabular-nums'] }]} numberOfLines={1} selectable>{v}</Text>
      </View>
      <View style={s.copyBtn}><Icon name="copy-outline" size={16} color={C.lilac} /><Text style={[T.footnote, { color: C.lilac }]}>Copiar</Text></View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  seg: { flexDirection: 'row', gap: S.sm },
  segBtn: { flex: 1, minHeight: 44, borderRadius: R.md, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, backgroundColor: C.surface2 },
  segOn: { backgroundColor: C.white, borderColor: C.white },
  segText: { fontFamily: Fonts.black, fontSize: 16, color: C.text },
  top: { flexDirection: 'row', gap: S.md, alignItems: 'center' },
  box: { backgroundColor: C.surface2, borderRadius: R.md, paddingHorizontal: S.md },
  field: { flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: 44, paddingVertical: 2 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: C.line },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingLeft: S.sm },
  status: { flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: 24 },
  input: { minHeight: 48, borderRadius: R.md, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg, color: C.text, fontSize: 16, paddingHorizontal: S.md, fontFamily: Fonts.regular, outlineStyle: 'none' } as object,
});
