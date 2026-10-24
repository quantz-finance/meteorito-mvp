# Modo demo (para grabar el video de inversionistas)

El **modo demo** deja recorrer el flujo completo de Meteorito **sin login humano, sin backend y sin base de datos**, con las **mismas pantallas y textos** que en testnet. Todo es estado local simulado (memoria + `sessionStorage` de la pestaña). **Está apagado por defecto.**

## Seguridad (por qué no puede tocar producción)

- Se activa **solo** con la variable de build `EXPO_PUBLIC_DEMO_MODE=1` (o `true`). Cualquier otro valor, o ausente = apagado.
- Aunque la variable estuviera puesta, se **desactiva sola** en `pago.meteorito.app` / `meteorito.app` (`DEMO_BLOCKED_HOSTS` en `lib/demo.ts`).
- Con el modo demo activo, `api()` **no hace `fetch`**: responde el simulador (`demoApi`). `supabase()` lanza error, `fetchBalances` no llama a Horizon, no hay analítica ni login Cavos, `/api/health` y `/api/escrow/cron` no se consultan.
- No se firma nada ni se mueven fondos. Las direcciones, contratos y hashes son **datos de ejemplo con formato Stellar** (no son cuentas reales: un enlace a stellar.expert mostrará "no encontrado").
- No hay puerta en producción: `vercel.json`, `.env.example` y el CI no definen la variable. El test `t22` lo verifica.
- Los cambios de producción están acotados con `DEMO_ENABLED` (constante de build); con la variable apagada el comportamiento es idéntico al anterior.

## Activar

```bash
npm ci
npm run demo:build      # EXPO_PUBLIC_DEMO_MODE=1 expo export -p web --clear  ->  dist-demo/
npm run demo:serve      # http://localhost:8081  (misma lógica de rewrites que vercel.json)
```

Para desarrollo con recarga: `EXPO_PUBLIC_DEMO_MODE=1 npx expo start --web --clear`.

> Usa siempre `--clear` al alternar entre build normal y demo: Metro cachea el valor inlineado de `EXPO_PUBLIC_*`. `demo:build` ya lo incluye.

### Parámetros de URL

| Parámetro | Efecto |
|---|---|
| `?badge=0` | Oculta el distintivo "Modo demo · testnet" (`?badge=1` lo vuelve a mostrar). Se recuerda en la pestaña. |
| `?role=seller` / `?role=buyer` | Fija la vista (vendedor Valeria / comprador Diego). |
| `?demo_reset=1` | Borra el estado demo (pedidos, PIN, etc.). |

El distintivo trae un selector **Vendedor / Comprador**: al cambiar, va a *Mis pedidos* (vendedor) o al último link `/p/[slug]` (comprador). El botón "Ver como comprador" también cambia a la vista comprador.

## Flujo (los 5 pasos)

1. **Vendedor crea el link**: Inicio → *Vender* → asistente normal → *Crear link de venta*. Slugs deterministas: `demo01`, `demo02`…
2. **Comprador paga**: `/p/demo01` → *Pagar en custodia* → *Ya pagué*. Escrow fondeado y **PIN visible una sola vez** (`482915`, fijo para que el guion pueda ingresarlo; aparece solo en la hoja del comprador).
3. **Vendedor toca "Ya lo envié"**: *Pedidos* → pedido → (foto o número de guía opcionales) → *Ya lo envié*. El comprador ve su código de entrega recién ahí.
4. **Vendedor cobra**: ingresa el PIN → *Confirmar PIN y cobrar* → pago liberado (el saldo de prueba del vendedor sube; PIN incorrecto da error).
5. **Disputa abierta**: el comprador pulsa *Tengo un problema* en un pedido fondeado/enviado → *En disputa*.

Cada acción valida el rol (p. ej. cobrar con el PIN solo en vista vendedor; pagar/disputar solo en vista comprador).

### Qué se oculta/neutraliza solo en demo

- Ya no hay textos neutralizados solo para demo: los textos de IMEI y de disputas son veraces (declarados por el vendedor, sin verificación; disputas resueltas manualmente) y son iguales en producción y en demo.

## Grabar con Playwright

```bash
npx playwright install chromium         # una vez
npm run demo:build && npm run demo:serve &
DEMO_BADGE=0 DEMO_PACE=1.3 DEMO_VIDEO_DIR=./demo-videos DEMO_SHOTS_DIR=./demo-videos/shots npm run demo:record
```

`scripts/demo/record.ts` usa viewport **1280×720**, pausas largas pensadas para video (multiplícalas con `DEMO_PACE`), y falla si la app intenta llamar a `/api/*`. Variables: `DEMO_URL`, `DEMO_BADGE=0`, `DEMO_PACE`, `DEMO_VIDEO_DIR` (graba `.webm`), `DEMO_SHOTS_DIR` (una captura por paso), `DEMO_HEADED=1`. En vivo (sin guion) basta abrir la URL con `?badge=0`.

El guion usa `window.__meteoritoDemo` (`setRole`, `seed('creado'|'fondeado'|'enviado')`, `reset`, `DEMO_PIN`), que **solo existe con el modo demo activo**. `seed('enviado')` crea un pedido ya enviado para grabar la disputa sin repetir el asistente.

## Tests

`npm run test:ci` incluye `t22` (apagado por defecto, host de producción bloqueado, flujo completo con `fetch` prohibido, Supabase bloqueado, PIN incorrecto rechazado, textos neutralizados).

## Limitaciones

- El estado es por pestaña (`sessionStorage`); cerrar la pestaña lo borra. Recargar lo conserva.
- Enlaces a stellar.expert: formato real, pero los hashes/contratos no existen en la red.
- Fotos del asistente: se guardan locales como data URL (máx. 4, ~300 KB c/u).
- No se simulan pantallas de cuenta/recuperación de Cavos ni el flujo de activación de wallet (aparece siempre "lista").
- Solo web; no hay build nativo demo.
