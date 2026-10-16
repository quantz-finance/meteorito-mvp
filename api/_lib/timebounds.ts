// Timebounds cortos + guardia de reconstrucción.
// Regla: nunca dos tx "vivas" a la vez para la misma acción. Una tx solo se reconstruye/reemplaza cuando
// (a) el maxTime de la original ya pasó según el close time del último ledger (no el reloj local) Y
// (b) su hash confirma que no entró. Tx sin maxTime o con ventana larga: no entran al camino de reconstrucción.
import { Horizon, Networks, Transaction, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { env } from './env';

export const txWindowS = () => Number(process.env.TX_MAX_WINDOW_S ?? '60');
/** Ventana máx. aceptada en el camino de reconstrucción. TW arma ~100 s y no se puede cambiar (ver tw.ts): tope 120 s. */
export const rebuildMaxWindowS = () => Number(process.env.TX_REBUILD_MAX_WINDOW_S ?? '120');
const SKEW_S = 5; // tolerancia reloj servidor vs ledger al validar una ventana ya firmada

export class TimeboundsError extends Error { status = 409; code = 'unsafe_timebounds'; }

export function maxTimeOf(tx: Transaction): number {
  const m = Number(tx.timeBounds?.maxTime ?? 0);
  return Number.isFinite(m) ? m : 0;
}

/** Para tx que enviamos NOSOTROS a Horizon (no vía TW). XDR SIN firmar -> fija timebounds {0, now+ventana} si falta maxTime o es más largo. Solo modifica cond (fee y sorobanData intactos). */
export function tightenTimebounds(unsignedXdr: string, nowS = Math.floor(Date.now() / 1000)): Transaction {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET) as Transaction;
  if ('innerTransaction' in tx) throw new TimeboundsError('fee-bump no admitido aquí');
  if (tx.signatures.length) throw new TimeboundsError('XDR ya firmado: no se pueden cambiar sus timebounds');
  const max = nowS + txWindowS();
  const cur = maxTimeOf(tx);
  if (cur > 0 && cur <= max) return tx;
  const env_ = tx.toEnvelope();
  const inner = env_.v1().tx();
  const cond = inner.cond();
  if (cond.switch().name === 'precondV2') throw new TimeboundsError('precondiciones V2 no soportadas');
  inner.cond(xdr.Preconditions.precondTime(new xdr.TimeBounds({ minTime: xdr.Uint64.fromString('0'), maxTime: xdr.Uint64.fromString(String(max)) })));
  return new Transaction(env_, Networks.TESTNET);
}

/** Tx ya firmada (p.ej. inner de un fee-bump firmado por el usuario): ¿tiene ventana corta y acotada? */
export function hasShortWindow(tx: Transaction, nowS = Math.floor(Date.now() / 1000)): boolean {
  const m = maxTimeOf(tx);
  return m > 0 && m <= nowS + txWindowS() + SKEW_S;
}

/** Decisión pura: ¿se puede reconstruir/reemplazar la tx? */
export function rebuildDecision(p: { maxTime: number; ledgerCloseS: number; landed: boolean; nowS?: number }):
  { ok: true } | { ok: false; reason: 'landed' | 'no_timebounds' | 'long_timebounds' | 'not_expired' } {
  if (p.landed) return { ok: false, reason: 'landed' };
  if (!p.maxTime) return { ok: false, reason: 'no_timebounds' };
  const now = p.nowS ?? Math.floor(Date.now() / 1000);
  if (p.maxTime > now + rebuildMaxWindowS() + SKEW_S) return { ok: false, reason: 'long_timebounds' };
  if (p.ledgerCloseS <= p.maxTime) return { ok: false, reason: 'not_expired' };
  return { ok: true };
}

export async function latestLedgerCloseS(): Promise<number> {
  const r: any = await new Horizon.Server(env.horizon()).ledgers().order('desc').limit(1).call();
  return Math.floor(Date.parse(r.records[0].closed_at) / 1000);
}

export interface GuardDeps { ledgerCloseS: () => Promise<number>; landed: () => Promise<boolean>; sleep?: (ms: number) => Promise<void>; nowS?: () => number; pollMs?: number }

/**
 * Espera a que la tx original expire (por close time del ledger) y luego verifica el hash.
 * Devuelve 'landed' (no reconstruir; ya entró) o 'rebuild' (expiró y no entró: seguro reconstruir).
 * Lanza TimeboundsError si la tx no tiene ventana corta (nunca se reconstruye a ciegas).
 */
export async function awaitSafeRebuild(tx: Transaction, d: GuardDeps): Promise<'landed' | 'rebuild'> {
  const sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = d.nowS ?? (() => Math.floor(Date.now() / 1000));
  const maxTime = maxTimeOf(tx);
  const pre = rebuildDecision({ maxTime, ledgerCloseS: 0, landed: false, nowS: now() });
  if (!pre.ok && pre.reason !== 'not_expired') throw new TimeboundsError(`no se reconstruye: ${pre.reason}`);
  const deadline = now() + rebuildMaxWindowS() + 60; // cota dura de espera
  for (;;) {
    if (await d.landed()) return 'landed';
    const close = await d.ledgerCloseS();
    const dec = rebuildDecision({ maxTime, ledgerCloseS: close, landed: false, nowS: Math.min(now(), maxTime) });
    if (dec.ok) return (await d.landed()) ? 'landed' : 'rebuild'; // verificación final post-expiración
    if (now() > deadline) throw new TimeboundsError('ledger no superó maxTime a tiempo; no se reconstruye');
    await sleep(d.pollMs ?? 3000);
  }
}
