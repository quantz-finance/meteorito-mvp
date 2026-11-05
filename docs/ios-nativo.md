# iOS nativo (`npx expo run:ios`)

La web (PWA en pago.meteorito.app) no cambia: todo lo de aquí corre solo cuando `Platform.OS !== 'web'`, o vive en
archivos que la web no carga (`lib/cavos.tsx` y `lib/nativeFetch.ts`; la web usa `lib/cavos.web.tsx`).

## Correr en el Mac
1. `.env` en la raíz con las variables `EXPO_PUBLIC_*` de cliente (nunca secretos del servidor; ver `.env.example`).
   Sin `EXPO_PUBLIC_CAVOS_APP_ID` la app muestra "Falta configurar la app" en vez de reventar.
2. `npm ci && npx expo run:ios` (simulador) o `npx expo run:ios --device` (iPhone con Apple ID gratis: Associated
   Domains apagado, ver `app.config.ts`). Bundle `app.meteorito.mobile`, scheme `meteorito` (callback de Cavos
   `meteorito://cavos-auth`).

## Qué hace la capa nativa
- `lib/nativeFetch.ts`: `fetch('/api/...')` -> `${EXPO_PUBLIC_API_BASE || 'https://pago.meteorito.app'}/api/...`.
  En nativo no hay CORS (React Native no hace preflight), así que el API de Vercel responde igual.
- El kit nativo de Cavos 0.3.0 no expone el id_token: se toma de la respuesta del login (OTP / OAuth) y queda solo
  en memoria. Al reabrir la app, la próxima escritura al API pide "Entrar de nuevo" (la llave del dispositivo se queda).
- `metro.config.js`: en iOS/Android, `eventsource` (dependencia Node de @stellar/stellar-sdk) se cambia por un stub;
  sin eso `npx expo export --platform ios` falla con "Unable to resolve module url".
- Web Push: oculto en nativo (`pushStatus` = `unsupported`). Widget de tarjeta (iframe Lendara): mensaje amable; el
  formulario propio de tarjeta sí funciona.

## Todavía no funciona en nativo
- Cámara de envío/listado (`components/CameraCapture.tsx` usa `getUserMedia`): cae en el estado "sin cámara".
- Notificaciones push nativas (habría que usar expo-notifications).
- Persistencia entre aperturas de lo que la web guarda en localStorage (borradores, PIN de comprador invitado,
  preferencias): en nativo esas lecturas fallan en silencio y la app sigue, sin recordar entre aperturas.
