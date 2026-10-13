// (16) Timebounds cortos + guardia de reconstrucción: nunca dos tx vivas a la vez.
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import type { T } from './setup';
import { awaitSafeRebuild, hasShortWindow, maxTimeOf, rebuildDecision, tightenTimebounds, TimeboundsError } from '../../api/_lib/timebounds';

const kp = Keypair.random();
const mk = (timeout: number | null, maxTime?: number) => {
  const b = new TransactionBuilder(new Account(kp.publicKey(), '1'), { fee: '12345', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' }));
  if (maxTime !== undefined) b.setTimebounds(0, maxTime); else if (timeout === null) b.setTimeout(0); else b.setTimeout(timeout);
  return b.build();
};

export async function run(t: T) {
  const now = Math.floor(Date.now() / 1000);
  // Ajuste antes de firmar
  const long = mk(null, now + 100); // como TW (~100 s)
  const tt = tightenTimebounds(long.toXDR(), now);
  t.check('XDR TW con ventana larga (+100 s) -> acortado a ≤60 s antes de firmar', maxTimeOf(tt) === now + 60 && tt.fee === long.fee && tt.operations.length === 1);
  const none = mk(null);
  t.check('XDR sin maxTime -> se fija maxTime=now+60', maxTimeOf(none) === 0 && maxTimeOf(tightenTimebounds(none.toXDR(), now)) === now + 60);
  const short = mk(30); t.check('ventana ya corta -> sin cambios (mismo hash)', tightenTimebounds(short.toXDR()).hash().equals(short.hash()));
  const signed = mk(null, now + 100); signed.sign(kp);
  t.check('XDR ya firmado -> no se tocan sus timebounds (error)', (() => { try { tightenTimebounds(signed.toXDR(), now); return false; } catch (e) { return e instanceof TimeboundsError; } })());

  // Decisión pura
  t.check('reconstrucción BLOQUEADA antes de expirar (close ≤ maxTime)', JSON.stringify(rebuildDecision({ maxTime: now + 60, ledgerCloseS: now + 60, landed: false, nowS: now })) === '{"ok":false,"reason":"not_expired"}');
  t.check('reconstrucción PERMITIDA tras expirar y sin entrar', rebuildDecision({ maxTime: now + 60, ledgerCloseS: now + 61, landed: false, nowS: now }).ok === true);
  t.check('expirada pero entró -> no se reconstruye', (rebuildDecision({ maxTime: now, ledgerCloseS: now + 10, landed: true, nowS: now }) as any).reason === 'landed');
  t.check('sin maxTime -> rechazada del camino de reconstrucción', (rebuildDecision({ maxTime: 0, ledgerCloseS: now + 999, landed: false, nowS: now }) as any).reason === 'no_timebounds');
  t.check('ventana TW real (~100 s) -> aceptada pero solo tras expirar', (rebuildDecision({ maxTime: now + 100, ledgerCloseS: now + 50, landed: false, nowS: now }) as any).reason === 'not_expired' && rebuildDecision({ maxTime: now + 100, ledgerCloseS: now + 101, landed: false, nowS: now }).ok);
  t.check('ventana larga -> rechazada del camino de reconstrucción', (rebuildDecision({ maxTime: now + 3600, ledgerCloseS: now + 9999, landed: false, nowS: now }) as any).reason === 'long_timebounds');

  // Guardia con ledger simulado: espera hasta que el close time supere maxTime
  const tx = mk(null, now + 60); let close = now, polls = 0, landedChecks = 0;
  const v = await awaitSafeRebuild(tx, { nowS: () => now, ledgerCloseS: async () => close, landed: async () => { landedChecks++; return false; }, sleep: async () => { polls++; close += 20; }, pollMs: 0 });
  t.check('guardia: espera mientras ledger ≤ maxTime y solo luego permite reconstruir', v === 'rebuild' && polls === 4 && close > now + 60 && landedChecks >= 5);
  let lc = 0; close = now;
  const v2 = await awaitSafeRebuild(tx, { nowS: () => now, ledgerCloseS: async () => close, landed: async () => ++lc >= 3, sleep: async () => { close += 20; }, pollMs: 0 });
  t.check('guardia: si la original entra durante la espera -> landed, sin reconstruir', v2 === 'landed');
  const e1 = await awaitSafeRebuild(mk(null), { ledgerCloseS: async () => now + 999, landed: async () => false }).catch((e) => e);
  const e2 = await awaitSafeRebuild(mk(3600), { ledgerCloseS: async () => now + 9999, landed: async () => false }).catch((e) => e);
  t.check('guardia: tx sin maxTime o ventana larga -> error, nunca reconstruye', e1 instanceof TimeboundsError && e2 instanceof TimeboundsError);

  // Inner de fee-bump (firmado por el usuario)
  t.check('fee-bump inner: ventana corta sí / larga o sin maxTime no admite reintentos', hasShortWindow(mk(60)) && !hasShortWindow(mk(3600)) && !hasShortWindow(mk(null)));
}
