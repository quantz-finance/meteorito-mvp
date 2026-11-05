// Instalar la PWA ("Descargar app"): lógica pura (sin DOM), probada en scripts/ci/t112-install.test.ts.
// lib/install.ts la usa con el navegador real.

/** Qué flujo de instalación corresponde a este navegador.
 *  - prompt: Chromium/Android/escritorio con beforeinstallprompt guardado -> un toque, el navegador instala.
 *  - ios: Safari de iPhone/iPad -> guía de 2 pasos (Apple no permite instalar por código).
 *  - inapp: navegador dentro de Instagram, Facebook, WhatsApp, TikTok… -> abrir el link en el navegador.
 *  - ios-other: Chrome/Firefox/Edge… en iPhone -> abrir el link en Safari.
 *  - generic: sin aviso del navegador -> menú del navegador → Instalar app. */
export type InstallKind = 'prompt' | 'ios' | 'inapp' | 'ios-other' | 'generic';

export type InstallEnv = { ios: boolean; android: boolean; inApp: string | null; iosOtherBrowser: boolean };

const IN_APP: [string, RegExp][] = [
  ['instagram', /Instagram/i], ['facebook', /FBAN|FBAV|FB_IAB|FBIOS|FB4A|MessengerForiOS/i], ['whatsapp', /WhatsApp/i],
  ['tiktok', /musical_ly|BytedanceWebview|TikTok|ByteLocale/i], ['snapchat', /Snapchat/i], ['line', /\bLine\//i],
  ['telegram', /Telegram/i], ['linkedin', /LinkedInApp/i], ['twitter', /Twitter/i],
];

/** maxTouchPoints: el iPad con iPadOS se presenta como Mac; con pantalla táctil es un iPad. */
export function detectInstallEnv(ua: string, maxTouchPoints = 0): InstallEnv {
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const inApp = IN_APP.find(([, re]) => re.test(ua))?.[0] ?? (android && /; wv\)/.test(ua) ? 'webview' : null);
  // En iOS todos usan WebKit; los otros navegadores se delatan con su marca en el UA. GSA = app de Google.
  const iosOtherBrowser = ios && !inApp && /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|YaBrowser|DuckDuckGo|Brave/i.test(ua);
  return { ios, android, inApp, iosOtherBrowser };
}

export function installKind(env: InstallEnv, hasPrompt: boolean): InstallKind {
  if (env.inApp) return 'inapp';
  if (env.ios) return env.iosOtherBrowser ? 'ios-other' : 'ios';
  return hasPrompt ? 'prompt' : 'generic';
}

/** ¿Ya corre instalada (pantalla de inicio)? display-mode standalone/fullscreen/minimal-ui o navigator.standalone (iOS). */
export const isStandalone = (displayModeStandalone: boolean, navigatorStandalone: unknown) =>
  displayModeStandalone || navigatorStandalone === true;

/** ?instalar=1 (el botón "Descargar app" del landing): abrir el flujo de instalación al cargar. */
export function wantsInstall(href: string): boolean {
  try { const v = new URL(href).searchParams.get('instalar'); return v === '1' || v === 'true' || v === ''; } catch { return false; }
}

/** Link para abrir en otro navegador: la raíz con ?instalar=1 (abre la guía directo). */
export function installLink(origin: string): string { return `${origin.replace(/\/$/, '')}/?instalar=1`; }
