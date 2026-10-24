import { test, expect, type Page } from '@playwright/test';
import { open, expectNoScroll, expectInputs16, settle, BANNED, VOSEO } from './helpers';

// Comprar → Invitar a un vendedor con el link de CUALQUIER marketplace (comprador sin cuenta, modo demo).
// Walmart/Facebook se leen (nombre, precio, foto); Mercado Libre, Amazon, Encuentra24… se aceptan sin pedirlos ni
// mostrar error, y el link va en la invitación para el vendedor.
const ML = 'https://articulo.mercadolibre.co.cr/MLC-123456789-bicicleta-aro-29-_JM';
const WALMART = 'https://www.walmart.co.cr/bicicleta-montana-aro-29/p';
const st = (page: Page) => page.evaluate(() => (window as any).__meteoritoDemo.state());
const shot = async (page: Page, info: { project: { name: string } }, name: string) => {
  if (info.project.name === 'webkit-iphone-se') { await settle(page); await page.screenshot({ path: `test-results/invitar-${name}.png` }); }
};
const copyOk = async (page: Page) => { const text = await page.locator('body').innerText(); expect(text).not.toMatch(BANNED); expect(text).not.toMatch(VOSEO); };

test.describe('Comprar: invitar con el link de cualquier marketplace', () => {
  test('CMP-MKT-01 Mercado Libre: se reconoce sin error, no se intenta leer, el link va en la invitación', async ({ page }, info) => {
    await open(page, '/comprar/link?buyer=A', 'buyer', true);
    await expect(page.getByRole('button', { name: 'Importar de un link' })).toBeVisible();
    await shot(page, info, '1-comprar');
    await page.getByRole('button', { name: 'Importar de un link' }).click();
    await expect(page).toHaveURL(/\/i\/nueva/);
    await expect(page.getByTestId('invite-markets')).toContainText('Pega el link del anuncio');
    await page.getByLabel('Link del anuncio').fill(ML);
    await expect(page.getByTestId('import-provider')).toContainText('No pudimos leer ese anuncio. Escribe el nombre y el precio.');
    await page.waitForTimeout(600); // animación de la hoja
    await expectInputs16(page);
    const add = page.getByRole('button', { name: /Agregar link$/ });
    await expect(add).toBeInViewport();
    await expect(page.getByText(/Todavía no podemos|Mercado Libre:/)).toHaveCount(0);
    await copyOk(page);
    await shot(page, info, '2-hoja-mercadolibre');
    const before = await st(page);
    await add.click();
    await expect(page.getByText('No pudimos leer ese anuncio.', { exact: true })).toBeVisible();
    await expect(page.getByText('Escribe el nombre y el precio. El vendedor verá el link del anuncio.')).toBeVisible();
    await expect(page.getByPlaceholder('Ej. iPhone 13 de 128 GB')).toHaveValue('');
    await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('Bicicleta aro 29');
    await page.getByLabel('Precio acordado').fill('150000');
    await expectNoScroll(page);
    await expectInputs16(page);
    await copyOk(page);
    await shot(page, info, '3-mercadolibre-agregado');
    await page.getByRole('button', { name: /Crear invitación/ }).click();
    await expect(page).toHaveURL(/\/i\/inv\d+/);
    const code = page.url().match(/\/i\/(inv\d+)/)![1];
    const s = await st(page);
    expect(s.invites[code].source_url).toBe(ML);
    expect(Object.keys(s.orders ?? {}).length).toBe(Object.keys(before.orders ?? {}).length);
    await expect(page.getByRole('link', { name: 'Ver anuncio en Mercado Libre' })).toBeVisible();

    await open(page, `/i/${code}?buyer=S`, 'seller');
    await expect(page.getByText('Vieron tu anuncio en Mercado Libre y quieren pagarte en custodia.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ver anuncio en Mercado Libre' })).toBeVisible();
    await expectNoScroll(page);
    await shot(page, info, '5-vendedor-mercadolibre');
  });

  test('CMP-MKT-02 Walmart: se lee y precarga nombre, precio y foto como el import', async ({ page }, info) => {
    await open(page, '/i/nueva?fb=1&buyer=A', 'buyer', true);
    await page.getByLabel('Link del anuncio').fill(WALMART);
    await expect(page.getByTestId('import-provider')).toContainText('Anuncio de Walmart: llenamos el nombre, el precio y la foto.');
    await page.getByRole('button', { name: /Importar$/ }).click();
    await expect(page.getByText('Importado de Walmart')).toBeVisible();
    await expect(page.getByPlaceholder('Ej. iPhone 13 de 128 GB')).toHaveValue('Bicicleta de montaña aro 29');
    await expect(page.getByLabel('Precio acordado')).toHaveValue('185 000');
    await expect(page.getByLabel('Quitar foto')).toHaveCount(1);
    await expectNoScroll(page);
    await copyOk(page);
    await shot(page, info, '4-walmart-importado');
    await page.getByRole('button', { name: /Crear invitación/ }).click();
    await expect(page).toHaveURL(/\/i\/inv\d+/);
    const code = page.url().match(/\/i\/(inv\d+)/)![1];
    expect((await st(page)).invites[code].source_url).toBe(WALMART);
    await expect(page.getByRole('link', { name: 'Ver anuncio en Walmart' })).toBeVisible();
  });
});
