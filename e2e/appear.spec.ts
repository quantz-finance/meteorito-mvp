// Animación de entrada única (components/Appear): fade + subida, escalonada, se repite al volver a la pantalla.
// En el resto de los tests la entrada es instantánea (html.no-appear en navegadores automatizados); aquí se reactiva con
// localStorage 'meteorito:e2e-anim' = '1'.
import { expect, test, type Page } from '@playwright/test';
import { open } from './helpers';

const enable = (page: Page) => page.addInitScript(() => localStorage.setItem('meteorito:e2e-anim', '1'));
/** Animación de entrada de los hijos de un grupo: [nombre, duración ms, retraso ms]. */
const groupAnims = (page: Page, sel: string) => page.evaluate((s) => Array.from(document.querySelectorAll(`${s}>*`)).map((e) => {
  const c = getComputedStyle(e); return [c.animationName, parseFloat(c.animationDuration) * 1000, parseFloat(c.animationDelay) * 1000] as [string, number, number];
}), sel);

test.describe('Entrada', () => {
  test('APR-01 Vender: bloques escalonados (fade + subida, 280 ms, tope ~0,5 s), visibles al terminar', async ({ page }) => {
    await enable(page);
    await open(page, '/vender', 'seller', true);
    await expect(page.locator('html')).not.toHaveClass(/no-appear/);
    await expect(page.getByPlaceholder('Ej. iPhone 13 de 128 GB')).toBeVisible();
    const root = await groupAnims(page, '[data-appear]');
    expect(root.length).toBeGreaterThanOrEqual(2); // encabezado + formulario
    const sub = await groupAnims(page, '[data-appear-sub]');
    expect(sub.length).toBeGreaterThanOrEqual(4); // importar, nombre, precio, fotos…
    for (const [name, dur] of sub) { expect(name).toMatch(/^m-ap-[ab]$/); expect(dur).toBe(280); }
    const delays = sub.map((x) => x[2]);
    expect(delays[1]).toBeGreaterThan(delays[0]); // escalonado
    expect(Math.max(...delays) + 280).toBeLessThanOrEqual(560); // todo visible en ~0,5 s
    const kf = await page.evaluate(() => { for (const sh of Array.from(document.styleSheets)) for (const r of Array.from(sh.cssRules)) if (r instanceof CSSKeyframesRule && r.name === 'm-ap-a') return r.cssText; return ''; });
    expect(kf).toMatch(/opacity: 0/); expect(kf).toMatch(/translate3d\(0px, 10px, 0px\)/);
    await page.waitForTimeout(700);
    const op = await page.evaluate(() => Array.from(document.querySelectorAll('[data-appear-sub]>*')).map((e) => getComputedStyle(e).opacity));
    expect(op.every((o) => o === '1')).toBe(true);
    // no bloquea: se puede escribir de inmediato
    await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('Bici');
    await expect(page.getByPlaceholder('Ej. iPhone 13 de 128 GB')).toHaveValue('Bici');
  });

  test('APR-02 se repite al volver a la pestaña (sin perder lo escrito); Comprar: tarjetas escalonadas', async ({ page }) => {
    await enable(page);
    await open(page, '/vender', 'seller', true);
    await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('Bici de montaña');
    const name0 = (await groupAnims(page, '[data-appear-sub]'))[0][0];
    await page.getByRole('tab', { name: 'Comprar' }).click();
    await expect(page.getByTestId('feed-card').first()).toBeVisible();
    const cards = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="feed-card"]')).slice(0, 4).map((e) => { const c = getComputedStyle(e); return [c.animationName, parseFloat(c.animationDelay) * 1000] as [string, number]; }));
    expect(cards.length).toBeGreaterThanOrEqual(2);
    for (const [n] of cards) expect(n).toMatch(/^m-ap-[ab]$/);
    expect(cards[1][1]).toBeGreaterThan(cards[0][1]);
    await page.getByRole('tab', { name: 'Vender' }).click();
    await expect.poll(async () => (await groupAnims(page, '[data-appear-sub]'))[0][0]).not.toBe(name0); // reinicia
    await expect(page.getByPlaceholder('Ej. iPhone 13 de 128 GB')).toHaveValue('Bici de montaña');
  });

  test('APR-03 tests normales: entrada instantánea (no dependen del tiempo)', async ({ page }) => {
    await open(page, '/vender', 'seller', true);
    await expect(page.locator('html')).toHaveClass(/no-appear/);
    await expect(page.getByPlaceholder('Ej. iPhone 13 de 128 GB')).toBeVisible();
    const sub = await groupAnims(page, '[data-appear-sub]');
    expect(sub.every(([n]) => n === 'none')).toBe(true);
  });
});

test.describe('Entrada con reducir movimiento', () => {
  test.use({ reducedMotion: 'reduce' });
  test('APR-04 instantánea', async ({ page }) => {
    await enable(page);
    await open(page, '/vender', 'seller', true);
    await expect(page.getByPlaceholder('Ej. iPhone 13 de 128 GB')).toBeVisible();
    const sub = await groupAnims(page, '[data-appear-sub]');
    expect(sub.length).toBeGreaterThan(0);
    expect(sub.every(([n]) => n === 'none')).toBe(true);
  });
});
