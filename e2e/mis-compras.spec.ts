// Mis compras (demo): botón de icono arriba a la derecha en Comprar -> lista de compras de este comprador, activas
// primero y cerradas aparte; cada fila abre su seguimiento. Sin scroll con hasta 3 compras (iPhone SE).
import { test, expect } from '@playwright/test';
import { expectNoScroll, open, seed, BANNED, VOSEO } from './helpers';

const SHOTS = process.env.MIS_COMPRAS_SHOTS; // carpeta opcional para capturas (no se usa en CI)

test.describe('Mis compras', () => {
  test('MIS-01 Comprar: botón "Mis compras" arriba a la derecha abre la lista; vacío con texto amable', async ({ page }, info) => {
    await open(page, '/comprar', 'buyer', true);
    const btn = page.getByRole('tab', { name: 'Mis compras', exact: true });
    await expect(btn).toBeVisible();
    const b = (await btn.boundingBox())!; const vw = page.viewportSize()!.width;
    expect(b.x + b.width, 'arriba a la derecha').toBeGreaterThan(vw - 80);
    expect(b.y, 'arriba a la derecha').toBeLessThan(90);
    expect(await btn.innerText(), 'icono (glifo de la fuente), sin texto ni emoji').not.toMatch(/[\p{L}\p{Extended_Pictographic}]/u);
    if (SHOTS && info.project.name === 'webkit-iphone-se') { await page.waitForTimeout(2500); await page.screenshot({ path: `${SHOTS}/mis-compras-boton-comprar.png` }); }
    await btn.click();
    await expect(page).toHaveURL(/\/comprar\/compras/);
    await expect(btn).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('purchases-empty')).toHaveText('Aquí verás tus compras activas.');
    await expectNoScroll(page);
    if (SHOTS && info.project.name === 'webkit-iphone-se') await page.screenshot({ path: `${SHOTS}/mis-compras-vacio.png` });
  });

  test('MIS-02 3 compras activas + 1 cerrada: activas primero (sin scroll), cerradas aparte; tocar abre el seguimiento', async ({ page }, info) => {
    await open(page, '/comprar', 'seller', true);
    const enviado = await seed(page, 'enviado', 'iPhone 13');
    await seed(page, 'fondeado', 'Bici de montaña');
    await seed(page, 'fondeado', 'Consola PS5');
    const cerrada = await seed(page, 'enviado', 'Audífonos');
    // La tercera queda cerrada: el comprador confirma la recepción (mismo API simulado que la UI).
    await page.goto(`/p/${cerrada}?role=buyer&badge=0`);
    await page.getByText('Recibí y está bien').click();
    await expect(page.getByText('¡Listo! Pago liberado')).toBeVisible();
    await page.goto('/comprar/compras?role=buyer&badge=0');
    const rows = page.getByTestId('purchase-row');
    await expect(rows).toHaveCount(3);
    const iphone = rows.filter({ hasText: 'iPhone 13' });
    await expect(iphone).toContainText('Enviado');
    await expect(iphone).toContainText('Cuando lo recibas, dale tu código al vendedor.');
    await expect(page.getByText('Bici de montaña')).toBeVisible();
    await expect(page.getByText('Esperando que el vendedor lo envíe.').first()).toBeVisible();
    await expect(page.getByText('₡150 000').first()).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Activas, 3' })).toHaveAttribute('aria-selected', 'true');
    await expectNoScroll(page);
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(BANNED); expect(text).not.toMatch(VOSEO);
    if (SHOTS && info.project.name === 'webkit-iphone-se') { await page.screenshot({ path: `${SHOTS}/mis-compras-activas.png` }); await page.screenshot({ path: `${SHOTS}/comprar-compras.png` }); }
    await page.getByRole('tab', { name: 'Cerradas, 1' }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Audífonos');
    await expect(rows.first()).toContainText('Pago liberado');
    if (SHOTS && info.project.name === 'webkit-iphone-se') await page.screenshot({ path: `${SHOTS}/mis-compras-cerradas.png` });
    await page.getByRole('tab', { name: 'Activas, 3' }).click();
    await rows.filter({ hasText: 'iPhone 13' }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${enviado}`));
    await expect(page.getByText('Tu compra')).toBeVisible();
  });

  test('CMP-NAV-01 Comprar en 3 pantallas: Feed por defecto, Pagar con link y Mis compras, cada una con su link', async ({ page }, info) => {
    const shot = async (n: string) => { if (SHOTS && info.project.name === 'webkit-iphone-se') { await page.waitForTimeout(2500); await page.screenshot({ path: `${SHOTS}/comprar-${n}.png` }); } };
    await open(page, '/comprar', 'buyer', true);
    const tabs = page.getByRole('tablist').filter({ has: page.getByRole('tab', { name: 'Pagar con link' }) });
    await expect(tabs.getByRole('tab')).toHaveCount(3);
    const sizes = await tabs.getByRole('tab').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; }));
    expect(new Set(sizes).size, 'mismo tamaño').toBe(1);
    await expect(page.getByRole('tab', { name: 'Feed' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('feed-card').first()).toBeVisible();
    await shot('feed');
    await page.getByRole('tab', { name: 'Pagar con link' }).click();
    await expect(page).toHaveURL(/\/comprar\/link/);
    await expect(page.getByRole('tab', { name: 'Pagar con link' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Importar de un link' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Invitar a un vendedor' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pagar un link' })).toBeVisible();
    await expectNoScroll(page);
    await shot('link');
    await page.getByRole('tab', { name: 'Mis compras' }).click();
    await expect(page).toHaveURL(/\/comprar\/compras/);
    await page.getByRole('tab', { name: 'Feed' }).click();
    await expect(page).toHaveURL(/\/comprar(\?|$)/);
    // Link directo (compartible) a cada pantalla
    await page.goto('/comprar/link?role=buyer&badge=0');
    await expect(page.getByRole('button', { name: 'Pagar un link' })).toBeVisible();
    await page.goto('/mis-compras?role=buyer&badge=0'); // link anterior
    await expect(page).toHaveURL(/\/comprar\/compras/);
  });
});
