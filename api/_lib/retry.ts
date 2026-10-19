// Reintentos con backoff para llamadas de RED a testnet (Horizon / Soroban RPC / Trustless Work).
// SOLO activo en CI (CI_NETWORK_RETRY=1, lo pone scripts/ci/setup.ts). En runtime (Vercel) no cambia nada.
// Nunca envuelve aserciones: solo errores de red/timeout/5xx/429. Antes de reenviar un submit, verifica si ya entró.

export const retryEnabled = () => process.env.CI_NETWORK_RETRY === '1';
const delays = () => (process.env.CI_RETRY_DELAYS_MS ?? '2000,4000,8000').split(',').map(Number).filter((n: number) => n >= 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ¿Error transitorio de red? (no lógica de negocio). */
export function isTransient(e: any): boolean {
  const m = String(e?.message ?? e ?? '');
  const st = Number(e?.status ?? e?.response?.status ?? (/ (\d{3}):/.exec(m)?.[1] ?? 0));
  if (st === 429 || (st >= 500 && st <= 599)) return true;
  return /timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|network|Bad Gateway|Service Unavailable|Gateway Time-?out/i.test(m);
}

/**
 * fn con hasta N reintentos (backoff 2/4/8 s). `landed` (opcional, para submits): si devuelve un valor no-nulo
 * antes de reintentar, la tx ya entró y se devuelve eso en vez de reenviar.
 */
export async function withRetry<T>(label: string, fn: () => Promise<T>, opts: { landed?: () => Promise<T | null> } = {}): Promise<T> {
  if (!retryEnabled()) return fn();
  const ds = delays();
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e: any) {
      if (i >= ds.length || !isTransient(e)) throw e;
      console.warn(`[ci-retry] ${label}: ${String(e?.message ?? e).slice(0, 160)} — reintento ${i + 1}/${ds.length} en ${ds[i]} ms`);
      await sleep(ds[i]);
      if (opts.landed) {
        const done = await opts.landed().catch(() => null);
        if (done != null) { console.warn(`[ci-retry] ${label}: la tx ya había entrado; no se reenvía`); return done; }
      }
    }
  }
}
