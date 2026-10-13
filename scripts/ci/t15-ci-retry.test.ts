// (15) Reintentos CI: solo errores de red/timeout/5xx; nunca aserciones/errores de negocio; submit no se reenvía si ya entró.
import type { T } from './setup';
import { withRetry, isTransient } from '../../api/_lib/retry';

export async function run(t: T) {
  await runGuard(t);
  const saved = process.env.CI_RETRY_DELAYS_MS; process.env.CI_RETRY_DELAYS_MS = '1,1,1';
  const warn = console.warn; console.warn = () => {};
  try {
    let n = 0;
    const ok = await withRetry('x', async () => { if (++n < 3) throw new Error('fetch failed'); return 'ok'; });
    t.check('red transitoria -> reintenta y pasa', ok === 'ok' && n === 3);
    n = 0;
    const e1 = await withRetry('x', async () => { n++; throw new Error('TW /x 400: The signer has insufficient funds'); }).catch((e) => e);
    t.check('error de negocio (400) -> NO reintenta', n === 1 && /insufficient/.test(e1.message));
    n = 0;
    const e2 = await withRetry('x', async () => { n++; throw new Error('fetch failed'); }).catch((e) => e);
    t.check('máx 3 reintentos (4 intentos) y luego propaga', n === 4 && e2.message === 'fetch failed');
    let sent = 0;
    const r = await withRetry('submit', async () => { sent++; throw new Error('TW /helper/send-transaction 400: Your transaction submission request has timed out'); },
      { landed: async () => ({ status: 'SUCCESS', hash: 'h' }) as any });
    t.check('submit con timeout: verifica si ya entró y NO reenvía', sent === 1 && (r as any).status === 'SUCCESS');
    sent = 0; let checks = 0;
    await withRetry('submit', async () => { if (++sent === 1) throw Object.assign(new Error('Bad Gateway'), { status: 502 }); return 'ok'; }, { landed: async () => { checks++; return null; } });
    t.check('submit 502 que no entró -> verifica y reenvía 1 vez', sent === 2 && checks === 1);
    t.check('isTransient: 429/5xx/timeout sí; 400/401/404/aserción no', isTransient({ status: 429 }) && isTransient({ status: 503 }) && isTransient(new Error('ETIMEDOUT'))
      && !isTransient({ status: 400, message: 'bad' }) && !isTransient({ status: 404 }) && !isTransient(new Error('AssertionError: expected 1')));
    process.env.CI_NETWORK_RETRY = ''; n = 0;
    await withRetry('x', async () => { n++; throw new Error('fetch failed'); }).catch(() => 0);
    t.check('fuera de CI (CI_NETWORK_RETRY vacío) -> sin reintentos', n === 1);
  } finally { process.env.CI_NETWORK_RETRY = '1'; console.warn = warn; if (saved === undefined) delete process.env.CI_RETRY_DELAYS_MS; else process.env.CI_RETRY_DELAYS_MS = saved; }
}

// (15b) CI nunca escribe en escrows que no desplegó (p.ej. el escrow manual zp6ebt).
import { ciGuard } from '../../api/_lib/tw';
export async function runGuard(t: T) {
  const e = (() => { try { ciGuard('CBAMUNTAE36AUYCLJWC6O6NVWNX7RNZNHEX6KTTJQBBI6R65FN7RKXF6'); return null; } catch (x: any) { return x; } })();
  t.check('CI: escritura en escrow ajeno (zp6ebt) bloqueada', process.env.CI_OWN_CONTRACTS_ONLY === '1' && /bloqueada/.test(String(e?.message)));
}
