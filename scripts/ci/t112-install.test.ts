// (112) "Descargar app" (PWA): detección de navegador, flujo por plataforma, ?instalar=1, manifest instalable y copy. Sin red.
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { detectInstallEnv, installKind, installLink, isStandalone, wantsInstall } from '../../lib/installCore';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 389.0.0.29.84 (iPhone15,2; iOS 18_5; es_CR; es; scale=3.00; 1179x2556)',
  iphoneFacebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/520.0.0.38.101;FBBV/1;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.5;FBSS/3;FBLC/es_LA]',
  iphoneTikTok: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_40.1.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/es',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  androidWhatsApp: 'Mozilla/5.0 (Linux; Android 14; SM-A146M Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.0.0 Mobile Safari/537.36 WhatsApp/2.25.1',
  ipadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  desktopChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
};
const k = (ua: string, prompt = false, touch = 0) => installKind(detectInstallEnv(ua, touch), prompt);

export async function run(t: T) {
  t.check('iPhone Safari -> guía de 2 pasos (sin instalar por código)', k(UA.iphoneSafari) === 'ios' && k(UA.iphoneSafari, true) === 'ios');
  t.check('iPad (UA de Mac + táctil) -> guía iOS', k(UA.ipadOS, false, 5) === 'ios');
  t.check('Mac de escritorio (sin táctil) no es iOS', k(UA.ipadOS, false, 0) === 'generic');
  t.check('Chrome en iPhone -> abrir en Safari', k(UA.iphoneChrome) === 'ios-other');
  for (const ua of ['iphoneInstagram', 'iphoneFacebook', 'iphoneTikTok', 'androidWhatsApp'] as const)
    t.check(`in-app (${ua}) -> abrir en el navegador`, k(UA[ua], true) === 'inapp');
  t.check('Android Chrome con beforeinstallprompt -> un toque', k(UA.androidChrome, true) === 'prompt');
  t.check('Android Chrome sin aviso -> instrucciones del menú', k(UA.androidChrome, false) === 'generic');
  t.check('escritorio Chrome con aviso -> un toque', k(UA.desktopChrome, true) === 'prompt');
  t.check('standalone: display-mode o navigator.standalone (iOS)', isStandalone(true, undefined) && isStandalone(false, true) && !isStandalone(false, false) && !isStandalone(false, undefined));
  t.check('?instalar=1 abre el flujo', wantsInstall('https://pago.meteorito.app/?instalar=1') && wantsInstall('https://pago.meteorito.app/?utm_source=landing&instalar=1'));
  t.check('sin ?instalar no abre nada', !wantsInstall('https://pago.meteorito.app/') && !wantsInstall('https://pago.meteorito.app/?instalar=0') && !wantsInstall('no es url'));
  t.check('link para copiar: raíz con ?instalar=1', installLink('https://pago.meteorito.app') === 'https://pago.meteorito.app/?instalar=1');

  // Manifest instalable (Chrome/Android) + metas de iOS.
  const m = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
  const icon = (size: string, purpose: string) => m.icons.some((i: any) => i.sizes === size && String(i.purpose ?? 'any').split(' ').includes(purpose));
  t.check('manifest: name/short_name Meteorito', m.name === 'Meteorito' && m.short_name === 'Meteorito');
  t.check('manifest: display standalone, start_url, scope, colores', m.display === 'standalone' && m.start_url === '/vender' && m.scope === '/' && !!m.theme_color && !!m.background_color);
  t.check('manifest: iconos 192 y 512 (any) + maskable', icon('192x192', 'any') && icon('512x512', 'any') && icon('512x512', 'maskable'));
  const html = readFileSync('app/+html.tsx', 'utf8');
  t.check('HTML: manifest, apple-touch-icon y apple-mobile-web-app-capable', html.includes('rel="manifest" href="/manifest.json"') && html.includes('rel="apple-touch-icon"') && html.includes('name="apple-mobile-web-app-capable" content="yes"'));
  t.check('service worker en public/sw.js con fetch handler', /addEventListener\('fetch'/.test(readFileSync('public/sw.js', 'utf8')));

  // Solo web: en nativo no se muestra (y no rompe el build nativo: sin APIs del DOM al importar).
  const lib = readFileSync('lib/install.ts', 'utf8');
  t.check('lib/install: solo web (Platform.OS === web)', lib.includes("Platform.OS === 'web' && typeof window !== 'undefined'") && lib.includes('e.preventDefault()'));
  const ui = readFileSync('components/InstallApp.tsx', 'utf8');
  t.check('botón con testID install-app-button y label "Descargar app"', ui.includes('testID="install-app-button"') && ui.includes("'Descargar app'"));
  t.check('iOS: Compartir -> "Agregar a pantalla de inicio"; in-app: "Abre este link en Safari para instalar"', ui.includes('Agregar a pantalla de inicio') && ui.includes('Abre este link en Safari para instalar'));
  const text = (ui.match(/'[^']*'|"[^"]*"|`[^`]*`|>[^<>{}]+</g) ?? []).join(' ');
  const banned = /\b(seguro|segura|garantía|garantia|verificad[oa]|proteg\w*|empresa|fintech|banco|billetera|anti-?estafa)\b|100\s?%/i;
  t.check('copy sin palabras prohibidas', !banned.test(text), text.match(banned)?.[0]);
  t.check('copy en tuteo (sin voseo)', !/\b(abrí|tocá|elegí|copiá|pegá|agregá|tenés|podés)\b/i.test(text));
}
