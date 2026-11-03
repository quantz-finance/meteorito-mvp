import { createHmac } from 'node:crypto';
import { HttpError } from './auth';
import { db } from './db';
import { clientIp } from './fbimport';
// Límite de peticiones PERSISTENTE (migración 037): un contador por (HMAC de ruta+IP, ventana fija) en Postgres,
// compartido entre todas las instancias de Vercel. Nunca se guarda la IP: solo el HMAC con una sal del servidor.
// Fail-open: si la base falla o tarda, se deja pasar y se registra (un límite caído no debe tumbar pagos).

export interface Limit { max: number; windowSec: number }
/** Límites por ruta sensible (por IP). Generosos para un humano; cortan scripts. */
export const LIMITS = {
  'orders.create':   { max: 20, windowSec: 600 },
  'escrow.pay':      { max: 30, windowSec: 600 },
  'escrow.pin':      { max: 10, windowSec: 600 },  // entrada de PIN (además del tope de 3 por pedido)
  'tx.submit':       { max: 60, windowSec: 600 },
  'wallet.activate': { max: 10, windowSec: 600 },
  'photos.upload':   { max: 60, windowSec: 600 },
  'invites.create':  { max: 30, windowSec: 600 },
  'store.import':    { max: 20, windowSec: 600 },  // importar por link
  'store.access':    { max: 10, windowSec: 600 },  // enlaces de acceso / PIN reenviado / vincular cuenta (tipo OTP)
} satisfies Record<string, Limit>;
export type LimitRoute = keyof typeof LIMITS;

export const RATE_LIMITED = 'Demasiados intentos. Espera un momento e intenta de nuevo.';
const TIMEOUT_MS = 1500;

function salt(): string {
  return process.env.RATE_LIMIT_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || 'meteorito-rl';
}
/** HMAC-SHA256 hex de ruta + IP. Exportado para tests. */
export function rateKey(route: string, ip: string | null): string {
  return createHmac('sha256', salt()).update(`${route}|${ip ?? 'sin-ip'}`).digest('hex');
}

let failOpenLogged = 0;
/** Suma un hit; lanza HttpError 429 (code rate_limited, retryAfter en segundos) si se pasó del límite. */
export async function rateLimit(req: any, route: LimitRoute, limit: Limit = LIMITS[route]): Promise<void> {
  if (process.env.RATE_LIMIT_DISABLED === '1') return;
  const key = rateKey(route, clientIp(req));
  let r: any;
  try {
    const call = Promise.resolve(db().rpc('rate_limit_hit', { p_key: key, p_max: limit.max, p_window_seconds: limit.windowSec }));
    r = await Promise.race([call, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS))]);
  } catch (e: any) {
    if (failOpenLogged++ < 20) console.warn('[ratelimit] fail-open', route, e?.code ?? e?.message ?? 'error');
    return;
  }
  if (r?.error) {
    if (failOpenLogged++ < 20) console.warn('[ratelimit] fail-open', route, r.error.code ?? r.error.message ?? 'error');
    return;
  }
  const row = Array.isArray(r?.data) ? r.data[0] : r?.data;
  if (row && row.allowed === false) {
    throw Object.assign(new HttpError(429, RATE_LIMITED), { code: 'rate_limited', retryAfter: Math.max(1, Number(row.retry_after_s) || limit.windowSec) });
  }
}
