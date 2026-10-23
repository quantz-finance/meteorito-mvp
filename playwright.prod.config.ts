// Smoke E2E contra PRODUCCIÓN (https://pago.meteorito.app). `npm run test:e2e:prod`.
// Solo lectura, salvo la compra de invitado (PROD_BUY=1): SINPE simulado "Ya pagué" en testnet, sin dinero real.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/prod',
  timeout: 150_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.PROD_URL ?? 'https://pago.meteorito.app', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'prod-iphone-se', use: { ...devices['iPhone SE'] } }],
});
