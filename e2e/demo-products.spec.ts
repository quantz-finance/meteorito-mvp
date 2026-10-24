// Productos de EJEMPLO en Comprar (FEED_DEMO_PRODUCTS): etiqueta "Ejemplo", los dos filtros con contenido, buscar
// "iPhone", tienda de ejemplo /t/<demo> y ficha /p/ej-… con el pago desactivado. Demo con ?ejemplos=1 (en producción
// los sirve el API). Rápido: solo iPhone SE.
import { test, expect } from '@playwright/test';
import { open, VOSEO } from './helpers';

test.describe('Comprar: productos de ejemplo', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'webkit-iphone-se', 'solo iPhone SE'));

  test('DEMO-01 feed con "Ejemplo", Sin confirmar, buscar iPhone, tienda y producto sin pago', async ({ page }) => {
    await open(page, '/comprar?ejemplos=1', 'buyer', true);
    await expect(page.getByTestId('feed-card').first()).toBeVisible();
    // Buscar "iPhone": aparecen iPhones de ejemplo (con etiqueta) en Identidad confirmada.
    const search = page.getByLabel('Buscar productos');
    await search.fill('iPhone');
    await expect(page.getByText('Resultados')).toBeVisible();
    await expect(page.getByTestId('feed-demo-tag').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /^Ejemplo\. iPhone/ }).first()).toBeAttached();
    // Sin confirmar también tiene ejemplos.
    await page.getByRole('tab', { name: 'Sin confirmar' }).click();
    await expect(page.getByRole('tab', { name: 'Sin confirmar' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('link', { name: /^Ejemplo\. iPhone/ }).first()).toBeAttached();
    await page.getByRole('button', { name: 'Limpiar búsqueda' }).first().click();
    await expect(page.getByTestId('feed-demo-tag').first()).toBeAttached();

    // Tienda de ejemplo.
    await page.goto('/t/tecno-sabana?role=buyer&badge=0');
    await expect(page.getByRole('heading', { name: 'Tecno Sabana' })).toBeVisible();
    await expect(page.getByTestId('store-demo-tag')).toBeVisible();
    await expect(page.getByTestId('store-demo-note')).toBeVisible();
    await expect(page.getByTestId('store-chat')).toHaveCount(0);

    // Producto de ejemplo: aviso y pago desactivado (sin PayBox).
    await page.goto('/p/ej-iphone-13?role=buyer&badge=0');
    await expect(page.getByTestId('demo-product-notice')).toBeVisible();
    await expect(page.getByText(/no se puede pagar/).first()).toBeVisible();
    const pay = page.getByTestId('demo-pay-disabled');
    await expect(pay).toBeVisible();
    await expect(pay).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Pagar/ })).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toMatch(VOSEO);
    await page.getByTestId('demo-product-seller').click();
    await expect(page).toHaveURL(/\/t\/tecno-sabana/);
  });
});
