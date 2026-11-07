// Login sin cuelgues: cada paso de Cavos tiene un tope de tiempo. Si se pasa o falla, la persona se queda en la pantalla
// de entrar con un mensaje claro, "Reintentar" y la opción de entrar con un código por correo. Nunca un spinner eterno y
// nunca adentro de la app: el área del vendedor solo se abre con una sesión Cavos completa (app/_layout.tsx, Gate).
// Puro (sin React): lo usan el puente Cavos (web), el parche del kit (scripts/patch-cavos-kit.mjs), Welcome y los tests.

/** Pasos del login que pueden colgarse. */
export type LoginStep =
  | 'sdk_load' // bajar el chunk del SDK (lib/cavosBridge.tsx)
  | 'session_restore' // reconectar la sesión guardada al abrir
  | 'modal_open' // el modal de Cavos no apareció
  | 'oauth' // pedir el link de Google/Apple
  | 'oauth_redirect' // la página no salió hacia Google/Apple (PWA iOS) o la persona volvió sin terminar
  | 'oauth_return' // canjear el código al volver de Google/Apple
  | 'otp_send' // pedir el código por correo
  | 'otp_verify' // validar el código
  | 'passkey' // prompt de passkey (WebAuthn)
  | 'account_load'; // sesión lista pero la cuenta (dirección) no llega

/** Topes (ms). Passkey: la persona tiene que tocar el sensor, por eso más largo. */
export const LOGIN_TIMEOUTS: Record<LoginStep, number> = {
  sdk_load: 20_000,
  session_restore: 8_000,
  modal_open: 5_000,
  oauth: 20_000,
  oauth_redirect: 20_000,
  oauth_return: 20_000,
  otp_send: 20_000,
  otp_verify: 20_000,
  passkey: 60_000,
  account_load: 20_000,
};

const TIMEOUT_PREFIX = 'meteorito_timeout:';
export class LoginTimeoutError extends Error {
  code = 'timeout' as const;
  constructor(public step: LoginStep) { super(`${TIMEOUT_PREFIX}${step}`); this.name = 'LoginTimeoutError'; }
}
const STEPS = Object.keys(LOGIN_TIMEOUTS) as LoginStep[];
/** Paso de un error de tiempo (también si llega como texto, p. ej. desde el modal del kit). */
export function timeoutStep(e: unknown): LoginStep | null {
  const m = e instanceof Error ? e.message : String(e ?? '');
  if (!m.startsWith(TIMEOUT_PREFIX)) return null;
  const s = m.slice(TIMEOUT_PREFIX.length) as LoginStep;
  return STEPS.includes(s) ? s : null;
}

/** La persona canceló (cerró el prompt de passkey o la ventana): se vuelve al estado normal sin alarmar. */
export function isUserCancel(e: unknown): boolean {
  const name = (e as any)?.name ?? '';
  const m = e instanceof Error ? e.message : String(e ?? '');
  return name === 'NotAllowedError' || name === 'AbortError' || /NotAllowedError|cancel|closed by user|popup.*closed|user closed|dismiss|not allowed by the user agent|timed out or was not allowed/i.test(m);
}

/** Código corto para analítica (sin datos personales: nunca el mensaje crudo). */
export function loginErrorCode(e: unknown): string {
  if (timeoutStep(e)) return 'timeout';
  const m = e instanceof Error ? e.message : String(e ?? '');
  const name = (e as any)?.name ?? '';
  if (name === 'InvalidStateError' || /already pending|pending request/i.test(m)) return 'passkey_pending';
  if (isUserCancel(e)) return 'cancel';
  if (/recovery by sign-in is turned off|recovery_revoked/i.test(m)) return 'recovery_off';
  if (/no sealed recovery|no local key and no recovery wrap|not_enrolled|nothing to recover/i.test(m)) return 'no_recovery';
  if (/invalid_nonce/i.test(m)) return 'otp_stale';
  if (/invalid_code|code_expired|expired_code|otp_expired|invalid or expired code/i.test(m)) return 'otp_invalid';
  if (/\b429\b|too_many|rate.?limit/i.test(m)) return 'rate_limited';
  if (/invalid_email/i.test(m)) return 'email_invalid';
  if (/passkey|webauthn|credential|authenticator|prf/i.test(m)) return 'passkey';
  if (/\b40[13]\b|unauthori[sz]ed|token/i.test(m)) return 'auth';
  if (/failed to fetch|network|load failed|offline|\b50[0-4]\b|fetch failed|chunk|loading module|importing a module/i.test(m)) return 'network';
  if (/timed? ?out|timeout/i.test(m)) return 'timeout';
  return 'other';
}

export const LOGIN_RETRY = 'Reintentar';
export const EMAIL_ALT = 'Si sigue igual, entra con tu correo: te enviamos un código.';
const TIMEOUT_TEXT: Record<LoginStep, string> = {
  sdk_load: 'No pudimos cargar el inicio de sesión. Revisa tu conexión y toca «Reintentar».',
  session_restore: 'No pudimos confirmar tu sesión a tiempo. Toca «Entrar» para continuar.',
  modal_open: 'El inicio de sesión no se abrió. Toca «Reintentar».',
  oauth: 'Google o Apple tardaron demasiado en responder. Vuelve a intentar.',
  oauth_redirect: 'No volviste de Google o Apple. Vuelve a intentar.',
  oauth_return: 'No pudimos terminar el inicio de sesión con Google o Apple. Vuelve a intentar.',
  otp_send: 'El código por correo tardó demasiado. Vuelve a intentar.',
  otp_verify: 'Validar el código tardó demasiado. Vuelve a intentar con el último código.',
  passkey: 'La passkey no respondió a tiempo. Vuelve a intentar.',
  account_load: 'Tu cuenta tardó demasiado en cargar. Toca «Reintentar».',
};
/** Mensaje para la persona (tuteo): qué pasó + qué hacer. Siempre ofrece el código por correo como alternativa. */
export function timeoutMessage(step: LoginStep): string {
  return step === 'session_restore' ? TIMEOUT_TEXT[step] : `${TIMEOUT_TEXT[step]} ${EMAIL_ALT}`;
}

type Timers = { setTimeout: (f: () => void, ms: number) => any; clearTimeout: (id: any) => void };
const realTimers: Timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id) };

/** Promesa con tope: si no termina en `ms`, rechaza con LoginTimeoutError(step) y llama `onTimeout` (p. ej. abortar). */
export function withTimeout<T>(p: Promise<T>, step: LoginStep, opts: { ms?: number; onTimeout?: () => void; timers?: Timers } = {}): Promise<T> {
  const t = opts.timers ?? realTimers;
  const ms = opts.ms ?? LOGIN_TIMEOUTS[step];
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const id = t.setTimeout(() => {
      if (done) return; done = true;
      try { opts.onTimeout?.(); } catch { /* nada */ }
      reject(new LoginTimeoutError(step));
    }, ms);
    Promise.resolve(p).then(
      (v) => { if (done) return; done = true; t.clearTimeout(id); resolve(v); },
      (e) => { if (done) return; done = true; t.clearTimeout(id); reject(e); },
    );
  });
}

// ---------- WebAuthn: un solo prompt vivo, abortable ----------
// iOS rechaza un navigator.credentials.get/create nuevo mientras otro sigue pendiente: si un prompt quedó colgado, el
// siguiente intento fallaba también. El parche del kit pasa esta señal a cada llamada; al vencer o reintentar se aborta.
let passkeyCtl: AbortController | null = null;
export function webAuthnSignal(): AbortSignal | undefined {
  if (typeof AbortController === 'undefined') return undefined;
  passkeyCtl?.abort();
  passkeyCtl = new AbortController();
  return passkeyCtl.signal;
}
export function abortPasskey() { passkeyCtl?.abort(); passkeyCtl = null; }

// ---------- Eventos (los inyecta el puente; aquí sin dependencia de analytics) ----------
type Track = (event: string, props?: Record<string, string | number | boolean | null | undefined>) => void;
let trackFn: Track = () => {};
export function setLoginTracker(t: Track) { trackFn = t; }
export const trackLoginTimeout = (step: LoginStep) => trackFn('login_timeout', { step });
export const trackLoginError = (step: LoginStep | string, e: unknown) => trackFn('login_error', { step, code: loginErrorCode(e) });

/** Guardia que usa el modal parchado del kit: tope + eventos + abortar el prompt de passkey al vencer. */
export function guard<T>(p: Promise<T>, step: LoginStep, timers?: Timers): Promise<T> {
  return withTimeout(p, step, { timers, onTimeout: () => { trackLoginTimeout(step); if (step === 'passkey') abortPasskey(); } })
    .catch((e) => { if (!timeoutStep(e)) trackLoginError(step, e); throw e; });
}

/** Google/Apple: el kit asigna location.href y deja el botón ocupado esperando la navegación. En la PWA de iPhone esa
 *  navegación puede abrirse en otra vista (o la persona vuelve sin terminar): la página sigue aquí con el spinner.
 *  Si la página vuelve a estar visible, o pasa el tope sin salir, se libera el botón con un mensaje. Devuelve "desarmar". */
export function armOAuthReturn(reset: (code: string) => void, env: { doc?: any; win?: any; timers?: Timers } = {}): () => void {
  const doc = env.doc ?? (typeof document !== 'undefined' ? document : null);
  const win = env.win ?? (typeof window !== 'undefined' ? window : null);
  const t = env.timers ?? realTimers;
  if (!doc || !win) return () => {};
  let hidden = false; let fired = false;
  const fire = () => { if (fired) return; fired = true; cleanup(); trackLoginTimeout('oauth_redirect'); reset(new LoginTimeoutError('oauth_redirect').message); }; // el modal lo traduce (lib/authUx.ts)
  const onVis = () => { if (doc.visibilityState === 'hidden') hidden = true; else if (hidden) fire(); };
  const onShow = (e: any) => { if (e?.persisted) fire(); };
  const onHide = () => { hidden = true; };
  const id = t.setTimeout(() => { if (doc.visibilityState !== 'hidden') fire(); else hidden = true; }, LOGIN_TIMEOUTS.oauth_redirect);
  function cleanup() { t.clearTimeout(id); doc.removeEventListener('visibilitychange', onVis); win.removeEventListener('pageshow', onShow); win.removeEventListener('pagehide', onHide); }
  doc.addEventListener('visibilitychange', onVis); win.addEventListener('pageshow', onShow); win.addEventListener('pagehide', onHide);
  return cleanup;
}

/** Engancha la guardia para el modal parchado (scripts/patch-cavos-kit.mjs). Idempotente. */
export function installKitGuard(track?: Track) {
  if (track) setLoginTracker(track);
  const g = globalThis as any;
  g.__meteoritoGuard = guard;
  g.__meteoritoWebAuthnSignal = webAuthnSignal;
  g.__meteoritoOAuthArm = armOAuthReturn;
}

// ---------- Pantalla de entrar: ¿el botón lleva demasiado tiempo ocupado? ----------
export interface BusyInput { busy: boolean; wantLogin: boolean; hint: boolean; isAuthenticated: boolean; loadFailed: boolean }
/** Qué paso está esperando el botón "Entrar" (para el tope y el evento). */
export function busyStep(s: BusyInput): LoginStep {
  if (s.loadFailed) return 'sdk_load';
  if (s.isAuthenticated) return 'account_load';
  if (s.wantLogin) return 'sdk_load';
  return s.hint ? 'session_restore' : 'sdk_load';
}
export interface WelcomeView { loading: boolean; disabled: boolean; title: string; message: string | null; stalled: LoginStep | null }
/** Vista del botón principal de la pantalla de entrar. Con un paso vencido: sin spinner, habilitado, "Reintentar" + mensaje. */
export function welcomeView(i: { busy: boolean; configured: boolean; relogin: boolean; stalled: LoginStep | null }): WelcomeView {
  if (i.stalled) return { loading: false, disabled: !i.configured, title: i.stalled === 'session_restore' ? 'Entrar' : LOGIN_RETRY, message: timeoutMessage(i.stalled), stalled: i.stalled };
  return { loading: i.busy, disabled: !i.configured, title: i.relogin ? 'Entrar de nuevo' : 'Entrar', message: null, stalled: null };
}
