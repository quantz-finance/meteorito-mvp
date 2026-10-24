// Pago con cripto (cliente): tipos de la respuesta del API, formato y matriz del QR. Puro, sin react-native (se prueba en Node).
// El servidor manda los montos, la dirección y el memo (api/_lib/crypto.ts); aquí solo se muestran.
import { toQR } from 'toqr';

export type CryptoAsset = 'USDC' | 'XLM';
export interface CryptoQuoteView {
  asset: CryptoAsset; amount: string; amountUsdc: number; destination: string; memo: string; memoType: 'text'; expiresAt: string;
  network: 'testnet'; issuer?: string; slippage?: number; uri: string; pathTx?: { xdr: string; uri: string };
}
export type CryptoState = 'waiting' | 'underpaid' | 'expired' | 'processing' | 'funded';
export interface CryptoStatusView {
  state: CryptoState; asset: CryptoAsset | null; received: { USDC: number; XLM: number };
  missing?: { asset: CryptoAsset; amount: string }; expiresAt?: string | null; fundedTx?: string; pin?: string | null;
  refunded?: { asset: CryptoAsset; amount: string; hash: string }[];
}
export const CRYPTO_POLL_MS = 4000;

/** "9.8336874" -> "9.8336874"; quita ceros de más a la derecha pero deja al menos 2 decimales ("12.50"). */
export function fmtAmount(a: string | number): string {
  const s = typeof a === 'number' ? a.toFixed(7) : a;
  const [i, d = ''] = s.split('.');
  const t = d.replace(/0+$/, '');
  return `${i}.${t.length >= 2 ? t : (t + '00').slice(0, 2)}`;
}
/** G… largo -> "GCRL…QJOB" para la pantalla (se copia completo). */
export const shortAddress = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
/** mm:ss que faltan hasta `iso` (o null si ya venció). */
export function countdown(iso: string | null | undefined, now = Date.now()): string | null {
  const ms = Date.parse(iso ?? '') - now;
  if (!(ms > 0)) return null;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** QR sin el texto opcional `msg` (menos módulos = más fácil de escanear). Devuelve el lado y los módulos oscuros. */
export function qrMatrix(uri: string): { size: number; dark: Uint8Array } {
  const clean = uri.replace(/&msg=[^&]*/, '');
  const dark = toQR(clean);
  return { size: Math.round(Math.sqrt(dark.length)), dark };
}
/** Path SVG con un cuadrado por módulo oscuro (un solo <Path>, liviano). */
export function qrPath(m: { size: number; dark: Uint8Array }): string {
  let d = '';
  for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.dark[y * m.size + x]) d += `M${x} ${y}h1v1h-1z`;
  return d;
}

/** Texto del estado para la persona (tuteo, sin jerga). */
export function statusLine(s: CryptoStatusView | null, asset: CryptoAsset): { text: string; tone: 'wait' | 'warn' | 'ok' } {
  if (!s || s.state === 'waiting') return { text: 'Esperando tu pago. Lo detectamos solo, no cierres esta pantalla.', tone: 'wait' };
  if (s.state === 'processing') return { text: 'Recibimos tu pago. Lo estamos pasando a custodia…', tone: 'wait' };
  if (s.state === 'funded') return { text: '¡Pago recibido!', tone: 'ok' };
  if (s.state === 'underpaid' && s.missing) return { text: `Recibimos parte del pago. Faltan ${fmtAmount(s.missing.amount)} ${s.missing.asset}: envíalos con el mismo memo.`, tone: 'warn' };
  return { text: `El precio venció. Actualízalo para pagar en ${asset}.`, tone: 'warn' };
}
