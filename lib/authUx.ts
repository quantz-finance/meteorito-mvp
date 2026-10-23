// Login y sesión: textos amables para errores del kit Cavos (nunca "kit/auth: ... 401"), autofill del código por correo
// y reglas para mostrar un error de sesión UNA sola vez. Puro (sin React ni red): lo usan el puente Cavos y las pantallas.
import { userMessage } from './cavosSession';

export const OTP_INVALID = 'El código no es válido o ya venció. Pide uno nuevo: solo sirve el último código que te enviamos.';
export const OTP_STALE = 'Ese código ya no sirve porque pediste otro o la app se recargó. Toca «Reenviar código» y usa el más reciente.';
export const OTP_RATE = 'Pediste varios códigos seguidos. Espera un minuto y vuelve a intentar.';
export const EMAIL_INVALID = 'Revisa tu correo: parece que tiene un error.';

/** Error del kit (o nuestro) -> texto para la persona. Los errores técnicos nunca se muestran crudos. */
export function authErrorText(raw: string | null | undefined): string {
  const m = String(raw ?? '');
  if (/invalid_nonce/i.test(m)) return OTP_STALE;
  if (/invalid_code|code_expired|expired_code|otp_expired|invalid or expired code/i.test(m)) return OTP_INVALID;
  if (/\b429\b|too_many|rate.?limit/i.test(m)) return OTP_RATE;
  if (/otp\/request.*->\s*400|invalid_email/i.test(m)) return EMAIL_INVALID;
  return userMessage(m); // "kit/auth: ..." y demás técnicos -> mensaje propio (red, re-login o genérico)
}

/** Autofill de iOS o pegado: llega el código entero en una casilla -> repartir desde ahí (string: conserva ceros).
 *  null = una tecla normal (el kit sigue con su lógica de un dígito). */
export function otpFill(prev: string, i: number, raw: string): { code: string; focus: number } | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length < 3) return null;
  const code = (String(prev ?? '').slice(0, i) + digits).slice(0, 6);
  return { code, focus: Math.min(code.length, 5) };
}

const SESSION_CODES = new Set(['auth_invalid', 'auth_missing', 'session_expired', 'session_relogin_required', 'session_wallet_mismatch', 'bind_invalid']);
/** ¿El error es de sesión (token rechazado/vencido)? Se muestra una vez en la pantalla, no en cada tarjeta. */
export const isSessionError = (e: any): boolean => !!e && SESSION_CODES.has(String(e.code ?? ''));

/** La tarjeta de notificaciones del vendedor necesita una sesión válida (guarda la suscripción con su token). */
export const sellerPushVisible = (s: { authed: boolean; hasToken: boolean; sessionError: boolean }) => s.authed && s.hasToken && !s.sessionError;
