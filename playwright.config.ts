// E2E de la app web (build en modo demo: sin Cavos real, sin backend, sin dinero). Ver docs/TESTING.md.
// Uso: npm run test:e2e   (construye dist-demo si falta y lo sirve en :8083)
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 8083);
export default defineConfig({
  testDir: 'e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${PORT}`, locale: 'es-CR', timezoneId: 'America/Costa_Rica', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: `node scripts/demo/serve.mjs dist-demo ${PORT}`, url: `http://localhost:${PORT}`, reuseExistingServer: !process.env.CI, timeout: 30_000 },
  projects: [
    // Contrato del API: handlers reales en proceso con base falsa (sin red, sin navegador).
    { name: 'api', testMatch: /api-.*\.spec\.ts/ },
    { name: 'webkit-iphone-se', testIgnore: /api-.*\.spec\.ts/, use: { ...devices['iPhone SE (3rd gen)'] } },                       // 375×667
    { name: 'webkit-iphone-13', testIgnore: /api-.*\.spec\.ts/, use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } }, // PWA a pantalla completa
    { name: 'chromium', testIgnore: /api-.*\.spec\.ts/, use: { ...devices['Pixel 7'] } },
  ],
});
