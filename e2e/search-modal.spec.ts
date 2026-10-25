// Comprar › Buscar en un modalcito: sin input fijo sobre el feed; la lupa (4.º icono arriba a la derecha) abre la hoja.
import { test, expect } from '@playwright/test';
import { expectInputs16, open, settle } from './helpers';

const SHOTS = process.env.SEARCH_SHOTS;

test.describe('Buscar en un modalcito', () => {
  test('SRCH-01 lupa: 4 iconos sin desborde, hoja con input enfocado, cerrar (X, afuera, Esc), punto, chip y limpiar', async ({ page }, info) => {
    await open(page, '/comprar', 'buyer', true);
    await expect(page.getByTestId('feed-card').first()).toBeVisible();
    await expect(page.getByLabel('Buscar productos', { exact: true })).toHaveCount(0); // ya no hay input fijo
    const lupa = page.getByTestId('comprar-search');
    await expect(lupa).toHaveAttribute('aria-label', 'Buscar');
    // 4 iconos del mismo tamaño, dentro de la pantalla y sin tapar el título.
    await settle(page);
    const boxes = [...await page.getByRole('tablist').filter({ has: page.getByRole('tab', { name: 'Pagar con link' }) }).getByRole('tab').all(), lupa];
    const bb = await Promise.all(boxes.map(async (b) => (await b.boundingBox())!));
    const vw = page.viewportSize()!.width;
    expect(new Set(bb.map((b) => `${Math.round(b.width)}x${Math.round(b.height)}`)).size, 'mismo tamaño').toBe(1);
    expect(Math.round(bb[0].width)).toBeGreaterThanOrEqual(44);
    expect(Math.max(...bb.map((b) => b.x + b.width)), 'sin desborde').toBeLessThanOrEqual(vw);
    const title = (await page.getByTestId('screen-title').boundingBox())!;
    expect(title.x + title.width, 'el título no queda debajo de los iconos').toBeLessThanOrEqual(bb[0].x + 1);
    expect(await lupa.innerText(), 'icono, no emoji ni texto').not.toMatch(/[\p{L}\p{Extended_Pictographic}]/u);
    if (SHOTS && info.project.name === 'webkit-iphone-se') await page.screenshot({ path: `${SHOTS}/buscar-modal-cerrado.png` });
    // Abrir: input enfocado y >= 16 px.
    await lupa.click();
    const input = page.getByLabel('Buscar productos', { exact: true });
    await expect(input).toBeFocused();
    await expectInputs16(page);
    await input.fill('play');
    if (SHOTS && info.project.name === 'webkit-iphone-se') await page.screenshot({ path: `${SHOTS}/buscar-modal-abierto.png` });
    // Esc cierra y la búsqueda queda activa: punto en la lupa + chip arriba del feed.
    await page.keyboard.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(page.getByTestId('search-active')).toBeVisible();
    await expect(page.getByTestId('search-chip')).toContainText('play');
    await expect(page.getByText('Resultados')).toBeVisible();
    // Tocar afuera cierra.
    await lupa.click();
    await expect(input).toBeVisible();
    await page.mouse.click(vw / 2, 30);
    await expect(input).toHaveCount(0);
    // X cierra; limpiar dentro de la hoja.
    await lupa.click();
    await expect(input).toHaveValue('play');
    await page.getByRole('button', { name: 'Limpiar búsqueda' }).last().click(); // la de la hoja (la del chip queda debajo)
    await expect(input).toHaveValue('');
    await page.getByRole('button', { name: 'Cerrar' }).last().click();
    await expect(input).toHaveCount(0);
    await expect(page.getByTestId('search-active')).toHaveCount(0);
    await expect(page.getByTestId('search-chip')).toHaveCount(0);
    // Chip: limpiar desde el feed.
    await lupa.click(); await input.fill('bici'); await input.press('Enter');
    await expect(page.getByTestId('search-chip')).toContainText('bici');
    await page.getByTestId('search-chip').locator('..').getByRole('button', { name: 'Limpiar búsqueda' }).click();
    await expect(page.getByTestId('search-chip')).toHaveCount(0);
  });

  test('SRCH-02 desde Mis compras y Pagar con link: la lupa abre el feed con la hoja', async ({ page }) => {
    for (const path of ['/comprar/compras', '/comprar/link']) {
      await open(page, path, 'buyer', true);
      await page.getByTestId('comprar-search').click();
      await expect(page).toHaveURL(/\/comprar(\?|$)/);
      await expect(page.getByLabel('Buscar productos', { exact: true })).toBeFocused();
      await page.keyboard.press('Escape');
    }
  });
});
