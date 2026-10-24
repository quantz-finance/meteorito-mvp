// Mis compras con el build REAL y el backend simulado: sin cuenta, la compra queda guardada al pagar y se vuelve a
// encontrar; las compras anteriores se recuperan por la llave de invitado o el PIN guardado en este navegador; nunca
// aparecen las de otra llave.
import { test, expect } from '@playwright/test';
import { reset, MOCK_PIN } from './mock';
import { expectNoScroll, PAID } from './helpers';

test.describe.configure({ mode: 'serial' });
const SHOTS = process.env.MIS_COMPRAS_SHOTS; // carpeta opcional para capturas (no se usa en CI)
const KEY = '7'.repeat(64), OTHER = '8'.repeat(64);

test('MCK-MIS-01 sin cuenta: paga, sale del seguimiento y vuelve desde Mis compras', async ({ page, request }) => {
  await reset(request, [{ slug: 'prod01', kind: 'listing', model: 'Bici de montaña', price_crc: 150000 }]);
  await page.goto('/p/prod01');
  await page.getByText(/Pagar en custodia/).last().click();
  await page.getByText('Ya pagué', { exact: true }).click();
  await expect(page.getByText(PAID).first()).toBeVisible();
  const slug = page.url().match(/\/p\/(h[0-9a-f]{5})/)![1];
  await page.goto('/t/valeria'); // salió de la página de seguimiento
  await page.goto('/mis-compras');
  const row = page.getByTestId('purchase-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Bici de montaña');
  await expect(row).toContainText('₡150 000');
  await expect(row).toContainText('Esperando que el vendedor lo envíe.');
  await expect(page.getByText(MOCK_PIN)).toHaveCount(0); // el PIN no sale en la lista
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/p/${slug}`));
  await expect(page.getByText(PAID).first()).toBeVisible();
});

test('MCK-MIS-02 recuperación: compras anteriores por la llave y por el PIN guardado; nunca las de otra llave', async ({ page, request }, info) => {
  await reset(request, [
    { slug: 'old111', status: 'enviado', contract_id: 'C1', buyer: KEY, model: 'iPhone 13', price_crc: 250000 },
    { slug: 'pin222', status: 'fondeado', contract_id: 'C2', buyer: 'x', model: 'Consola', price_crc: 90000 },
    { slug: 'done33', status: 'liberado', contract_id: 'C3', buyer: KEY, model: 'Audífonos', price_crc: 20000 },
    { slug: 'otro44', status: 'enviado', contract_id: 'C4', buyer: OTHER, model: 'De otra persona', price_crc: 1000 },
  ]);
  await page.addInitScript(([k]) => { localStorage.setItem('meteorito:guest:v1', k); localStorage.setItem('meteorito:guest:pin:pin222', '135790'); }, [KEY]);
  await page.goto('/mis-compras');
  const rows = page.getByTestId('purchase-row');
  await expect(rows).toHaveCount(2);
  await expect(page.getByText('iPhone 13')).toBeVisible();
  await expect(page.getByText('Consola')).toBeVisible();
  await expect(page.getByText('De otra persona')).toHaveCount(0);
  await expectNoScroll(page);
  if (SHOTS && info.project.name === 'mock-iphone-se') await page.screenshot({ path: `${SHOTS}/mis-compras-recuperadas.png` });
  await page.getByRole('tab', { name: 'Cerradas, 1' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Audífonos');
  await expect(page.getByText('De otra persona')).toHaveCount(0);
});

test('MCK-MIS-03 navegador nuevo: vacío con texto amable', async ({ page, request }) => {
  await reset(request, []);
  await page.goto('/mis-compras');
  await expect(page.getByTestId('purchases-empty')).toHaveText('Aquí van a aparecer las compras que hagas en este dispositivo o con tu cuenta.');
});
