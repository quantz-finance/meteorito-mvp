// Fotos "solo cámara" (demo con cámara simulada): Vender, invitación del comprador y disputa abren la cámara de la app,
// nunca un selector de archivos; la foto lleva la marca (fecha y hora CR + código). CAM_SHOTS=<carpeta> guarda capturas 375x667.
import { test, expect, type Page } from '@playwright/test';
import { open, seed, openSellerRow, takePhoto, expectNoScroll } from './helpers';

const SHOTS = process.env.CAM_SHOTS;
const shot = async (page: Page, name: string) => { if (SHOTS) { await page.waitForTimeout(500); await page.screenshot({ path: `${SHOTS}/camera-${name}.png` }); } };
const noChooser = (page: Page) => { const s = { opened: false }; page.on('filechooser', () => { s.opened = true; }); return s; };

test.beforeEach(async ({ page }) => { if (SHOTS) await page.setViewportSize({ width: 375, height: 667 }); });

test('CAM-01 Vender: la foto se toma con la cámara de la app, con fecha CR y código, sin input de archivo', async ({ page }) => {
  const ch = noChooser(page);
  await open(page, '/vender', 'seller', true);
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await expectNoScroll(page);
  await page.getByLabel('Tomar foto', { exact: true }).click();
  await expect(page.getByTestId('camera-preview')).toBeVisible();
  await expect(page.getByTestId('camera-shutter')).toBeEnabled();
  await expect(page.getByText(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2} CR$/)).toBeVisible();
  await expect(page.getByText(/^Meteorito · P-[0-9A-F]{6}$/)).toBeVisible();
  await expectNoScroll(page);
  await shot(page, 'abierta');
  await page.getByTestId('camera-shutter').click();
  await expect(page.getByTestId('camera-shot')).toBeVisible();
  await shot(page, 'foto-con-marca');
  await page.getByText('Usar foto', { exact: true }).click();
  await expect(page.getByText('FOTOS (1/4)', { exact: false })).toBeVisible();
  await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('Bici de montaña');
  await page.getByPlaceholder('0').fill('150000');
  await page.getByText('Generar link').click();
  await expect(page.getByText('¡Tu link está listo!')).toBeVisible();
  expect(ch.opened).toBe(false);
});

test.describe('iPhone (Safari)', () => {
test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
test('CAM-02 envío: "Ya lo envié" bloqueado sin foto y permiso denegado con instrucciones', async ({ page }) => {
  await open(page, '/', 'seller', true);
  await seed(page, 'fondeado');
  await openSellerRow(page, /Envíalo|Entrégalo/, /Ya lo envié/);
  await expect(page.getByRole('button', { name: /Ya lo envié/ }).last()).toBeDisabled();
  await expect(page.getByText('Toma la foto para poder marcarlo como enviado.')).toBeVisible();
  await shot(page, 'ya-lo-envie-bloqueado');
  await page.evaluate(() => sessionStorage.setItem('meteorito:fake-camera', 'denied'));
  await page.getByLabel('Tomar foto del envío', { exact: true }).click();
  await expect(page.getByText('Necesitamos tu cámara para tomar la foto')).toBeVisible();
  await expect(page.getByText(/aA junto a la dirección > Configuración del sitio web > Cámara > Permitir/)).toBeVisible();
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await expectNoScroll(page);
  await shot(page, 'permiso-denegado');
  await page.evaluate(() => sessionStorage.removeItem('meteorito:fake-camera'));
  await page.getByText('Reintentar', { exact: true }).click();
  await expect(page.getByTestId('camera-shutter')).toBeEnabled();
});
});

test('CAM-03 invitación del comprador: foto con la cámara (sin cuenta), nunca del carrete', async ({ page }) => {
  const ch = noChooser(page);
  await open(page, '/i/nueva', 'buyer', true);
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await takePhoto(page);
  await expect(page.getByLabel('Quitar foto')).toHaveCount(1);
  expect(ch.opened).toBe(false);
});
