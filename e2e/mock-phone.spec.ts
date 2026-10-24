// Build REAL + backend simulado: el WhatsApp del vendedor solo aparece en el dispositivo del comprador y solo tras pagar.
import { test, expect } from '@playwright/test';
import { reset, calls, MOCK_PIN } from './mock';

test.describe.configure({ mode: 'serial' });
const listing = { slug: 'prod01', kind: 'listing', model: 'Bici de montaña', price_crc: 150000 };

test('MCK-TEL-01 "Contacta al vendedor" solo para el comprador y solo después de pagar', async ({ page, browser, request }) => {
  await reset(request, [listing]);
  await page.goto('/t/valeria'); // tienda pública: nunca
  await expect(page.getByText('Bici de montaña').first()).toBeVisible();
  await expect(page.getByText('Contacta al vendedor')).toHaveCount(0);
  await page.goto('/p/prod01'); // antes de pagar: nunca
  await expect(page.getByText(/Pagar en custodia/).last()).toBeVisible();
  await expect(page.getByText('Contacta al vendedor')).toHaveCount(0);
  await page.getByText(/Pagar en custodia/).last().click();
  await expect(page).toHaveURL(/\/p\/h[0-9a-f]{5}\?pay=1/);
  await expect(page.getByText('Paga por SINPE Móvil')).toBeVisible();
  await expect(page.getByText('Contacta al vendedor')).toHaveCount(0); // pedido creado, sin pagar
  expect((await calls(request, '/api/store')).filter((c: any) => c.action === 'seller_contact')).toHaveLength(0);
  await page.getByText('Ya pagué', { exact: true }).click();
  await expect(page.getByText(MOCK_PIN)).toBeVisible();
  const slug = page.url().match(/\/p\/(h[0-9a-f]{5})/)![1];
  await page.goto(`/p/${slug}`);
  await expect(page.getByText('Contacta al vendedor')).toBeVisible();
  const wa = page.getByTestId('seller-whatsapp');
  await expect(wa).toHaveAttribute('href', 'https://wa.me/50688887777');
  await expect(page.getByText('+506 8888 7777')).toBeVisible();
  const asked = (await calls(request, '/api/store')).filter((c: any) => c.action === 'seller_contact');
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((c: any) => c.guest && c.slug === slug)).toBe(true); // con la llave del comprador

  // Otro navegador (no es el comprador) con el mismo link pagado: no lo ve ni lo pide.
  const other = await (await browser.newContext()).newPage();
  await other.goto(`/p/${slug}`);
  await expect(other.getByText('Bici de montaña').first()).toBeVisible();
  await expect(other.getByText('Contacta al vendedor')).toHaveCount(0);
  expect((await calls(request, '/api/store')).filter((c: any) => c.action === 'seller_contact').length).toBe(asked.length);
});
