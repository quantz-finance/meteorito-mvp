# Meteorito MVP (cascarón v0)

App de Meteorito en React Native + Expo Router + TypeScript. Corre como **web app** (Vercel, se instala en el iPhone desde Safari) y como **app nativa iOS** (el mismo código que después va a la App Store).

Incluye: bienvenida, login con Cavos (Google, Apple o correo) en **Stellar testnet**, "Hola [correo]" con tu cuenta `G…`, saldo XLM/USDC desde Horizon testnet, cerrar sesión, sesión persistente, y las pestañas Vender, Comprar y Mis pedidos (vacías).

## Configuración

```bash
cp .env.example .env
# poné tu EXPO_PUBLIC_CAVOS_APP_ID (testnet) del dashboard de Cavos
```

`.env` nunca se sube al repo (está en `.gitignore`).

### Dashboard de Cavos
- **Allowed web origins / Callback URLs**: el dominio de la app (`https://pago.meteorito.app`; mantener `https://meteorito-mvp.vercel.app` unos días por la redirección) y `http://localhost:8081` para desarrollo.
- **Callback URL nativa**: `meteorito://cavos-auth`.
- Red: testnet, cadena Stellar.

## Probar en el iPhone hoy (web app)
1. Abrí la URL de Vercel en **Safari**.
2. Compartir → **Agregar a pantalla de inicio**. Abre a pantalla completa como una app.

## Correr nativo en tu iPhone desde la Mac
1. Instalá **Xcode** desde la App Store y abrilo una vez (aceptá las licencias).
2. Xcode → Settings → **Accounts** → agregá tu **Apple ID** (gratis sirve).
3. En el iPhone: Ajustes → Privacidad y seguridad → **Modo desarrollador** → activar y reiniciar.
4. Conectá el iPhone por cable y confiá en la Mac.
5. En la terminal:
   ```bash
   git clone <repo> && cd meteorito-mvp
   npm i
   cp .env.example .env   # y completá el App ID
   npx expo run:ios --device
   ```
6. Si Xcode pide equipo de firma, elegí tu Apple ID (Personal Team). En el iPhone: Ajustes → General → VPN y gestión de dispositivos → confiá en tu desarrollador.

Con Apple ID gratis la app dura 7 días y hay que reinstalarla. Para TestFlight/App Store hace falta la cuenta Apple Developer (USD 99). Expo Go **no** sirve (Cavos necesita módulo nativo).

## Web local y build
```bash
npx expo start --web
npx expo export -p web   # genera dist/ (lo que usa Vercel)
```

## Estructura
- `lib/cavos.tsx` — SDK nativo (`@cavos/kit/react-native`), iOS/Android.
- `lib/cavos.web.tsx` — SDK web (`@cavos/kit/react`, llaves en el vault de Cavos).
- `lib/horizon.ts` — saldos de Horizon testnet.
- `app/` — rutas (Expo Router).
