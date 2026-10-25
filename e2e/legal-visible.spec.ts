// Neo (legal): el aviso de beta y "Ver reglas"/"Cómo funciona" nunca quedan en opacidad 0 ni ocultos por una animación de
// entrada (si falla, va lenta o el JS no corre). Estos tests corren con las animaciones de entrada ENCENDIDAS y miden
// en el primer cuadro: ni el aviso ni ningún ancestro tiene una animación de entrada con opacidad (LEGAL_CSS).
import { expect, test } from '@playwright/test';
import { expectLegalVisible, open } from './helpers';

test('LEG-01 Vender: aviso de beta y "Ver reglas" visibles desde el primer cuadro con la animación de entrada activa', async ({ page }) => {
  await open(page, '/vender', 'seller', true);
  await expect(page.getByTestId('beta-notice')).toBeVisible();
  await expectLegalVisible(page, ['beta-notice', 'rules-hint']);
});

test('LEG-02 Home: "Cómo funciona" visible desde el primer cuadro con la animación de entrada activa', async ({ page }) => {
  await open(page, '/pedidos', 'seller', true);
  await expect(page.getByTestId('rules-link').first()).toBeVisible();
  await expectLegalVisible(page, ['rules-link']);
});

test('LEG-03 sin JS: el HTML estático ya trae la regla que deja los avisos fuera de la animación y nada legal arranca oculto', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  for (const path of ['/vender', '/pedidos', '/como-funciona']) {
    await page.goto(path);
    const css = await page.locator('style').allTextContents();
    expect(css.join('')).toContain('[data-legal]{animation:none!important}');
    expect(css.join('')).toMatch(/\[data-anim="enter"\]:has\(\[data-legal\]\)/);
    const hidden = await page.evaluate(() => [...document.querySelectorAll('[data-legal]')].filter((el) => {
      for (let e: Element | null = el; e; e = e.parentElement) if (getComputedStyle(e).opacity === '0' || getComputedStyle(e).animationName !== 'none') return true;
      return false;
    }).length);
    expect(hidden).toBe(0);
  }
  await ctx.close();
});
