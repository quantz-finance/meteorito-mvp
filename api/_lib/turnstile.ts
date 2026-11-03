import { HttpError } from './auth';
import { clientIp } from './fbimport';
// Cloudflare Turnstile del lado del servidor (punto 8 de la auditoría): formularios públicos sin cuenta
// (pagar como invitado, importar por link como invitado). Apagado si falta TURNSTILE_SECRET_KEY.
// Flujo: sin token -> 403 code 'turnstile_required' + siteKey; el cliente web resuelve el reto y reintenta con body.turnstile.
// Cloudflare caído o lento: se deja pasar y se registra (igual que el límite de peticiones), nunca tumba un pago.
export const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const TURNSTILE_REQUIRED = 'Confirma que eres una persona para seguir.';
export const TURNSTILE_FAILED = 'No pudimos confirmar que eres una persona. Intenta de nuevo.';
type FetchLike = (url: string, init: any) => Promise<{ ok: boolean; json(): Promise<any> }>;
let testFetch: FetchLike | null = null;
/** Solo tests. */
export const __setTurnstileFetch = (f: FetchLike | null) => { testFetch = f; };

export const turnstileEnabled = () => !!process.env.TURNSTILE_SECRET_KEY && process.env.TURNSTILE_DISABLED !== '1';
const siteKey = () => process.env.TURNSTILE_SITE_KEY || process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY || null;

/** Lanza 403 si Turnstile está activo y el token falta o no vale. `action` se compara con la del widget. */
export async function requireHuman(req: any, token: unknown, action: string): Promise<void> {
  if (!turnstileEnabled()) return;
  const sk = siteKey();
  if (!sk) { console.warn('[turnstile] falta TURNSTILE_SITE_KEY: se deja pasar'); return; }
  if (typeof token !== 'string' || !token || token.length > 2048) {
    throw Object.assign(new HttpError(403, TURNSTILE_REQUIRED), { code: 'turnstile_required', siteKey: sk, action });
  }
  const f = testFetch ?? ((u: string, i: any) => fetch(u, i) as any);
  const form = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: token });
  const ip = clientIp(req); if (ip) form.set('remoteip', ip);
  let out: any;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
    try { const r = await f(VERIFY_URL, { method: 'POST', body: form, signal: ctl.signal }); out = await r.json(); }
    finally { clearTimeout(t); }
  } catch (e: any) { console.warn('[turnstile] fail-open', e?.name ?? 'error'); return; }
  const actionOk = !out?.action || out.action === action;
  if (out?.success === true && actionOk) return;
  console.warn('[turnstile] rechazado', action, Array.isArray(out?.['error-codes']) ? out['error-codes'].join(',') : '');
  throw Object.assign(new HttpError(403, TURNSTILE_FAILED), { code: 'turnstile_failed', siteKey: sk, action });
}
