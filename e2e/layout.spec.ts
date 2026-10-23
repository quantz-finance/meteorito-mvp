import { test, expect } from '@playwright/test';
import { open, seed, expectNoScroll, expectInputs16, expectTitleAt16, BANNED, VOSEO } from './helpers';

const SCREENS: { path: string; role: 'seller' | 'buyer'; title?: string }[] = [
  { path: '/', role: 'seller' },
  { path: '/vender', role: 'seller', title: 'Vender' },
  { path: '/pedidos', role: 'seller', title: 'Mis pedidos' },
  { path: '/comprar', role: 'buyer' },
  { path: '/mi-tienda', role: 'seller', title: 'Mi tienda' },
  { path: '/i/nueva', role: 'buyer', title: 'Invitar a un vendedor' },
  { path: '/t/valeria', role: 'buyer' },
];

test.describe('Layout y copy', () => {
  for (const s of SCREENS) {
    test(`LAY ${s.path}: sin scroll, inputs ≥16 px, título en 16,16, copy permitido`, async ({ page }) => {
      await open(page, s.path, s.role, true);
      await page.waitForTimeout(600);
      await expectNoScroll(page);
      await expectInputs16(page);
      if (s.title) await expectTitleAt16(page, s.title);
      const text = await page.locator('body').innerText();
      expect(text).not.toMatch(BANNED);
      expect(text).not.toMatch(VOSEO);
      expect(text).not.toMatch(/saldo|balance|USDC|wallet|billetera/i); // la app nunca muestra saldo ni wallet
      expect(text).not.toMatch(/de prueba|testnet/i);
    });
  }
  test('LAY /p/<slug> del comprador: sin scroll y sin palabras prohibidas', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const slug = await seed(page, 'creado');
    await open(page, `/p/${slug}`, 'buyer');
    await page.waitForTimeout(600);
    await expectNoScroll(page);
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(BANNED);
    expect(text).not.toMatch(/saldo|USDC|wallet|billetera/i);
  });
  test('LAY el título no se mueve entre pestañas', async ({ page }) => {
    const ys: number[] = [];
    for (const [p, t] of [['/vender', 'Vender'], ['/pedidos', 'Mis pedidos'], ['/mi-tienda', 'Mi tienda']] as const) {
      await open(page, p, 'seller'); await page.waitForTimeout(400);
      ys.push(Math.round((await page.getByText(t, { exact: true }).first().boundingBox())!.y));
    }
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(1);
  });
});
