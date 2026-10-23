import { test, expect, type Page } from '@playwright/test';
import { open, expectTitleAt16, settle } from './helpers';

// /p/<slug> (link de pago del comprador, antes y después de pagar): mismo encabezado que la invitación (/i/<code>)
// y miniatura compacta junto al nombre y el precio, en vez de la galería a todo el ancho.
const TITLE = 'Bicicleta de montaña aro 29';
async function seedWithPhotos(page: Page, upTo: 'creado' | 'fondeado', photos = ['/demo-fb-import.jpg']): Promise<string> {
  await open(page, '/', 'seller', true);
  return page.evaluate(([u, t, p]) => (window as any).__meteoritoDemo.seed(u, { title: t, price_crc: 185000, photos: p }), [upTo, TITLE, photos] as const);
}
async function expectCompactThumb(page: Page) {
  const photo = page.getByTestId('order-photo').filter({ visible: true }).first();
  await expect(photo).toBeVisible();
  const box = (await photo.boundingBox())!;
  expect(box.height, `foto de ${box.height}px`).toBeLessThanOrEqual(72);
  expect(box.width).toBeLessThanOrEqual(72);
  const name = (await page.getByText(TITLE, { exact: true }).filter({ visible: true }).first().boundingBox())!;
  expect(name.x, 'el nombre va al lado de la foto').toBeGreaterThanOrEqual(box.x + box.width - 1);
  // Ninguna imagen grande (la galería de 358 px ya no existe).
  const big = await page.evaluate(() => [...document.querySelectorAll('img')].filter((i) => i.src.includes('demo-fb-import') && i.getBoundingClientRect().width > 100).length);
  expect(big).toBe(0);
}

test.describe('Link de pago: mismo diseño que la invitación', () => {
  test('PAY-LAY-01 antes de pagar: título grande en 16,16, miniatura junto al nombre, botón de pago fijo', async ({ page }) => {
    const slug = await seedWithPhotos(page, 'creado');
    await open(page, `/p/${slug}`, 'buyer');
    await expect(page.getByTestId('screen-title').filter({ visible: true })).toHaveText('Link de pago');
    await settle(page);
    await expectTitleAt16(page, 'Link de pago');
    await expectCompactThumb(page);
    await expect(page.getByText('₡185 000').first()).toBeVisible();
    await expect(page.getByText(/Pagar en custodia/).last()).toBeInViewport();
    await expect(page.getByText('Cómo funciona', { exact: false }).first()).toBeVisible();
  });

  test('PAY-LAY-02 después de pagar: "Tu compra", miniatura y "Estado de tu pago"', async ({ page }) => {
    const slug = await seedWithPhotos(page, 'fondeado');
    await open(page, `/p/${slug}`, 'buyer');
    await expect(page.getByTestId('screen-title').filter({ visible: true })).toHaveText('Tu compra');
    await settle(page);
    await expectTitleAt16(page, 'Tu compra');
    await expectCompactThumb(page);
    await expect(page.getByText('Estado de tu pago', { exact: false })).toBeVisible();
  });

  test('PAY-LAY-03 varias fotos: la primera como miniatura y el resto en una fila chica', async ({ page }) => {
    const slug = await seedWithPhotos(page, 'creado', ['/demo-fb-import.jpg', '/demo-fb-import.jpg?2', '/demo-fb-import.jpg?3']);
    await open(page, `/p/${slug}`, 'buyer');
    await expectCompactThumb(page);
    await expect(page.getByTestId('order-photo-extra')).toHaveCount(2);
  });

  test('PAY-LAY-04 el título queda en el mismo lugar que en la invitación', async ({ page }) => {
    await open(page, '/i/nueva?buyer=A', 'buyer', true);
    await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('iPhone 13');
    await page.getByPlaceholder('250 000').fill('250000');
    await page.getByRole('button', { name: /Crear invitación/ }).click();
    await expect(page).toHaveURL(/\/i\/inv\d+/);
    await settle(page);
    const inv = (await page.getByTestId('screen-title').filter({ visible: true }).boundingBox())!;
    const slug = await seedWithPhotos(page, 'creado');
    await open(page, `/p/${slug}`, 'buyer');
    await settle(page);
    const pay = (await page.getByTestId('screen-title').filter({ visible: true }).boundingBox())!;
    expect(Math.round(pay.x)).toBe(Math.round(inv.x));
    expect(Math.abs(pay.y - inv.y)).toBeLessThanOrEqual(2);
  });
});
