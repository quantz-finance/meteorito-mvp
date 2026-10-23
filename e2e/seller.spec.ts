import { test, expect } from '@playwright/test';
import { open, PHOTO, expectNoScroll } from './helpers';

test.describe('Vendedor (demo)', () => {
  test('VEN-01 crea un link con título, precio y foto', async ({ page }) => {
    await open(page, '/vender', 'seller', true);
    await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('Bici de montaña');
    await page.getByPlaceholder('0').fill('150000');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('Agregar', { exact: true }).click()]);
    await fc.setFiles(PHOTO);
    await expect(page.getByText('FOTOS (1/4)', { exact: false })).toBeVisible();
    await page.getByText('Generar link').click();
    await expect(page.getByText('¡Tu link está listo!')).toBeVisible();
    await expect(page.getByText(/pago\.meteorito\.app\/p\/demo01/)).toBeVisible();
    await expectNoScroll(page);
  });

  test('VEN-02 sin foto no genera link', async ({ page }) => {
    await open(page, '/vender', 'seller', true);
    await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('Bici');
    await page.getByPlaceholder('0').fill('150000');
    await page.getByText('Generar link').click();
    await expect(page.getByText('¡Tu link está listo!')).toHaveCount(0);
  });

  test('VEN-03 precio menor a ₡1 000 no genera link', async ({ page }) => {
    await open(page, '/vender', 'seller', true);
    await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('Bici');
    await page.getByPlaceholder('0').fill('500');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('Agregar', { exact: true }).click()]);
    await fc.setFiles(PHOTO);
    await page.getByText('Generar link').click();
    await expect(page.getByText('¡Tu link está listo!')).toHaveCount(0);
  });

  test('VEN-04 el producto aparece en la tienda pública /t/valeria', async ({ page }) => {
    await open(page, '/', 'seller', true);
    await page.evaluate(() => (window as any).__meteoritoDemo.seed('creado', { title: 'Guitarra', price_crc: 90000 }));
    await open(page, '/t/valeria', 'buyer');
    await expect(page.getByText('Guitarra')).toBeVisible();
  });

  test('VEN-05 Mi cuenta: IBAN inválido se rechaza, válido se guarda enmascarado', async ({ page }) => {
    await open(page, '/mi-tienda', 'seller', true);
    await page.getByText('Agrega tu cuenta IBAN').click();
    const iban = page.getByPlaceholder('CR00 0000 0000 0000 0000 00');
    const save = page.getByRole('button', { name: /Guardar cuenta/ });
    await page.getByPlaceholder('Como aparece en el banco').fill('Valeria Mora');
    await iban.fill('CR05015202001026284067'); // dígito de control mod-97 malo
    await expect(save).toBeDisabled();
    await iban.fill('CR05015202001026284066');
    await page.getByPlaceholder('8888 1234').fill('8888123');  // SINPE de 7 dígitos
    await expect(save).toBeDisabled();
    await page.getByPlaceholder('8888 1234').fill('88881234');
    await expect(save).toBeEnabled();
    await save.click();
    await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('meteorito:demo:v1')!).payout?.iban_last4)).toBe('4066');
    await expect(page.getByText(/4066/).first()).toBeVisible();
    await expect(page.getByText('CR05015202001026284066')).toHaveCount(0); // siempre enmascarada
  });
});
