// Envío simple (demo): el vendedor toca "Ya lo envié" (foto y número de guía opcionales) y el comprador ve su código
// de entrega SOLO después del envío, junto con "Va en camino" y la foto.
import { test, expect, type Page } from '@playwright/test';
import { open, seed, orderStatus, DEMO_PIN, PAID, PHOTO, expectNoScroll, openSellerRow, expectInputs16 } from './helpers';

const SHOTS = process.env.SHIP_SHOTS; // carpeta para capturas (opcional, p. ej. /workspace/out)
const shot = async (page: Page, name: string) => { if (SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: `${SHOTS}/ship-${name}.png` }); } };
const st = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('meteorito:demo:v1') || '{}'));

test('SHP-01 vendedor: "Ya lo envié" en un toque, sin campo obligatorio', async ({ page }) => {
  await open(page, '/', 'seller', true);
  const slug = await seed(page, 'fondeado');
  await openSellerRow(page, 'Pagado · fondos apartados', /Ya lo envié/);
  await expect(page.getByText('Marcar como enviado')).toHaveCount(0);
  await expect(page.getByPlaceholder('Número de guía (opcional)')).toHaveCount(0); // discreto: plegado
  await expect(page.getByText('Ya lo envié', { exact: true }).last()).toBeEnabled();
  await shot(page, 'vendedor-antes');
  await page.getByText('Ya lo envié', { exact: true }).last().click();
  await expect.poll(() => orderStatus(page, slug)).toBe('enviado');
  const ev = (await st(page)).orders[slug].evidence;
  expect(ev.at).toBeTruthy();
  expect(ev.photo).toBeUndefined();
});

test('SHP-02 comprador ve su código solo después del envío; el vendedor adjunta una foto opcional', async ({ page }) => {
  await open(page, '/', 'seller', true);
  const prod = await seed(page, 'creado');
  await open(page, `/p/${prod}?buyer=A`, 'buyer');
  await page.getByText(/Pagar en custodia/).last().click();
  await page.getByText('Ya pagué', { exact: true }).click();
  await expect(page.getByText(PAID).first()).toBeVisible();
  await expect(page.getByText(DEMO_PIN)).toHaveCount(0);
  const slug = page.url().match(/\/p\/(demo\d+)/)![1];
  await open(page, `/p/${slug}?buyer=A`, 'buyer');
  await expect(page.getByText(PAID).first()).toBeVisible();
  await expect(page.getByText(DEMO_PIN)).toHaveCount(0);
  await expect(page.getByText('Ver mi PIN de entrega')).toHaveCount(0);
  await shot(page, 'comprador-fondeado');

  // Vendedor: foto del comprobante + "Ya lo envié"
  await openSellerRow(page, 'Pagado · fondos apartados', /Ya lo envié/);
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByLabel('Agregar foto del envío').click()]);
  await fc.setFiles(PHOTO);
  await expect(page.getByTestId('ship-photo-preview')).toBeVisible();
  await page.getByText('Agregar número de guía (opcional)').click();
  await expectInputs16(page);
  await page.getByPlaceholder('Número de guía (opcional)').fill('CR123456789');
  await shot(page, 'vendedor-foto');
  await page.getByText('Ya lo envié', { exact: true }).last().click();
  await expect.poll(() => orderStatus(page, slug)).toBe('enviado');
  expect((await st(page)).orders[slug].evidence.photo).toMatch(/^data:image\//);

  // Comprador: "Va en camino" + foto + código
  await open(page, `/p/${slug}?buyer=A`, 'buyer');
  await expect(page.getByText('Va en camino')).toBeVisible();
  await expect(page.getByTestId('delivery-code')).toHaveText(DEMO_PIN);
  await expect(page.getByText('Dáselo al vendedor cuando lo recibas.')).toBeVisible();
  await expect(page.getByTestId('ship-photo')).toBeVisible();
  await expect(page.getByText('Recibí y está bien', { exact: true })).toBeVisible();
  await expect(page.getByText('Tengo un problema').first()).toBeVisible();
  await expect(page.getByText(/se libera solo en (7 días|6 días 23 h) si no reportas un problema/)).toBeVisible();
  await expectNoScroll(page);
  await shot(page, 'comprador-enviado');
  await shot(page, 'iphone-se-sin-scroll');
  await page.getByTestId('ship-photo').click();
  await expect(page.getByTestId('ship-photo-full')).toBeVisible();
});
