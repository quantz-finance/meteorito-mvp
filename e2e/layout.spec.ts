import { test, expect } from '@playwright/test';
import { open, seed, settle, expectNoScroll, expectInputs16, expectTitleAt16, BANNED, VOSEO, withoutBetaNotice } from './helpers';

const SCREENS: { path: string; role: 'seller' | 'buyer'; title?: string }[] = [
  { path: '/', role: 'seller' },
  { path: '/vender', role: 'seller', title: 'Vender' },
  { path: '/pedidos', role: 'seller', title: 'Home' },
  { path: '/comprar', role: 'buyer' },
  { path: '/t/valeria?owner=1', role: 'seller' }, // Mi tienda = /t/<usuario> con las herramientas del dueño
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
      expect(withoutBetaNotice(text)).not.toMatch(/de prueba|testnet/i); // solo se permite el aviso de beta (BETA_NOTICE)
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
  test('LAY /vender: "Generar link" sin fondo morado detrás (se ve el universo)', async ({ page }) => {
    await open(page, '/vender', 'seller', true);
    await settle(page);
    const btn = page.getByRole('button', { name: 'Generar link' });
    await expect(btn).toBeVisible();
    // Colores morados del tema (bg, surface, surface2, purple) y el lila translúcido (lilacBg / line).
    const r = await btn.evaluate((el) => {
      const PURPLES = ['rgb(26, 11, 61)', 'rgb(45, 20, 102)', 'rgb(58, 29, 122)', 'rgb(108, 43, 217)'];
      const isPurple = (c: string) => PURPLES.includes(c) || /^rgba\(201, 182, 255/.test(c);
      const own = getComputedStyle(el);
      const bad: string[] = [];
      if (isPurple(own.backgroundColor) || /108, 43, 217|26, 11, 61/.test(own.backgroundImage)) bad.push(`botón bg=${own.backgroundColor}`);
      // Contenedores entre el botón y #root: transparentes, sin borde ni sombra moradas.
      for (let e = el.parentElement; e && e.id !== 'root'; e = e.parentElement) {
        const cs = getComputedStyle(e);
        const alpha = cs.backgroundColor.startsWith('rgba') ? parseFloat(cs.backgroundColor.split(',')[3]) : 1;
        if (alpha > 0) bad.push(`contenedor bg=${cs.backgroundColor}`);
        if (cs.backgroundImage !== 'none') bad.push(`contenedor img=${cs.backgroundImage}`);
        if (parseFloat(cs.borderTopWidth) > 0 && isPurple(cs.borderTopColor)) bad.push(`contenedor borde=${cs.borderTopColor}`);
        if (/108, 43, 217|26, 11, 61|201, 182, 255/.test(cs.boxShadow)) bad.push(`contenedor sombra=${cs.boxShadow}`);
      }
      return bad;
    });
    expect(r, 'fondos morados detrás de "Generar link"').toEqual([]);
    await expectNoScroll(page);
  });
  test('LAY el título no se mueve entre pestañas', async ({ page }) => {
    const ys: number[] = [];
    for (const [p, t] of [['/vender', 'Vender'], ['/pedidos', 'Home']] as const) {
      await open(page, p, 'seller'); await page.waitForTimeout(400);
      ys.push(Math.round((await page.getByText(t, { exact: true }).first().boundingBox())!.y));
    }
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(1);
  });
});
