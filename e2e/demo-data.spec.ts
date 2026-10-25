// Interruptor "Datos de ejemplo" (032): solo el admin maestro lo ve, en Mi cuenta (demo: admin simulado con ?admin=1;
// en producción el rol lo decide el servidor). Apagado: Comprar sin ventas de ejemplo. Accesible (role switch). iPhone SE.
import { test, expect } from '@playwright/test';
import { open } from './helpers';

test.describe('Datos de ejemplo', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'webkit-iphone-se', 'solo iPhone SE'));

  test('DATA-01 admin: interruptor en Mi cuenta; apagarlo quita las ventas de ejemplo del feed; otro usuario no lo ve', async ({ page }) => {
    await open(page, '/comprar', 'buyer', true);
    await expect(page.getByTestId('feed-sale').first()).toBeAttached(); // demo de siempre: encendido
    await open(page, '/pedidos?admin=1', 'seller');
    await page.getByRole('button', { name: 'Mi cuenta' }).click();
    const sw = page.getByRole('switch', { name: 'Datos de ejemplo' });
    await expect(sw).toBeVisible();
    await expect(sw).toBeChecked();
    const box = (await page.getByTestId('demo-data').boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.getByTestId('demo-data').scrollIntoViewIfNeeded();
    if (process.env.SHOT_SWITCH) await page.screenshot({ path: process.env.SHOT_SWITCH });
    await sw.click();
    await expect(sw).not.toBeChecked();
    await open(page, '/comprar', 'buyer');
    await expect(page.getByTestId('feed-card').first()).toBeVisible();
    await expect(page.getByTestId('feed-sale')).toHaveCount(0);
    // Otro usuario (no admin): no hay interruptor.
    await open(page, '/pedidos?admin=0', 'seller');
    await page.getByRole('button', { name: 'Mi cuenta' }).click();
    await expect(page.getByText('Cerrar sesión')).toBeVisible();
    await expect(page.getByTestId('demo-data')).toHaveCount(0);
    await expect(page.getByText('Datos de ejemplo')).toHaveCount(0);
  });
});
