import { ScrollViewStyleReset } from 'expo-router/html';
import { MOTION_CSS } from '@/constants/motion';
import type { ReactNode } from 'react';
import { SPLASH_IMG } from '@/constants/splashImages';
import { UNIVERSE_HTML, universeCss } from '@/constants/universe';

const SUPABASE_ORIGIN = (() => { try { return new URL(process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').origin; } catch { return ''; } })();
// Splash de arranque: la mascota con su estela (mismas capas y geometría que LivelyMascot en 140 px), pintada
// en el primer frame desde el HTML, antes del JS (imágenes inline, ~38 KB, sin esperar descargas). Solo transform/opacity en CSS; la app lo desvanece al montar.
const assetUrl = (m: unknown): string => (typeof m === 'string' ? m : (m as { uri?: string; default?: string })?.uri ?? (m as { default?: string })?.default ?? '');
// Imágenes que la bienvenida usa al hidratar: se piden con prioridad baja para no competir con el JS.
const APP_IMG = [
  require('../assets/images/space/mascot.webp'), require('../assets/images/space/trail-f1.webp'),
  require('../assets/images/space/trail-f2.webp'), require('../assets/images/space/trail-f3.webp'),
].map(assetUrl).filter(Boolean);
// Universo animado de fondo (fijo, fuera de React): ver constants/universe.ts.
const UNIVERSE_CSS = universeCss({
  far: assetUrl(require('../assets/images/space/stars-far.webp')),
  near: assetUrl(require('../assets/images/space/stars-near.webp')),
  nebula: assetUrl(require('../assets/images/space/nebula.webp')),
});
const SPLASH_CSS = '#boot-splash{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;background:#1A0B3D;transition:opacity .35s cubic-bezier(.22,1,.36,1),transform .35s cubic-bezier(.22,1,.36,1)}'
  + '#boot-splash.bs-out{opacity:0;transform:scale(1.04);pointer-events:none}'
  + '.bs-stage{position:relative;width:140px;height:132px}'
  + '.bs-glow{position:absolute;left:-40px;top:-44px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(255,138,61,.32) 0,rgba(183,148,255,.14) 45%,rgba(26,11,61,0) 70%);animation:bs-glow 3.2s ease-in-out infinite}'
  + '.bs-m{position:absolute;inset:0}.bs-axis{position:absolute;left:86.8px;top:79.2px;width:0;height:0;transform:rotate(216deg)}'
  + '.bs-f{position:absolute;left:28px;transform-origin:left center}.bs-f1{top:-28px;width:119px;height:56px}.bs-f2{top:-28px;width:95.2px;height:36.4px}.bs-f3{top:-2.8px;width:100.8px;height:33.6px}'
  + '.bs-mascot{position:absolute;inset:0;width:140px;height:132px}'
  + '.bs-logo{font:900 30px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#fff;letter-spacing:.5px}'
  + '@keyframes bs-glow{0%,100%{opacity:.7;transform:scale(1)}50%{opacity:1;transform:scale(1.08)}}';
const SPLASH_HTML = '<div class="bs-stage"><div class="bs-glow"></div><div class="bs-m" data-anim="dive"><div class="bs-axis">'
  + `<img class="bs-f bs-f1" data-anim="f1" src="${SPLASH_IMG.f1}" alt=""><img class="bs-f bs-f2" data-anim="f2" src="${SPLASH_IMG.f2}" alt=""><img class="bs-f bs-f3" data-anim="f3" src="${SPLASH_IMG.f3}" alt="">`
  + `</div><img class="bs-mascot" src="${SPLASH_IMG.mascot}" alt=""></div></div><div class="bs-logo">Meteorito</div>`;
// Pausa las animaciones CSS en bucle (mascota, splash) cuando la pestaña no está visible.
const VIS_JS = "document.addEventListener('visibilitychange',function(){document.documentElement.classList.toggle('bg-hidden',document.hidden)});";

// iOS Safari hace zoom al enfocar un campo con font-size < 16px (el modal de Cavos usa 14px).
// Nuestros TextInput (clases css-* de react-native-web) ya usan >= 16px; esto cubre los de terceros.
// [ancho px, alto px, densidad] de pantallas de iPhone comunes (vertical).
const STARTUP: [number, number, number][] = [[750, 1334, 2], [1125, 2436, 3], [1170, 2532, 3], [1179, 2556, 3], [1284, 2778, 3], [1290, 2796, 3], [828, 1792, 2]];

const NO_ZOOM_CSS = 'input:not([class*="css-"]),textarea:not([class*="css-"]),select,.cavos-input-inner{font-size:16px!important;}';

export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, interactive-widget=resizes-visual" />
        <title>Meteorito</title>
        <meta name="theme-color" content="#1A0B3D" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Meteorito" />
        {/* Conexiones tempranas a las APIs críticas (la base de datos del link de pago y Horizon). */}
        {SUPABASE_ORIGIN ? <link rel="preconnect" href={SUPABASE_ORIGIN} crossOrigin="anonymous" /> : null}
        <link rel="dns-prefetch" href="https://horizon-testnet.stellar.org" />
        {APP_IMG.map((src) => <link key={src} rel="preload" as="image" href={src} fetchPriority="low" />)}
        {/* iOS PWA: mismo fondo y mascota mientras abre (imágenes generadas por scripts/build/startup-images.mjs). */}
        {STARTUP.map(([w, h, r]) => <link key={w} rel="apple-touch-startup-image" href={`/splash/startup-${w}x${h}.png`}
          media={`(device-width: ${w / r}px) and (device-height: ${h / r}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`} />)}
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: SPLASH_CSS + 'html,body{background-color:#1A0B3D;}html,body{height:100%;height:100dvh;}#root{height:100%;height:var(--app-h,100dvh);}body{overflow:hidden;overscroll-behavior:none;}' + NO_ZOOM_CSS + MOTION_CSS + UNIVERSE_CSS }} />
      </head>
      <body>
        {/* Splash inline: pinta en el primer frame (antes del JS) y la app lo desvanece al montar. */}
        <div id="u" aria-hidden="true" data-testid="universe" dangerouslySetInnerHTML={{ __html: UNIVERSE_HTML }} />
        <div id="boot-splash" aria-label="Cargando Meteorito" role="img" dangerouslySetInnerHTML={{ __html: SPLASH_HTML }} />
        <script dangerouslySetInnerHTML={{ __html: VIS_JS }} />
        {children}
      </body>
    </html>
  );
}
