// Home (/pedidos): resumen real + "Tus ventas" + "Tus compras" en filas compactas, lo que te toca primero y resaltado.
// Sin la UI del proceso (línea de tiempo, pasos, acciones): eso está en la hoja que abre cada venta y en el seguimiento
// /p/<pedido> de cada compra. Proyectos: iPhone SE, iPhone 13, Pixel 7 (demo).
import { expect, test, type Page } from '@playwright/test';
import { BANNED, expectNoScroll, open, settle, VOSEO, withoutBetaNotice } from './helpers';

const OTRA = 'GOTRAVENDEDORA'; // compras de otra tienda (en el demo todas las tiendas son la misma)
/** 2 ventas con comprador (pagada -> te toca enviarla; enviada) + 1 publicada, y 2 compras de otra tienda (enviada, pagada). */
async function seedHome(page: Page) {
  await open(page, '/vender', 'seller', true);
  return page.evaluate(async (otra) => {
    const d = (window as any).__meteoritoDemo;
    d.setBuyer('B');
    const pagada = await d.seed('fondeado', { title: 'Bici de montaña', price_crc: 185000, photos: ['/demo-feed/p-bicimtb.jpg'] });
    await d.seed('enviado', { title: 'AirPods Pro', price_crc: 95000, photos: ['/demo-feed/p-airpodspro.jpg'] });
    await d.seed('creado', { title: 'Bici de ruta', price_crc: 240000, photos: ['/demo-feed/p-biciruta.jpg'] });
    d.setBuyer('A');
    const c1 = await d.seed('enviado', { title: 'Audífonos', price_crc: 35000, photos: ['/demo-feed/p-audifonos.jpg'] });
    const c2 = await d.seed('fondeado', { title: 'Bici eléctrica', price_crc: 420000, photos: ['/demo-feed/p-biciel.jpg'] });
    const st = d.state();
    for (const s of [c1, c2]) { st.orders[s].seller_address = otra; const l = st.orders[s].listing_slug; if (l) st.orders[l].seller_address = otra; }
    d.setBuyer('A'); // guarda el estado
    return { pagada, c1 };
  }, OTRA);
}

test.describe('Home', () => {
  test('HOME-01 resumen + Tus ventas + Tus compras; lo que te toca primero; sin línea de tiempo; todo arriba sin scroll', async ({ page }) => {
    const { c1 } = await seedHome(page);
    await open(page, '/pedidos', 'seller');
    const summary = page.getByTestId('home-summary');
    await expect(summary).toBeVisible();
    await expect(summary.getByLabel('Por hacer: 2')).toBeVisible(); // enviar la bici + dar tu código de los audífonos
    await expect(summary.getByLabel('Vendiendo: 2')).toBeVisible();
    await expect(summary.getByLabel('Comprando: 2')).toBeVisible();
    // Tus ventas: primero la que te toca, resaltada, con una pastilla corta y su foto
    const firstSale = page.locator('[data-testid^="home-sale-row"]').first();
    await expect(firstSale).toHaveAttribute('data-testid', 'home-sale-row-todo');
    await expect(firstSale).toContainText('Bici de montaña');
    await expect(firstSale).toContainText('Envíalo');
    await expect(firstSale).toContainText('₡185 000');
    await expect(firstSale.locator('img')).toHaveCount(1);
    // Tus compras: la enviada (te toca dar tu código) primero
    const firstBuy = page.locator('[data-testid^="home-buy-row"]').first();
    await expect(firstBuy).toHaveAttribute('data-testid', 'home-buy-row-todo');
    await expect(firstBuy).toContainText('Audífonos');
    await expect(firstBuy).toContainText('Dale tu código');
    // Sin la UI del proceso en Home: ni línea de tiempo ni acciones
    await expect(page.getByLabel(/^Estado del pago:/)).toHaveCount(0);
    await expect(page.getByText('Ya lo envié', { exact: true })).toHaveCount(0);
    // Encabezado de siempre + Mi tienda; meteorito en Tus ventas
    for (const name of ['Mi cuenta', 'Mi tienda']) await expect(page.getByRole('button', { name })).toBeVisible();
    await expect(page.getByTestId('ventas-mascot')).toBeVisible();
    await expect(page.getByLabel('Actualizar', { exact: true })).toHaveCount(0);
    // iPhone SE: resumen y las primeras filas de ambas listas, arriba y sin scroll
    await settle(page);
    for (const el of [summary, firstSale, firstBuy]) await expect(el).toBeInViewport({ ratio: 0.99 });
    await expectNoScroll(page);
    const text = withoutBetaNotice(await page.locator('body').innerText());
    expect(text).not.toMatch(BANNED); expect(text).not.toMatch(VOSEO);
    if (test.info().project.name === 'webkit-iphone-se') await page.screenshot({ path: 'test-results/home-redisenio.png' });
    // Tocar una venta abre su hoja (ahí está el proceso); tocar una compra abre su seguimiento
    await firstSale.click();
    await expect(page.getByText('Ya lo envié').last()).toBeVisible();
    await expect(page.getByLabel(/^Estado del pago:/).last()).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar' }).last().click();
    await page.locator('[data-testid^="home-buy-row"]').first().click();
    await expect(page).toHaveURL(new RegExp(`/p/${c1}`));
  });

  test('HOME-02 sin ventas ni compras: vacío amable, sin resumen en cero, sin scroll', async ({ page }) => {
    await open(page, '/pedidos', 'seller', true);
    await expect(page.getByTestId('sales-empty')).toBeVisible();
    await expect(page.getByTestId('buys-empty')).toBeVisible();
    await expect(page.getByTestId('home-summary')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Crear link de venta' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ver productos' })).toBeVisible();
    await expect(page.getByTestId('rules-link')).toBeVisible();
    await expectNoScroll(page);
    if (test.info().project.name === 'webkit-iphone-se') { await settle(page); await page.screenshot({ path: 'test-results/home-vacio.png' }); }
    await page.getByRole('button', { name: 'Ver productos' }).click();
    await expect(page).toHaveURL(/\/comprar/);
  });

  test('HOME-03 muchas ventas: las que caben sin scroll y "Ver todas" abre la lista completa', async ({ page }) => {
    await open(page, '/vender', 'seller', true);
    await page.evaluate(async () => { const d = (window as any).__meteoritoDemo; d.setBuyer('B'); for (let i = 1; i <= 9; i++) await d.seed('creado', { title: `Producto ${i}`, price_crc: 1000 * i, single: true }); });
    await open(page, '/pedidos', 'seller');
    const more = page.getByRole('button', { name: 'Ver todas · 9 (ventas)' });
    await expect(more).toBeVisible();
    const shown = await page.locator('[data-testid^="home-sale-row"]').count();
    expect(shown).toBeGreaterThanOrEqual(2); expect(shown).toBeLessThan(9);
    await expectNoScroll(page);
    await more.click();
    // la hoja trae las 9 (Home sigue montado debajo con las suyas)
    await expect.poll(() => page.locator('[data-testid^="home-sale-row"]').count()).toBeGreaterThanOrEqual(9 + 2);
    for (let i = 1; i <= 9; i++) await expect(page.locator('[data-testid^="home-sale-row"]').filter({ hasText: `Producto ${i}` }).last()).toBeAttached();
    await page.locator('[data-testid^="home-sale-row"]').filter({ hasText: 'Producto 1' }).filter({ hasText: '₡1 000' }).last().click();
    await expect(page.getByText('Compartir link').last()).toBeVisible(); // hoja del link de siempre
  });

  test('HOME-04 Mi tienda desde Home', async ({ page }) => {
    await open(page, '/pedidos', 'seller', true);
    await page.getByRole('button', { name: 'Mi tienda' }).click();
    await expect(page).toHaveURL(/\/(mi-tienda|t\/valeria)/);
  });
});
