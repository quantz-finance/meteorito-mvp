// Sesión Cavos persistente + traducción de TODOS los errores del SDK (nunca se muestra un mensaje crudo de Cavos).
//
// Problema (PWA iOS): @cavos/kit 0.3 guarda el id_token del login SOLO en sessionStorage (`cavos-kit:token:<appId>`).
// iOS lo borra al cerrar la app instalada (y una pestaña nueva tampoco lo tiene); al reabrir, si la llave del dispositivo
// no se carga, HttpWalletRegistry.lookup falla con "registry lookup skipped: no login token".
// Solución: espejamos el token en localStorage y, ANTES de montar el SDK, lo reponemos en sessionStorage.
//
// "Refresh": el kit no tiene refresh token (id_token de Google/Firebase, ~1 h, sin renovación; tampoco en 0.4.x). Con la
// app ABIERTA, nuestro backend acepta un token vencido hace ≤ SESSION_GRACE_DAYS (7) SOLO con una prueba fresca firmada
// por la billetera ligada (lib/api.ts, X-Meteorito-Proof): sigue en silencio. Al REABRIR, en cambio, el SDK necesita un
// token vigente para reconectar (Cavos lo valida): con uno vencido se pide "Entrar de nuevo" (ver rehydrateCavosToken).
// Riesgo acotado: es el mismo token que el SDK ya deja legible para el JS de esta página; nunca sale del origen, se borra al
// superar la ventana de gracia y en logout. Sin firma de la billetera un token vencido no sirve en el servidor.
import { CAVOS_APP_ID } from './config';

export const SDK_TOKEN_KEY = () => `cavos-kit:token:${CAVOS_APP_ID}`;
export const PERSIST_KEY = () => `meteorito:cavos-token:${CAVOS_APP_ID}`;
export const SDK_IDENTITY_KEY = () => `cavos-kit:identity:${CAVOS_APP_ID}`;
const FRESH_MARGIN_S = 60;
/** Igual que el servidor (SESSION_GRACE_DAYS=7), con 1 h de margen para no reponer un token que el servidor ya rechazaría. */
export const GRACE_S = 7 * 86400 - 3600;

/** `exp` del JWT en segundos, o null si no se puede leer. */
export function jwtExp(token: string | null | undefined): number | null {
  if (!token) return null;
  try {
    const p = token.split('.')[1];
    const json = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(p.length / 4) * 4, '=')));
    return typeof json.exp === 'number' ? json.exp : null;
  } catch { return null; }
}

export type TokenState = 'fresh' | 'renewable' | 'expired' | 'invalid';
/** fresh: vigente. renewable: vencido pero dentro de la gracia (el servidor lo renueva con la firma de la billetera).
 *  expired: fuera de la gracia -> "Entrar de nuevo". invalid: no es un JWT con exp. */
export function tokenState(token: string | null | undefined, now = Date.now() / 1000): TokenState {
  const exp = jwtExp(token);
  if (!exp) return 'invalid';
  if (exp > now + FRESH_MARGIN_S) return 'fresh';
  return now - exp < GRACE_S ? 'renewable' : 'expired';
}
const usable = (t: string | null): t is string => { const s = tokenState(t); return s === 'fresh' || s === 'renewable'; };

let expiredOnOpen = false;
/** ¿Al abrir había una sesión guardada que ya no sirve? -> pantalla "Entrar de nuevo". */
export const sessionExpiredOnOpen = () => expiredOnOpen;
let identityOnOpen = false;
/** ¿Había una sesión guardada al abrir? Si el SDK no logra reconectarla, mostramos "Entrar de nuevo" (no la pantalla vacía). */
export const hadSessionOnOpen = () => identityOnOpen;
/** Tras logout explícito o login exitoso ya no aplica el aviso de "sesión terminó". */
export const markSessionSettled = () => { identityOnOpen = false; expiredOnOpen = false; };
export const __resetForTests = () => { expiredOnOpen = false; identityOnOpen = false; };

// Causa raíz de "Tu sesión venció" / "Tu sesión terminó" al reabrir (PostHog cavos_session_restore, oct 2026): un token
// VENCIDO repuesto al SDK nunca reconecta. El SDK (vault + registro de Cavos) valida el token con Cavos y responde
// 401 "Invalid user token" (13 de 13 aperturas con token vencido fallaron; 0 se recuperaron). La gracia de 7 días solo
// vale para NUESTRO API (prueba firmada por la billetera), no para Cavos. Por eso:
//  - al SDK solo se le repone un token vigente (con margen de reloj) y de la MISMA cuenta que la identidad guardada;
//  - con token vencido no se intenta una reconexión condenada (hasta 45 s): se muestra "Entrar de nuevo" de una vez,
//    el borrador y la pantalla se conservan (lib/returnTo.ts) y, al volver a entrar, la billetera reconecta sola.
/** Margen de reloj del teléfono (s): un token vencido hace menos que esto aún se intenta. */
export const CLOCK_SKEW_S = 300;
interface Claims { sub?: string; iat?: number; exp?: number }
function claimsOf(token: string | null | undefined): Claims {
  if (!token) return {};
  try {
    const p = token.split('.')[1];
    const j = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(p.length / 4) * 4, '=')));
    return { sub: j.sub ?? j.user_id ?? j.uid, iat: typeof j.iat === 'number' ? j.iat : undefined, exp: typeof j.exp === 'number' ? j.exp : undefined };
  } catch { return {}; }
}
/** ¿Cavos (vault/registro) todavía acepta este token? Vigente, con margen de reloj. */
export function sdkUsable(token: string | null | undefined, now = Date.now() / 1000): token is string {
  const e = jwtExp(token); return !!e && e > now - CLOCK_SKEW_S;
}
const newer = (a: string, b: string) => { const A = claimsOf(a), B = claimsOf(b); return (A.iat ?? A.exp ?? 0) > (B.iat ?? B.exp ?? 0); };
function identityUser(ls: Storage): string | null {
  try { const v = ls.getItem(SDK_IDENTITY_KEY()); return v ? String(JSON.parse(v).userId ?? '') || null : null; } catch { return null; }
}
const sameUser = (token: string, user: string | null) => { const s = claimsOf(token).sub; return !user || !s || String(s) === user; };

/** Llamar ANTES de montar CavosProvider (reabrir PWA, recargar, pestaña nueva). Nunca lanza.
 *  present/restored: token vigente en el SDK. stale: había sesión pero el token venció (Cavos ya no lo acepta) ->
 *  "Entrar de nuevo" de inmediato. expired: además fuera de la gracia. none: sin sesión. */
export function rehydrateCavosToken(): 'present' | 'restored' | 'stale' | 'expired' | 'none' {
  try {
    const ss = window.sessionStorage, ls = window.localStorage;
    const user = identityUser(ls);
    identityOnOpen = !!user;
    const cur = ss.getItem(SDK_TOKEN_KEY());
    const saved = ls.getItem(PERSIST_KEY());
    // Copia guardada de OTRA cuenta (re-login con otro correo): nunca se repone ni se queda.
    if (saved && !sameUser(saved, user)) ls.removeItem(PERSIST_KEY());
    const ok = [cur, saved].filter((t): t is string => !!t && sdkUsable(t) && sameUser(t, user));
    const best = ok.reduce<string | null>((b, t) => (!b || newer(t, b) ? t : b), null);
    if (best) { if (best !== cur) ss.setItem(SDK_TOKEN_KEY(), best); return best === cur ? 'present' : 'restored'; }
    if (!user) return cur ? 'present' : 'none';
    if (!cur && !saved) return 'none'; // identidad sin token: el SDK decide (p. ej. reconecta con la caché de dirección)
    // Sesión con token vencido: no se repone (Cavos respondería 401). Quitamos la identidad para que el SDK no intente
    // reconectar a medias. La llave del dispositivo (vault / IndexedDB) NO se toca: al entrar con la misma cuenta, es la
    // misma billetera y reconecta sola.
    const stale = [cur, saved].some((t) => tokenState(t) === 'renewable');
    if (cur) ss.removeItem(SDK_TOKEN_KEY());
    ls.removeItem(PERSIST_KEY());
    ls.removeItem(SDK_IDENTITY_KEY()); expiredOnOpen = true;
    return stale ? 'stale' : 'expired';
  } catch { return 'none'; }
}

/** Copia el token del SDK a localStorage tras login/re-login: el de esta pestaña es el vivo. Solo si Cavos aún lo acepta
 *  y no es más viejo (por emisión, `iat`) que uno guardado de la MISMA cuenta. Otra cuenta: se reemplaza. */
export function persistCavosToken() {
  try {
    const t = window.sessionStorage.getItem(SDK_TOKEN_KEY());
    if (!sdkUsable(t)) return;
    const saved = window.localStorage.getItem(PERSIST_KEY());
    if (saved === t) return;
    if (saved && sdkUsable(saved) && claimsOf(saved).sub === claimsOf(t).sub && newer(saved, t)) return;
    window.localStorage.setItem(PERSIST_KEY(), t);
    expiredOnOpen = false;
  } catch { /* storage bloqueado */ }
}

/** Token para el API: el de la pestaña o, si iOS lo borró después de cargar, el guardado. */
export function currentCavosToken(): string | null {
  try {
    const t = window.sessionStorage.getItem(SDK_TOKEN_KEY());
    if (t) return t;
    const saved = window.localStorage.getItem(PERSIST_KEY());
    if (usable(saved)) { window.sessionStorage.setItem(SDK_TOKEN_KEY(), saved); return saved; }
    return null;
  } catch { return null; }
}

/** Logout: borrar la copia persistente y la de la pestaña. */
export function clearCavosToken() {
  try { window.localStorage.removeItem(PERSIST_KEY()); } catch { /* nada */ }
  try { window.sessionStorage.removeItem(SDK_TOKEN_KEY()); } catch { /* nada */ }
}

// ---------- Traducción de errores Cavos ----------
export const RELOGIN_TITLE = 'Tu sesión terminó';
export const RELOGIN_MESSAGE = 'Para continuar, vuelve a entrar con la misma cuenta. Tu billetera sigue en este dispositivo.';
const NETWORK_MESSAGE = 'No pudimos conectar con tu cuenta. Revisa tu conexión y vuelve a intentar.';
const CANCEL_MESSAGE = 'Se canceló el inicio de sesión. Toca "Entrar" cuando quieras.';
const PASSKEY_MESSAGE = 'No se pudo usar la passkey en este dispositivo. Vuelve a intentar o entra de nuevo con tu cuenta.';
const GENERIC_MESSAGE = 'No pudimos abrir tu cuenta en este dispositivo. Toca "Entrar de nuevo" para continuar.';

const RELOGIN_RE = /no login token|registry (lookup|backup)|lookup (skipped|failed)|backup (skipped|failed)|passkey[- ]wraps?.*(40[13])|\b40[13]\b|unauthori[sz]ed|forbidden|sign in again|jwt|id[_ ]token|token (expired|invalid)|expired|protected by recovery|recovery credential|login binding|nonce/i;
const NETWORK_RE = /failed to fetch|network|timed? ?out|timeout|offline|load failed|\b50[0-4]\b|ECONN|fetch failed/i;
const CANCEL_RE = /cancel|closed by user|popup.*closed|user closed|dismiss|abort/i;
const PASSKEY_RE = /passkey|webauthn|NotAllowedError|credential|authenticator/i;

/** Texto técnico del SDK/servicios de Cavos (inglés) o que nombra a Cavos. */
const CAVOS_RE = /cavos|^(registry|passkey|kit\/|vault|enclave)|no login token|registry|passkey|webauthn|NotAllowedError|wallet|signer|recovery|sign[- ]?in|login token/i;
const ENGLISH_RE = /\b(the|is|not|failed|could|this|skipped|please|was|to|of|with|unable|invalid)\b/i;

/** Error de Cavos -> mensaje claro en español. Para el error de auth del SDK: SIEMPRE devuelve un texto propio. */
export function friendlyCavosError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (RELOGIN_RE.test(raw)) return RELOGIN_MESSAGE;
  if (NETWORK_RE.test(raw)) return NETWORK_MESSAGE;
  if (CANCEL_RE.test(raw)) return CANCEL_MESSAGE;
  if (PASSKEY_RE.test(raw)) return PASSKEY_MESSAGE;
  return GENERIC_MESSAGE;
}
/** ¿Pide volver a entrar? (para mostrar la pantalla "Entrar de nuevo"). */
export const needsRelogin = (msg: string | null | undefined) => msg === RELOGIN_MESSAGE || msg === GENERIC_MESSAGE;
export const isMissingTokenError = (e: string | null | undefined) => !!e && RELOGIN_RE.test(e);

/** Para cualquier error mostrado en la app: si es técnico de Cavos, se traduce; si es nuestro (español), se deja. */
export function userMessage(raw: string | null | undefined): string {
  const m = raw ?? '';
  if (!m) return GENERIC_MESSAGE;
  // Nuestros mensajes son en español; uno técnico en inglés o que nombra a Cavos viene del SDK/servicios -> se traduce.
  if (CAVOS_RE.test(m)) return friendlyCavosError(m)!;
  if (ENGLISH_RE.test(m)) return NETWORK_RE.test(m) ? NETWORK_MESSAGE : 'Algo salió mal. Vuelve a intentar en un momento.';
  return m;
}
