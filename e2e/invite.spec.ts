import { test, expect } from '@playwright/test';
import { open, expectNoScroll, expectInputs16 } from './helpers';

// El demo no simula /api/invites (el flujo completo crear -> aceptar -> pagar reservado está en api-contract.spec.ts y t27).
test.describe('Invitación (UI)', () => {
  test('INV-01 /i/nueva: sin cuenta, formulario corto, sin scroll, inputs ≥16 px', async ({ page }) => {
    await open(page, '/i/nueva', 'buyer', true);
    await expect(page.getByText('Invitar a un vendedor')).toBeVisible();
    await expect(page.getByText(/No necesitas cuenta/)).toBeVisible();
    await expectNoScroll(page);
    await expectInputs16(page);
  });
  test('INV-02 /i/nueva vacío: no crea nada y pide los datos', async ({ page }) => {
    await open(page, '/i/nueva', 'buyer', true);
    await page.getByRole('button', { name: /Crear invitación/ }).click();
    await expect(page.getByText(/nombre|precio|Escribe/i).first()).toBeVisible();
    await expect(page.getByText(/no están disponibles en el modo demo/)).toHaveCount(0);
  });
  test('INV-03 /i/nueva lleno en demo: avisa que no está disponible (no falla en silencio)', async ({ page }) => {
    await open(page, '/i/nueva', 'buyer', true);
    await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('iPhone 13');
    await page.getByPlaceholder('250 000').fill('250000');
    await page.getByRole('button', { name: /Crear invitación/ }).click();
    await expect(page.getByText(/no están disponibles en el modo demo/)).toBeVisible();
  });
  test('INV-04 /i/<código inexistente>: mensaje claro con salida', async ({ page }) => {
    await open(page, '/i/abcd1234', 'seller', true);
    await expect(page.getByText('Esta invitación no existe')).toBeVisible();
    await expect(page.getByText('Volver')).toBeVisible();
  });
});
