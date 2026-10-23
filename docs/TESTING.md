# Testing en Meteorito (flujo TDD)

Regla: **ningún bug se arregla sin un test que primero falle**. Ningún feature se mergea sin su test.

## Las tres capas

| Capa | Comando | Qué cubre | Red / secretos |
|---|---|---|---|
| Unit + handlers | `TESTNET=skip npm run test:ci` | Lógica pura y handlers reales de `api/*` con base falsa (`scripts/ci/fakedb.ts`) y JWT de prueba (`scripts/ci/jwt.ts`) | No |
| On-chain | `npm run test:ci` (con `.ci-secrets.env` o secretos de GitHub) | Escrow real en Stellar **testnet** (fondeo, release, disputa, montos) | Testnet. Se salta con `TESTNET=skip` |
| E2E (Playwright) | `npm run test:e2e` | La app web real (build en modo demo) en WebKit iPhone SE (375×667), WebKit iPhone 13 (390×844) y Chromium (Pixel 7), más el contrato del API | No |

Atajos:
- `npm run test:e2e:fast`: corre Playwright sin reconstruir `dist-demo` (úsalo solo si no cambiaste la app).
- `npm run test:all`: typecheck + check:cjs + unit + E2E. Córrelo antes de abrir un PR.
- `npx playwright test --project=webkit-iphone-se -g "ESC-01"`: un caso en un perfil.
- `npx playwright show-report`: reporte HTML con traza y captura de cada falla.

En CI: `.github/workflows/ci.yml` (typecheck, export web, check:cjs, unit + testnet) y `.github/workflows/e2e.yml` (Playwright, sin secretos).

## Estructura E2E (`e2e/`)

- `helpers.ts`: `open(page, ruta, rol, reset)`, `seed(page, estado)` (crea un pedido de ejemplo con el API simulado del demo), `orderStatus`, y las reglas de layout: `expectNoScroll`, `expectInputs16`, `expectTitleAt16`, más regex de palabras prohibidas y voseo.
- `seller.spec.ts` (VEN-*): crear link, validaciones, tienda pública, IBAN mod-97 + SINPE.
- `buyer-escrow.spec.ts` (COM-*, ESC-*, DIS-*): comprador sin cuenta, "Ya pagué", recarga a mitad del pago, ciclo completo con PIN, PIN incorrecto, confirmación del comprador, disputa.
- `invite.spec.ts` (INV-*): `/i/nueva` y `/i/<código>`.
- `layout.spec.ts` (LAY-*): sin scroll, inputs ≥16 px, título en 16,16, título fijo entre pestañas, copy permitido (sin saldo/wallet, sin "de prueba").
- `api-contract.spec.ts` (API-*): proyecto `api`, sin navegador. Handlers reales: 401 sin sesión, 405, ownership, invitado por `X-Guest-Key`, PIN bloqueado, cron, invitaciones, productos permanentes.

Los IDs (VEN-01, ESC-01…) son los mismos del plan de pruebas (página "Plan de pruebas"): al agregar un caso, usa el siguiente ID y márcalo ahí.

### Modo demo (cómo el E2E evita Cavos y la red)
`npm run demo:build` exporta la web con `EXPO_PUBLIC_DEMO_MODE=1` a `dist-demo/`. En ese modo no hay login real ni llamadas al backend: `lib/demo.ts` simula los endpoints con la misma forma de respuesta y guarda el estado en `sessionStorage`. Parámetros de URL: `role=seller|buyer`, `demo_reset=1`, `badge=0`. `window.__meteoritoDemo.seed('creado'|'fondeado'|'enviado')` deja un pedido en ese estado.
**El demo no cubre**: invitaciones, productos permanentes, push, passkeys ni el SINPE real. Eso se prueba en `api-contract.spec.ts`, en `scripts/ci/t27`, `t38` y `t41`, y a mano en iPhone (ver el plan).

## El ciclo TDD

1. **Reproduce.** Escribe el caso más chico que muestre el bug:
   - lógica o API: `scripts/ci/tNN-<tema>.test.ts`, registrado en `scripts/ci/run.ts` (patrón: `t.check('qué debe pasar', condición, detalle)`);
   - pantalla o flujo: un `test()` en el spec de su área en `e2e/`.
2. **Míralo fallar** (`TESTNET=skip npm run test:ci` o `npx playwright test -g <ID>`). Si no falla, el test no reproduce el bug.
3. **Arregla lo mínimo** hasta que pase.
4. **Corre todo** (`npm run test:all`).
5. **PR enfocado**: un bug o tema por PR, con el test en el mismo commit. Se mergea con el check de Vercel en verde.

### Reglas que los tests vigilan (no las rompas)
- Funciones de Vercel: máximo 12; nunca `import('./relativo')` dinámico en `api/` (no se empaqueta y da 500). Lo vigilan `npm run check:cjs` y t40.
- Lógica que importa `react-native` no carga en Node: pon la lógica pura en un módulo aparte (ej. `lib/viewportCore.ts`, `lib/status.ts`) y pruébala ahí.
- Copy: tuteo (t31), sin "seguro/protegido/garantía/garantizado/pronto/regulado" (t29 y LAY-*), nunca saldo ni wallet (LAY-*).
- Layout: sin scroll en 375×667 y 390×844, inputs ≥16 px, títulos en 16,16 (LAY-*, t39).
- Migraciones: solo aditivas; nunca `DROP TABLE` ni `DROP COLUMN` (t41 lo revisa en la 013).

### Datos y dinero
- Nunca uses producción para tests automáticos. El E2E corre contra `dist-demo` local; los handlers, contra `fakeDb`.
- On-chain solo en **testnet**, con wallets de CI dedicadas (`.ci-secrets.env`, gitignored).
