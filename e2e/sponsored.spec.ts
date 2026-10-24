// Bloque "Patrocinado" (demo): sin patrocinios no aparece; con ?ads=1 (patrocinios de ejemplo del demo) es un bloque propio
// con el título y la etiqueta en cada tarjeta, sin scroll horizontal de la página. "Promocionar este producto" en Mi tienda
// solo avisa que pronto se podrá (sin cobro).
import { test, expect } from '@playwright/test';
import { open, seed, settle } from './helpers';

const noHScroll = async (page: import('@playwright/test').Page) => {
  const w = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth }));
  expect(w.sw, 'scroll horizontal').toBeLessThanOrEqual(w.iw + 1);
};

test('ADS-01 sin patrocinios activos no hay bloque', async ({ page }) => {
  await open(page, '/comprar', 'buyer', true);
  await expect(page.getByTestId('feed-card').first()).toBeVisible();
  await expect(page.getByTestId('sponsored-block')).toHaveCount(0);
  await expect(page.getByText('Patrocinado')).toHaveCount(0);
});

test('ADS-02 bloque Patrocinado identificable: título, etiqueta en cada tarjeta, explicación y respeta el filtro', async ({ page }) => {
  await open(page, '/comprar?ads=1', 'buyer', true);
  const block = page.getByTestId('sponsored-block');
  await expect(block).toBeVisible();
  await expect(block.getByText('Patrocinado').first()).toBeVisible();
  const cards = block.getByTestId('sponsored-card');
  const n = await cards.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) await expect(cards.nth(i)).toContainText('Patrocinado');
  await settle(page);
  await noHScroll(page);
  await page.getByTestId('sponsored-info').click();
  await expect(page.getByText(/pagaron para mostrar sus productos/)).toBeVisible();
  await page.getByRole('button', { name: 'Entendido' }).click();
  // Filtro "Identidad confirmada" (por defecto): solo patrocinados de vendedores con identidad confirmada.
  await expect(cards.filter({ hasText: 'Carlos Bikes' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Sin confirmar' }).click();
  await expect(block.getByTestId('sponsored-card').filter({ hasText: 'Carlos Bikes' }).first()).toBeVisible();
  await block.getByTestId('sponsored-card').first().click();
  await expect(page).toHaveURL(/\/p\//);
});

test('ADS-03 Mi tienda: "Promocionar este producto" solo avisa que pronto se podrá (sin cobro)', async ({ page }) => {
  await open(page, '/', 'seller', true);
  await seed(page, 'creado');
  await open(page, '/mi-tienda', 'seller');
  await page.getByText('Bici de montaña').first().click();
  await page.getByTestId('promote').click();
  await expect(page.getByTestId('promote-sheet')).toContainText('Todavía no puedes promocionar tus productos. Por ahora no se cobra nada y no tienes que hacer nada.');
  await expect(page.getByText('₡', { exact: false }).filter({ hasText: /pag(a|o)/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Entendido' }).click();
  await expect(page.getByTestId('promote-sheet')).toHaveCount(0);
});
