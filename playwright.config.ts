// E2E de la app web. Ver docs/TESTING.md.
// - Proyectos de dispositivo (webkit-iphone-se, webkit-iphone-13, chromium): build en MODO DEMO (dist-demo, :8083),
//   flujos completos sin Cavos ni backend (lib/demo.ts simula el API igual que producción).
// - Proyectos mock-* : build REAL (dist-e2e, :8084) con backend simulado (scripts/e2e/mock-server.mjs): push con
//   PushManager simulado, service worker, sin red, doble toque, botón atrás, errores del API.
// - api: handlers reales de api/* en proceso (sin navegador).
// Producción (solo lectura + compra de prueba en testnet): playwright.prod.config.ts (npm run test:e2e:prod).
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 8083);
const MOCK_PORT = 8084;
const DEVICE_IGNORE = [/api-.*\.spec\.ts/, /mock-.*\.spec\.ts/, /prod\/.*/];
export default defineConfig({
  testDir: 'e2e',
  testIgnore: [/prod\/.*/],
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${PORT}`, locale: 'es-CR', timezoneId: 'America/Costa_Rica', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    { command: `node scripts/demo/serve.mjs dist-demo ${PORT}`, url: `http://localhost:${PORT}`, reuseExistingServer: !process.env.CI, timeout: 30_000 },
    { command: `node scripts/e2e/mock-server.mjs dist-e2e ${MOCK_PORT}`, url: `http://localhost:${MOCK_PORT}/api/health`, reuseExistingServer: !process.env.CI, timeout: 30_000 },
  ],
  projects: [
    { name: 'api', testMatch: /api-.*\.spec\.ts/ },
    { name: 'webkit-iphone-se', testIgnore: DEVICE_IGNORE, use: { ...devices['iPhone SE (3rd gen)'] } }, // 375×667
    { name: 'webkit-iphone-13', testIgnore: DEVICE_IGNORE, use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } }, // PWA a pantalla completa
    { name: 'chromium', testIgnore: DEVICE_IGNORE, use: { ...devices['Pixel 7'] } },
    // El backend simulado guarda estado: un solo worker por proyecto mock, en serie.
    { name: 'mock-iphone-se', testMatch: /mock-.*\.spec\.ts/, fullyParallel: false, use: { ...devices['iPhone SE (3rd gen)'], baseURL: `http://localhost:${MOCK_PORT}` } },
    { name: 'mock-chromium', testMatch: /mock-.*\.spec\.ts/, fullyParallel: false, dependencies: ['mock-iphone-se'], use: { ...devices['Pixel 7'], baseURL: `http://localhost:${MOCK_PORT}` } },
  ],
});
