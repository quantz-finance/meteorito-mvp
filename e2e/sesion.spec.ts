// Sesión vencida del vendedor (t82): el borrador de Vender sobrevive a que iOS cierre la PWA y, si la sesión vence en plena
// acción, el login se abre encima de la pantalla y "Generar link" se completa solo (reintento único), sin "Tu sesión venció".
import { test, expect } from '@playwright/test';
import { open, takePhoto, expectInputs16 } from './helpers';

const shot = (name: string) => `/workspace/out/${name}`;
const noHScroll = async (page: any) => {
  const m = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth }));
  expect(m.sw, `scroll horizontal ${m.sw} > ${m.iw}`).toBeLessThanOrEqual(m.iw + 1);
};

test.describe('Sesión del vendedor (demo)', () => {
  test('SES-01 el borrador de Vender sobrevive a cerrar la PWA (sin sessionStorage)', async ({ page }, info) => {
    await open(page, '/vender', 'seller', true);
    await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('iPhone 13 de 128 GB');
    await page.getByPlaceholder('0').fill('250000');
    await page.waitForTimeout(300);
    // iOS cierra la app instalada: se borra sessionStorage (y la memoria). localStorage queda.
    await page.evaluate(() => { const keep = sessionStorage.getItem('meteorito:demo:v1'); sessionStorage.clear(); if (keep) sessionStorage.setItem('meteorito:demo:v1', keep); });
    await open(page, '/vender', 'seller');
    await expect(page.getByPlaceholder('Ej. iPhone 13 de 128 GB')).toHaveValue('iPhone 13 de 128 GB');
    await expect(page.getByPlaceholder('0')).toHaveValue(/250/);
    await expectInputs16(page); await noHScroll(page);
    if (info.project.name === 'webkit-iphone-se') await page.screenshot({ path: shot('sesion-borrador-restaurado.png') });
  });

  test('SES-02 sesión vencida al generar el link: re-login encima, el link sale solo y el borrador no se pierde', async ({ page }, info) => {
    await open(page, '/vender', 'seller', true);
    await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('Bici de montaña');
    await page.getByPlaceholder('0').fill('150000');
    await takePhoto(page);
    await page.evaluate(() => (window as any).__meteoritoDemo.expireSession());
    await page.getByText('Generar link').click();
    // el login simulado se abre (~0,9 s) y la acción se reintenta una vez con el token nuevo
    await expect(page.getByText('¡Tu link está listo!')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Tu sesión venció|cargar la página/)).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/vender'); // misma pantalla
    await expect(page.getByText('Bici de montaña')).toBeVisible();
    const s = await page.evaluate(() => (window as any).__meteoritoDemo.state().session);
    expect(s.gen).toBe(1); expect(s.expired).toBe(false); // un solo re-login
    await noHScroll(page);
    if (info.project.name === 'webkit-iphone-se') await page.screenshot({ path: shot('sesion-relogin-link-listo.png') });
  });
});
