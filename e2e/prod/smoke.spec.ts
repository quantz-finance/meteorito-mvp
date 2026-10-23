// PROD-* — smoke de producción. Ver docs/TESTING.md.
import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { expectNoScroll, BANNED } from '../helpers';

const PRODUCT = process.env.PROD_PRODUCT ?? 'e1ldky';      // producto permanente de prueba (listing activo)
const STORE = process.env.PROD_STORE ?? 'bobbyaliensshop'; // tienda pública existente
/** Llave de invitado FIJA para marcar los pedidos de prueba E2E (sin campo de nombre de comprador). */
export const E2E_GUEST_KEY = createHash('sha256').update('meteorito-e2e-prod-smoke').digest('hex');
const LOG = process.env.PROD_ORDERS_LOG ?? 'e2e-prod-orders.txt';

/** URL y anon key públicas de Supabase, tomadas del bundle de la app (son públicas; no se guardan en el repo). */
async function supabasePublic(page: Page): Promise<{ url: string; anon: string }> {
  const html = await (await page.request.get('/')).text();
  const srcs = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
  for (const s of srcs) {
    const js = await (await page.request.get(s)).text();
    const url = js.match(/https:\/\/[a-z0-9]{20}\.supabase\.co/)?.[0];
    const anon = js.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0] ?? js.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)?.find((t) => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).role === 'anon'; } catch { return false; } });
    if (url && anon) return { url, anon };
  }
  throw new Error('no encontré la config pública de Supabase en el bundle');
}

test.describe('Producción: solo lectura', () => {
  test('PROD-01 /api/health ok', async ({ request }) => {
    const r = await request.get('/api/health');
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.config?.walletActivation?.platformMatches).toBe(true);
  });

  test('PROD-02 splash → bienvenida sin scroll ni palabras prohibidas', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/Meteorito/).first()).toBeVisible();
    await page.waitForTimeout(2500);
    await expectNoScroll(page);
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(BANNED);
    expect(text).not.toMatch(/testnet|saldo|balance|USDC|billetera/i);
  });

  test(`PROD-03 página pública /p/${PRODUCT} del comprador`, async ({ page }) => {
    await page.goto(`/p/${PRODUCT}`);
    await expect(page.getByText('Disponible').first()).toBeVisible();
    await expect(page.getByText(/Pagar en custodia/).last()).toBeVisible();
    await expectNoScroll(page);
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(BANNED);
    expect(text).not.toMatch(/testnet|saldo|USDC|billetera/i);
  });

  test(`PROD-04 tienda pública /t/${STORE}`, async ({ page }) => {
    await page.goto(`/t/${STORE}`);
    await expect(page.getByText(/₡/).first()).toBeVisible();
    await expectNoScroll(page);
    expect(await page.locator('body').innerText()).not.toMatch(BANNED);
  });

  test('PROD-05 seller_orders por RPC con anon key → denegado', async ({ page }) => {
    const { url, anon } = await supabasePublic(page);
    for (const fn of ['seller_orders', 'seller_orders_v2']) {
      const r = await page.request.post(`${url}/rest/v1/rpc/${fn}`, { headers: { apikey: anon, Authorization: `Bearer ${anon}` }, data: { p_seller_address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } });
      expect(r.status(), `${fn} debe rechazar anon`).toBeGreaterThanOrEqual(401);
      expect(r.status()).toBeLessThan(500);
    }
  });

  test('PROD-06 /api/store orders sin token → 401', async ({ request }) => {
    const r = await request.post('/api/store', { data: { action: 'orders' } });
    expect(r.status()).toBe(401);
  });
});

test.describe('Producción: compra de invitado (testnet, SINPE simulado)', () => {
  test.skip(process.env.PROD_BUY !== '1', 'PROD_BUY=1 para crear un pedido de prueba (SINPE simulado en testnet)');

  test(`PROD-07 invitado paga ${PRODUCT} con "Ya pagué" y recibe su PIN`, async ({ page }) => {
    await page.addInitScript((k) => localStorage.setItem('meteorito:guest:v1', k), E2E_GUEST_KEY);
    await page.goto(`/p/${PRODUCT}`);
    await page.getByText(/Pagar en custodia/).last().click();
    await expect(page.getByText('Paga por SINPE Móvil')).toBeVisible({ timeout: 90_000 });
    const child = page.url().match(/\/p\/([a-z0-9]+)/)![1];
    expect(child).not.toBe(PRODUCT);
    mkdirSync(dirname(LOG) || '.', { recursive: true });
    appendFileSync(LOG, `${new Date().toISOString()} E2E-PROD guestKey=sha256(meteorito-e2e-prod-smoke) product=${PRODUCT} order=${child} step=start\n`);
    await page.getByText('Ya pagué', { exact: true }).click();
    await expect(page.getByText(/^\d{6}$/).first()).toBeVisible({ timeout: 120_000 });
    appendFileSync(LOG, `${new Date().toISOString()} E2E-PROD product=${PRODUCT} order=${child} step=fondeado\n`);
    const pub = await (await page.request.get(`/p/${child}`)).status();
    expect(pub).toBe(200);
  });
});
