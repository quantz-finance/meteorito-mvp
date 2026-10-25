// Plazo acordado (demo): el vendedor elige cara a cara/envío y el plazo; el comprador lo ve antes de pagar.
// Cara a cara: el comprador ve su código apenas paga y el vendedor lo ingresa desde 'fondeado'. Extensión de mutuo acuerdo.
import { test, expect, type Page } from '@playwright/test';
import { open, orderStatus, DEMO_PIN, takePhoto, expectNoScroll, openSellerRow, expectInputs16 } from './helpers';

const SHOTS = process.env.WIN_SHOTS; // carpeta para capturas (opcional, p. ej. /workspace/out)
const shot = async (page: Page, name: string) => { if (SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: `${SHOTS}/window-${name}.png` }); } };
const st = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('meteorito:demo:v1') || '{}'));

test('WIN-01 vender: elige cara a cara y 3 días; el link guarda el acuerdo; Vender sin scroll', async ({ page }) => {
  await open(page, '/vender', 'seller', true);
  await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('Bici de montaña');
  await page.getByPlaceholder('0').fill('150000');
  await takePhoto(page);
  await expect(page.getByTestId('agreement-value')).toHaveText('Envío · 7 días'); // default
  await expectNoScroll(page);
  const n = (await page.getByTestId('beta-notice').boundingBox())!, b = (await page.getByText('Generar link').boundingBox())!;
  expect(n.y + n.height).toBeLessThanOrEqual(b.y); // la fila nueva no tapa el aviso de beta con el botón
  await shot(page, 'vender');
  await page.getByLabel('Entrega y plazo').click();
  await page.getByLabel('Cara a cara', { exact: true }).click();
  await expect(page.getByLabel('Plazo 24 h')).toHaveAttribute('aria-checked', 'true'); // default cara a cara
  await page.getByLabel('Otro plazo en días').click();
  await expectInputs16(page);
  await page.getByLabel('Días del plazo').fill('45');
  await expect(page.getByText('Escribe de 1 a 30 días.')).toBeVisible();
  await page.getByLabel('Plazo 3 días').click();
  await shot(page, 'vender-entrega-y-plazo');
  await page.getByText('Listo', { exact: true }).click();
  await expect(page.getByTestId('agreement-value')).toHaveText('Cara a cara · 3 días');
  await page.getByText('Generar link').click();
  await expect(page.getByText('¡Tu link está listo!')).toBeVisible();
  await expect(page.getByText('Entrega: Cara a cara · Protección: 3 días')).toBeVisible();
  const o = Object.values((await st(page)).orders)[0] as any;
  expect([o.delivery_mode, o.protection_minutes]).toEqual(['cara_a_cara', 4320]);
});

test('WIN-02 cara a cara: acuerdo antes de pagar, código al pagar, PIN del vendedor en fondeado y extensión aceptada', async ({ page }) => {
  await open(page, '/', 'seller', true);
  const prod = await page.evaluate(() => (window as any).__meteoritoDemo.seed('creado', { title: 'Bici de montaña', price_crc: 150000, delivery_mode: 'cara_a_cara' }));
  await open(page, `/p/${prod}?buyer=A`, 'buyer');
  await expect(page.getByText('Entrega: Cara a cara · Protección: 24 h')).toBeVisible();
  await shot(page, 'comprador-antes-de-pagar');
  await page.getByText(/Pagar en custodia/).last().click();
  await expect(page.getByText('Al pagar aceptas: Entrega: Cara a cara · Protección: 24 h.')).toBeVisible();
  await page.getByText('Ya pagué', { exact: true }).click();
  const slug = page.url().match(/\/p\/(demo\d+)/)![1];
  await open(page, `/p/${slug}?buyer=A`, 'buyer');
  await expect(page.getByText('Entrega cara a cara')).toBeVisible();
  await expect(page.getByTestId('delivery-code')).toHaveText(DEMO_PIN);
  await expect(page.getByText('Dáselo al vendedor cuando revises el producto.')).toBeVisible();
  await expect(page.getByText(/se libera solo en (24 h|23 h)/)).toBeVisible();
  await expectNoScroll(page);
  await shot(page, 'comprador-cara-a-cara');

  // Vendedor: sin "Ya lo envié"; pide 3 días más
  await openSellerRow(page, /Envíalo|Entrégalo/, /Confirmar PIN y cobrar/);
  await expect(page.getByText('Ya lo envié', { exact: true })).toHaveCount(0);
  // Línea de tiempo cara a cara: Pagado, Entregado con PIN (actual), Liberado; sin "Enviado".
  await expect(page.getByText('Entregado con PIN').last()).toBeVisible();
  await expect(page.getByLabel('Estado del pago: 1 de 3 pasos').last()).toBeVisible();
  await expect(page.getByText('Enviado', { exact: true })).toHaveCount(0);
  await shot(page, 'vendedor-pin-cara-a-cara');
  await page.getByLabel('Pedir más tiempo').click();
  await page.getByLabel('Pedir 3 días más').click();
  await expect(page.getByTestId('ext-waiting')).toHaveText('Pediste 3 días más. Esperando respuesta.');
  const due0 = Date.parse((await st(page)).orders[slug].auto_release_at);

  // Comprador: ve la solicitud y acepta
  await open(page, `/p/${slug}?buyer=A`, 'buyer');
  await expect(page.getByText('El vendedor pidió 3 días más')).toBeVisible();
  await shot(page, 'extension-solicitud');
  await page.getByText('Aceptar', { exact: true }).click();
  await expect.poll(async () => (await st(page)).orders[slug].release_ext).toBeNull();
  expect(Date.parse((await st(page)).orders[slug].auto_release_at) - due0).toBe(3 * 86_400_000);

  // Vendedor ingresa el PIN en 'fondeado': cobra al instante
  await openSellerRow(page, /Envíalo|Entrégalo/, /Confirmar PIN y cobrar/);
  await page.getByLabel('Código de entrega del comprador').fill(DEMO_PIN);
  await page.getByText('Confirmar PIN y cobrar', { exact: true }).click();
  await expect.poll(() => orderStatus(page, slug)).toBe('liberado');
});
