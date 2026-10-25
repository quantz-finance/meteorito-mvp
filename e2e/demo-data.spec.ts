// "Modo de la app" en Mi cuenta (cualquier cuenta, cada dispositivo): Datos de ejemplo / Testnet / Mainnet (Próximamente,
// desactivado). Testnet = solo reales (sin ventas de ejemplo en Comprar). Radios accesibles, cabe en iPhone SE. Demo
// (en el build de demo arranca en Datos de ejemplo; en producción el default es Testnet).
import { test, expect } from '@playwright/test';
import { open } from './helpers';

test.describe('Modo de la app', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'webkit-iphone-se', 'solo iPhone SE'));

  test('MODO-01 Mi cuenta: 3 modos (Mainnet desactivado); Testnet quita los ejemplos solo en este dispositivo', async ({ page, browser }) => {
    await open(page, '/comprar', 'buyer', true);
    await expect(page.getByTestId('feed-sale').first()).toBeAttached(); // demo: Datos de ejemplo
    await open(page, '/pedidos', 'seller');
    await page.getByRole('button', { name: 'Mi cuenta' }).click();
    const group = page.getByRole('radiogroup', { name: 'Modo de la app' });
    await expect(group).toBeVisible();
    const ej = group.getByRole('radio', { name: 'Datos de ejemplo' });
    const tn = group.getByRole('radio', { name: 'Testnet' });
    const mn = group.getByRole('radio', { name: /^Mainnet/ });
    await expect(ej).toHaveAttribute('aria-checked', 'true');
    await expect(mn).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Próximamente')).toBeVisible();
    await mn.click({ force: true }); // desactivado: no cambia nada
    await expect(mn).toHaveAttribute('aria-checked', 'false');
    await expect(ej).toHaveAttribute('aria-checked', 'true');
    await tn.click();
    await expect(tn).toHaveAttribute('aria-checked', 'true');
    await expect(ej).toHaveAttribute('aria-checked', 'false');
    const box = (await page.getByTestId('app-mode').boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.getByTestId('app-mode').scrollIntoViewIfNeeded();
    if (process.env.SHOT_SWITCH) await page.screenshot({ path: process.env.SHOT_SWITCH });
    await open(page, '/comprar', 'buyer');
    await expect(page.getByTestId('feed-card').first()).toBeVisible();
    await expect(page.getByTestId('feed-sale')).toHaveCount(0);
    // Otro dispositivo: su propio modo (no lo afecta el de arriba).
    const other = await browser.newContext({ ...test.info().project.use, baseURL: test.info().project.use.baseURL });
    const p2 = await other.newPage();
    await open(p2, '/comprar', 'buyer', true);
    await expect(p2.getByTestId('feed-sale').first()).toBeAttached();
    await other.close();
  });
});
