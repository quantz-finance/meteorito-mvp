import { ScrollViewStyleReset } from 'expo-router/html';
import type { ReactNode } from 'react';

const SUPABASE_ORIGIN = (() => { try { return new URL(process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').origin; } catch { return ''; } })();
const SPLASH_CSS = '#boot-splash{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:#1A0B3D;transition:opacity .25s}#boot-splash .bs-logo{font:900 34px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#fff;letter-spacing:.5px}#boot-splash .bs-dot{width:10px;height:10px;border-radius:50%;background:#B79CFF;animation:bsp 1s ease-in-out infinite}@keyframes bsp{0%,100%{transform:scale(.6);opacity:.5}50%{transform:scale(1.2);opacity:1}}';

export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
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
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: SPLASH_CSS + 'html,body{background-color:#1A0B3D;}html,body,#root{height:100%;height:100dvh;}body{overflow:hidden;overscroll-behavior:none;}' }} />
      </head>
      <body>
        {/* Splash inline: pinta en el primer frame (antes del JS) y la app lo quita al montar. Sin JS ni imágenes. */}
        <div id="boot-splash" dangerouslySetInnerHTML={{ __html: '<div class="bs-logo">Meteorito</div><div class="bs-dot"></div>' }} />
        {children}
      </body>
    </html>
  );
}
