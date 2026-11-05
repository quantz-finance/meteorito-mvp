// Solo iOS/Android (lo importa lib/cavos.tsx, que la web no carga: allí se usa lib/cavos.web.tsx).
// 1) La app llama a su backend con rutas relativas (fetch('/api/...')). En la web resuelven contra el dominio de la
//    página; en nativo no hay "página" y fallan. Aquí se antepone EXPO_PUBLIC_API_BASE (default pago.meteorito.app).
//    En nativo no hay CORS: el fetch de React Native no hace preflight ni valida Access-Control-*.
// 2) El kit nativo de Cavos 0.3.0 no expone el id_token del login (el web lo deja en sessionStorage). Lo tomamos de la
//    respuesta del propio login (OTP/OAuth) y lo guardamos SOLO en memoria, igual que el kit: al cerrar la app se pierde
//    y el API pide volver a entrar (session_relogin_required), sin tocar la llave del dispositivo.
import { Platform } from 'react-native';

export const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || 'https://pago.meteorito.app').replace(/\/+$/, '');

/** '/api/x' -> 'https://pago.meteorito.app/api/x'. URLs absolutas, '//host' y data:/blob:/file: quedan igual. */
export function absoluteApiUrl(u: string, base = API_BASE): string {
  return u.startsWith('/') && !u.startsWith('//') ? base + u : u;
}

const LOGIN_TOKEN_PATH = /\/api\/oauth\/(firebase\/otp\/verify|callback\/exchange)$/;
let cavosToken: string | null = null;
export const nativeAuthToken = () => cavosToken;
export const clearNativeAuthToken = () => { cavosToken = null; };

/** id_token de la respuesta de login de Cavos (misma forma que lee el kit: id_token | jwt | token). */
export function tokenFromLogin(j: any): string | null {
  const t = j?.id_token ?? j?.jwt ?? j?.token;
  return typeof t === 'string' && t.split('.').length === 3 ? t : null;
}

const g = globalThis as any;
if (Platform.OS !== 'web' && typeof g.fetch === 'function' && !g.__meteoritoNativeFetch) {
  const original: typeof fetch = g.fetch.bind(g);
  const wrapped = async (input: any, init?: any): Promise<Response> => {
    let target = input;
    if (typeof input === 'string') target = absoluteApiUrl(input);
    else if (input && typeof input === 'object' && !(input instanceof URL) && typeof input.url === 'string' && input.url.startsWith('/')) {
      target = new Request(absoluteApiUrl(input.url), input);
    }
    const res = await original(target, init);
    const url = String(typeof target === 'string' ? target : target?.url ?? target?.href ?? '').split('?')[0];
    if (res.ok && LOGIN_TOKEN_PATH.test(url) && !url.startsWith(API_BASE)) {
      try { const t = tokenFromLogin(await res.clone().json()); if (t) cavosToken = t; } catch { /* respuesta sin JSON: el kit dará el error */ }
    }
    return res;
  };
  g.fetch = wrapped;
  g.__meteoritoNativeFetch = true;
}
