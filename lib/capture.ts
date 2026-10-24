// Cámara de la app (fotos "solo cámara"): helpers puros + token de captura. Se prueban en Node (scripts/ci/t58).
// Propósitos: ship (prueba de envío, obligatoria), listing (producto nuevo en Vender o invitación del comprador) y
// dispute (fotos al reportar un problema). Nunca se ofrece el carrete ni un input de archivo para estos tres.
import type { MeteoritoAuth } from './types';

export type CapturePurpose = 'ship' | 'listing' | 'dispute';
export interface CaptureToken { token: string; id: string; purpose: CapturePurpose; ref: string; code: string; exp: string; now: string; /** hora del servidor - hora del teléfono */ offsetMs: number }
/** Foto tomada y ya subida: lo que guardan Vender, la invitación, la disputa y "Ya lo envié". */
export interface CapturedPhoto { url: string; uri: string; token: string; token_id: string; captured_at: string; purpose: CapturePurpose }
export type CameraFailure = 'denied' | 'busy' | 'unsupported' | 'nocamera' | 'token';

/** Fecha y hora de Costa Rica (UTC-6 fijo, sin horario de verano): "24/10/2026 00:15:07". */
export function crStamp(ms: number): string {
  const d = new Date(ms - 6 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
/** Las dos líneas de la marca que se dibuja EN la foto (evidencia). */
export const stampLines = (ms: number, code: string) => [`${crStamp(ms)} CR`, `Meteorito · ${code}`];

/** Error de getUserMedia -> estado de la pantalla. Nunca se cae al carrete. */
export function classifyCameraError(e: unknown): CameraFailure {
  const n = String((e as any)?.name ?? '');
  if (n === 'NotAllowedError' || n === 'PermissionDeniedError' || n === 'SecurityError') return 'denied';
  if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return 'busy';
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') return 'nocamera';
  if (n === 'TypeError' || n === 'NotSupportedError') return 'unsupported';
  return 'busy';
}

export interface CameraEnv { ios: boolean; standalone: boolean }
export function cameraEnv(): CameraEnv {
  if (typeof navigator === 'undefined') return { ios: false, standalone: false };
  const ua = navigator.userAgent || '';
  const ios = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1);
  const standalone = (navigator as any).standalone === true || (typeof window !== 'undefined' && !!window.matchMedia?.('(display-mode: standalone)').matches);
  return { ios, standalone };
}

/** Texto del estado sin cámara: qué pasó y cómo activarla (Safari, app en la pantalla de inicio u otro navegador). */
export function cameraHelp(kind: CameraFailure, env: CameraEnv): { title: string; body: string } {
  if (kind === 'denied') {
    const body = env.ios && env.standalone
      ? 'Abre Ajustes del iPhone > Apps > Safari > Cámara y elige Permitir o Preguntar. Luego vuelve aquí y toca Reintentar.'
      : env.ios
        ? 'En Safari toca el botón aA junto a la dirección > Configuración del sitio web > Cámara > Permitir. Luego toca Reintentar.'
        : 'Permite la cámara para este sitio en la configuración del navegador (el candado junto a la dirección) y toca Reintentar.';
    return { title: 'Necesitamos tu cámara para tomar la foto', body };
  }
  if (kind === 'busy') return { title: 'Tu cámara está ocupada', body: 'Cierra otras apps o pestañas que la estén usando (FaceTime, WhatsApp, una videollamada) y toca Reintentar.' };
  if (kind === 'nocamera') return { title: 'No encontramos una cámara', body: 'Abre Meteorito en tu teléfono para tomar la foto en este momento.' };
  if (kind === 'unsupported') return { title: 'Este navegador no deja usar la cámara', body: 'Abre pago.meteorito.app en Safari (iOS 13.4 o superior) o en Chrome actualizado para tomar la foto.' };
  return { title: 'No pudimos preparar la cámara', body: 'Revisa tu conexión y toca Reintentar.' };
}

/** Pide el token de captura de un solo uso al abrir la cámara. Invitados (sin cuenta) con su llave. */
export async function requestCaptureToken(auth: MeteoritoAuth, purpose: CapturePurpose, ref: string, asGuest: boolean): Promise<CaptureToken> {
  const { api, guestApi } = await import('./api');
  const body = { action: 'capture_token', purpose, ref, ...(asGuest && purpose === 'listing' ? { as: 'guest' } : {}) };
  const sent = Date.now();
  const r: Omit<CaptureToken, 'offsetMs'> = asGuest ? await guestApi(auth, '/api/photos/upload-url', body) : await api(auth, '/api/photos/upload-url', body);
  const server = Date.parse(r.now);
  return { ...r, offsetMs: Number.isFinite(server) ? server - Math.round((sent + Date.now()) / 2) : 0 };
}
/** Hora de la captura con el reloj del servidor (el del teléfono puede estar mal). */
export const captureNow = (t: Pick<CaptureToken, 'offsetMs'>, now = Date.now()) => now + (t.offsetMs || 0);
/** ¿Sigue vigente el token? (margen de 15 s para la subida). */
export const tokenFresh = (t: Pick<CaptureToken, 'exp' | 'offsetMs'>, now = Date.now()) => captureNow(t, now) < Date.parse(t.exp) - 15_000;
