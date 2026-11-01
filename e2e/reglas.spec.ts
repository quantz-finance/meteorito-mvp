// Reglas con texto legal (lib/rules.ts LEGAL_RULES), lado de quien vende (demo): acuerdo de la beta ANTES de publicar
// y plazo de envío de la regla v1 (aviso del día 2, texto exacto). El lado de quien compra: e2e/mock-guest.spec.ts (MCK-REG-*).
// Capturas: REGLAS_SHOTS=/workspace/out -> reglas-*.png (solo iPhone SE).
import { test, expect, type Page } from '@playwright/test';
import { open, seed, takePhoto, openSellerRow, BANNED } from './helpers';
import { SHIP_REFUND_RULE } from '../lib/rules';

const SHOTS = process.env.REGLAS_SHOTS;
const shot = async (page: Page, name: string) => { if (SHOTS && test.info().project.name === 'webkit-iphone-se') { await page.waitForTimeout(400); await page.screenshot({ path: `${SHOTS}/reglas-${name}.png` }); } };
const KEY = 'meteorito:demo:v1';
const D = 86_400_000;
/** Mueve el pago al pasado (reloj real de la UI) y recarga. */
async function paidAgo(page: Page, slug: string, ms: number) {
  await page.evaluate(([k, s, at]) => { const st = JSON.parse(sessionStorage.getItem(k as string) || '{}'); st.orders[s as string].funded_at = new Date(Date.now() - (at as number)).toISOString(); sessionStorage.setItem(k as string, JSON.stringify(st)); }, [KEY, slug, ms] as const);
}
const seedV1 = (page: Page) => page.evaluate(() => (window as any).__meteoritoDemo.seed('fondeado', { title: 'Bici de montaña', price_crc: 150000, rules: 1 }));

test('RGL-01 primera publicación: "Antes de publicar" con la regla exacta; al aceptar se crea el link con la versión', async ({ page }) => {
  await open(page, '/vender', 'seller', true, { rulesAck: false });
  await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('Bici de montaña');
  await page.getByPlaceholder('0').fill('150000');
  await takePhoto(page);
  await page.waitForTimeout(400);
  await page.getByText('Generar link').click();
  await expect(page.getByText('Antes de publicar')).toBeVisible();
  const rule = page.getByTestId('legal-rule-reembolso_sin_envio');
  await expect(rule.getByText(SHIP_REFUND_RULE, { exact: true })).toBeVisible();
  await expect(page.getByText('¡Tu link está listo!')).toHaveCount(0); // no publica sin aceptar
  expect(BANNED.test(await rule.innerText())).toBe(false);
  await shot(page, 'vendedor-acuerdo');
  await page.getByTestId('rules-accept').click();
  await expect(page.getByText('¡Tu link está listo!')).toBeVisible();
  const st = await page.evaluate((k) => JSON.parse(sessionStorage.getItem(k) || '{}'), KEY);
  const o: any = Object.values(st.orders).pop();
  expect(o.rules_version).toBe(1);
  // Segunda publicación: ya aceptada (misma versión) -> no vuelve a preguntar
  expect(await page.evaluate(() => localStorage.getItem('meteorito:reglas-vendedor'))).toBe('1');
});

test('RGL-02 quien vende: plazo de 3 días; el día 2 ve "Te queda 1 día para marcar \'Ya lo envié\'"', async ({ page }) => {
  await open(page, '/', 'seller', true);
  const slug = await seedV1(page);
  await openSellerRow(page, /Envíalo/, /Ya lo envié/);
  await expect(page.getByTestId('ship-rule-seller')).toContainText(/Tienes hasta el .+ para marcar 'Ya lo envié'\./);
  await paidAgo(page, slug, 2 * D + 3_600_000);
  await openSellerRow(page, /Envíalo/, /Ya lo envié/);
  await expect(page.getByTestId('ship-rule-seller')).toContainText("Te queda 1 día para marcar 'Ya lo envié'");
  await shot(page, 'vendedor-aviso-dia2');
  await paidAgo(page, slug, 3 * D + 3_600_000);
  await openSellerRow(page, /Envíalo/, /Ya lo envié/);
  await expect(page.getByTestId('ship-rule-seller')).toContainText('quien compra puede cancelar');
});

test('RGL-03 pedidos anteriores a las reglas (sin versión): sin plazo nuevo', async ({ page }) => {
  await open(page, '/', 'seller', true);
  const slug = await seed(page, 'fondeado');
  await paidAgo(page, slug, 4 * D);
  await openSellerRow(page, /Envíalo/, /Ya lo envié/);
  await expect(page.getByTestId('ship-rule-seller')).toHaveCount(0);
});
