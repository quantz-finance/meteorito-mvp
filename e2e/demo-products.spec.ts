// Productos de EJEMPLO en Comprar (FEED_DEMO_PRODUCTS): señal SUTIL (un iconito discreto que abre un popup), sin
// etiquetas "Ejemplo" ni avisos grandes; los dos filtros con contenido, buscar "iPhone", tienda de ejemplo /t/<demo> y
// ficha /p/ej-… con el pago desactivado. Demo con ?ejemplos=1 (en producción los sirve el API). Rápido: solo iPhone SE.
import { test, expect, type Page } from '@playwright/test';
import { open, searchFeed, VOSEO } from './helpers';

const BODY = 'Lo pusimos para mostrarte cómo se ve el feed. No está a la venta.';

/** El popup se abre, entra completo en la pantalla (sin scroll) y "Entendido" lo cierra. */
async function popupWorks(page: Page) {
  const pop = page.getByTestId('demo-info-popup');
  await expect(pop).toBeVisible();
  await expect(pop.getByText('Producto de ejemplo')).toBeVisible();
  await expect(pop.getByText(BODY)).toBeVisible();
  const vp = page.viewportSize()!;
  const b = (await pop.boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.y + b.height).toBeLessThanOrEqual(vp.height);
  expect(b.width).toBeLessThanOrEqual(vp.width);
  await pop.getByRole('button', { name: 'Entendido' }).click();
  await expect(pop).toHaveCount(0);
}

test.describe('Comprar: productos de ejemplo', () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'webkit-iphone-se', 'solo iPhone SE'));

  test('DEMO-01 feed con iconito discreto + popup, Sin confirmar, buscar iPhone, tienda y producto sin pago', async ({ page }) => {
    await open(page, '/comprar?ejemplos=1', 'buyer', true);
    await expect(page.getByTestId('feed-card').first()).toBeVisible();
    // Buscar "iPhone": aparecen iPhones de ejemplo en Identidad confirmada, con el iconito y SIN etiqueta "Ejemplo".
    await searchFeed(page, 'iPhone');
    await expect(page.getByText('Resultados')).toBeVisible();
    const card = page.getByTestId('feed-card').filter({ has: page.getByTestId('demo-info') }).first();
    await expect(card).toBeVisible();
    await expect(card).not.toContainText('Ejemplo');
    await expect(page.getByRole('link', { name: /^Ejemplo\. iPhone/ }).first()).toBeAttached(); // lector de pantalla
    // El icono es chico y discreto: esquina de la foto, no la tapa.
    const icon = card.getByTestId('demo-info');
    await expect(icon).toHaveAttribute('aria-label', 'Producto de ejemplo');
    const ib = (await icon.boundingBox())!; const cb = (await card.boundingBox())!;
    expect(ib.width).toBeLessThanOrEqual(28);
    expect(ib.height).toBeLessThanOrEqual(28);
    expect(ib.width * ib.height).toBeLessThan(cb.width * cb.width * 0.05);
    // Tocar el icono abre el popup y NO navega al producto.
    await icon.click();
    await popupWorks(page);
    await expect(page).toHaveURL(/\/comprar/);
    // Sin confirmar también tiene ejemplos.
    await page.getByRole('tab', { name: 'Sin confirmar' }).click();
    await expect(page.getByRole('tab', { name: 'Sin confirmar' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('link', { name: /^Ejemplo\. iPhone/ }).first()).toBeAttached();
    await page.getByRole('button', { name: 'Limpiar búsqueda' }).first().click();
    await expect(page.getByTestId('demo-info').first()).toBeAttached();
    await expect(page.getByTestId('feed-demo-tag')).toHaveCount(0);

    // Tienda de ejemplo: el iconito junto al nombre, sin etiqueta ni nota grande.
    await page.goto('/t/tecno-sabana?role=buyer&badge=0');
    await expect(page.getByRole('heading', { name: 'Tecno Sabana' })).toBeVisible();
    await expect(page.getByTestId('store-demo-tag')).toHaveCount(0);
    await expect(page.getByTestId('store-demo-note')).toHaveCount(0);
    await expect(page.getByTestId('store-chat')).toHaveCount(0);
    await page.getByTestId('demo-info').first().click();
    await expect(page.getByTestId('demo-info-popup')).toBeVisible();
    await page.getByTestId('demo-info-popup').getByRole('button', { name: 'Entendido' }).click();
    await expect(page).toHaveURL(/\/t\/tecno-sabana/);

    // Producto de ejemplo: iconito + pago desactivado sereno (sin aviso grande ni PayBox).
    await page.goto('/p/ej-iphone-13?role=buyer&badge=0');
    await expect(page.getByTestId('demo-product-photo')).toBeVisible();
    await expect(page.getByTestId('demo-product-notice')).toHaveCount(0);
    await page.getByTestId('demo-info').first().click();
    await popupWorks(page);
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
