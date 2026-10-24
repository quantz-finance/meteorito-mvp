// "Cómo funciona": accesos visibles en el pago (antes de pagar), Vender y Home; llevan a /como-funciona.
import { test, expect } from '@playwright/test';
import { open, seed, expectNoScroll } from './helpers';

test('RUL-01 resumen en el pago antes de pagar -> Ver reglas; después de pagar ya no aparece', async ({ page }) => {
  await open(page, '/', 'seller', true);
  const slug = await seed(page, 'creado');
  await open(page, `/p/${slug}`, 'buyer');
  await expect(page.getByText('Tu dinero queda en custodia hasta que recibas tu compra.', { exact: false })).toBeVisible();
  await page.getByTestId('rules-hint').click();
  await expect(page).toHaveURL(/\/como-funciona/);
  await expect(page.getByText('1. Pago en custodia')).toBeVisible();
  const paid = await seed(page, 'fondeado', 'Consola');
  await open(page, `/p/${paid}`, 'buyer');
  await expect(page.getByText('Estado de tu pago')).toBeVisible();
  await expect(page.getByTestId('rules-hint')).toHaveCount(0);
});

test('RUL-02 Vender y Home: enlace a las reglas sin scroll', async ({ page }) => {
  await open(page, '/vender', 'seller', true);
  await expect(page.getByTestId('rules-hint')).toBeVisible();
  await expectNoScroll(page);
  await open(page, '/pedidos', 'seller');
  await expect(page.getByTestId('rules-link')).toBeVisible();
  await expectNoScroll(page);
  await page.getByTestId('rules-link').click();
  await expect(page).toHaveURL(/\/como-funciona/);
});
