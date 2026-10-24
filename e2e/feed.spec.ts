// Comprar: feed tipo red social + buscador + filtro de verificación, y perfil público del vendedor (/t/<usuario>). Demo.
import { test, expect } from '@playwright/test';
import { expectInputs16, open, settle, VOSEO } from './helpers';

const noHScroll = async (page: import('@playwright/test').Page) => {
  const w = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth }));
  expect(w.sw, 'scroll horizontal').toBeLessThanOrEqual(w.iw + 1);
};

test.describe('Comprar: feed y perfil', () => {
  test('FEED-01 arriba Facebook/invitar/pagar; feed de verificados con tarjetas; filtro Sin confirmar; buscar sin acentos; vacío con sugerencia', async ({ page }) => {
    await open(page, '/comprar', 'buyer', true);
    await expect(page.getByRole('button', { name: 'Importar de un link' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Invitar a un vendedor' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pagar un link' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Identidad confirmada' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('feed-card').first()).toBeVisible();
    expect(await page.getByTestId('feed-card').count()).toBeGreaterThan(1);
    // La lista es virtualizada: en 375x667 (WebKit) solo monta las primeras tarjetas, así que no se cuentan;
    // se comprueba que el filtro cambia: un vendedor sin confirmar no sale en "Identidad confirmada" y sí en "Sin confirmar"
    // (y uno confirmado al revés). Ya no hay "Todos".
    await expect(page.getByRole('tab', { name: 'Todos' })).toHaveCount(0);
    const unconfirmed = page.getByRole('link', { name: 'Ver el perfil de Carlos Bikes' });
    const confirmed = page.getByRole('link', { name: 'Ver el perfil de José Games' });
    await expect(confirmed.first()).toBeAttached();
    await expect(unconfirmed).toHaveCount(0);
    await page.getByRole('tab', { name: 'Sin confirmar' }).click();
    await expect(page.getByRole('tab', { name: 'Sin confirmar' })).toHaveAttribute('aria-selected', 'true');
    await expect(unconfirmed.first()).toBeAttached();
    await expect(confirmed).toHaveCount(0);
    // La búsqueda respeta el filtro activo: "playstation" en Sin confirmar no trae los de José Games (confirmado).
    const search = page.getByLabel('Buscar productos');
    await search.fill('PLÁYSTATION');
    await expect(page.getByText(/No encontramos/)).toBeVisible();
    await page.getByRole('button', { name: 'Buscar en Identidad confirmada' }).click();
    await expect(page.getByRole('tab', { name: 'Identidad confirmada' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Resultados')).toBeVisible();
    await expect(page.getByTestId('feed-card')).toHaveCount(2);
    await expect(page.getByTestId('feed-sale')).toHaveCount(0); // con búsqueda no se mezclan ventas
    await expectInputs16(page);
    await search.fill('zzzz nada');
    await expect(page.getByText(/No encontramos/)).toBeVisible();
    await page.getByRole('button', { name: 'Limpiar búsqueda' }).first().click();
    await expect(page.getByText('Para ti')).toBeVisible();
    await noHScroll(page);
    expect(await page.locator('body').innerText()).not.toMatch(VOSEO);
  });

  test('FEED-02 tocar al vendedor abre su perfil: verificado, estadísticas, WhatsApp, productos y reseñas', async ({ page }) => {
    await open(page, '/comprar', 'buyer', true);
    await page.getByRole('link', { name: 'Ver el perfil de José Games' }).first().click();
    await expect(page).toHaveURL(/\/t\/jose-games/);
    await expect(page.getByRole('heading', { name: 'José Games' })).toBeVisible();
    await expect(page.getByTestId('profile-hero').getByTestId('verified-badge')).toBeVisible();
    await expect(page.getByText('ventas completadas')).toBeVisible();
    await expect(page.getByTestId('sales-outcome')).toContainText('sin problemas');
    await expect(page.getByText('miembro desde')).toBeVisible();
    await expect(page.getByRole('button', { name: /WhatsApp/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Compartir perfil' }).first()).toBeVisible();
    await expect(page.getByTestId('reviews')).toContainText('compra liberada');
    await settle(page);
    await noHScroll(page);
  });

  test('FEED-03 vendedor sin verificar: nota sutil y sin WhatsApp si no lo publicó', async ({ page }) => {
    await open(page, '/t/ana-solis', 'buyer', true);
    await expect(page.getByTestId('unverified-note')).toHaveText(/Identidad sin confirmar/);
    await expect(page.getByRole('button', { name: /WhatsApp/ })).toHaveCount(0);
    await expect(page.getByText(/Todavía no tiene reseñas/)).toBeVisible();
  });

  test('FEED-04 feed vacío: estado vacío bonito con acción', async ({ page }) => {
    await open(page, '/comprar?feed=empty', 'buyer', true);
    await expect(page.getByText('Todavía no hay vendedores con identidad confirmada')).toBeVisible();
    await expect(page.getByTestId('feed-sale')).toHaveCount(0); // sin publicaciones no se inventa nada
    await page.getByRole('button', { name: 'Ver Sin confirmar' }).click();
    await expect(page.getByText('Todavía no hay publicaciones')).toBeVisible();
  });

  test('FEED-05 filtro en dos mitades iguales, cuadrícula de 2 columnas y venta cerrada de ejemplo (iPhone SE)', async ({ page }, info) => {
    await open(page, '/comprar', 'buyer', true);
    await expect(page.getByTestId('feed-card').first()).toBeVisible();
    await settle(page);
    // Filtro: dos botones del mismo ancho y alto, que llenan la fila.
    const [a, b] = await Promise.all(['Identidad confirmada', 'Sin confirmar'].map(async (n) => (await page.getByRole('tab', { name: n }).boundingBox())!));
    expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
    expect(a.height).toBeGreaterThanOrEqual(44);
    const vw = page.viewportSize()!.width;
    expect(a.width + b.width).toBeGreaterThan(vw * 0.8);
    // Cuadrícula: dos tarjetas por fila, cada una ~la mitad.
    const cards = page.locator('[data-testid="feed-card"], [data-testid="feed-sale"]');
    const boxes = await Promise.all([0, 1, 2].map(async (i) => (await cards.nth(i).boundingBox())!));
    expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThanOrEqual(1); // misma fila
    expect(boxes[1].x).toBeGreaterThan(boxes[0].x + boxes[0].width - 1); // al lado
    expect(Math.abs(boxes[0].width - boxes[1].width)).toBeLessThanOrEqual(1);
    expect(boxes[0].width).toBeLessThanOrEqual(vw / 2);
    expect(boxes[0].width).toBeGreaterThan(vw * 0.4);
    expect(boxes[2].y).toBeGreaterThan(boxes[0].y + boxes[0].height - 1); // la tercera, en la fila siguiente
    await noHScroll(page);
    // Venta cerrada de ejemplo: etiqueta "Ejemplo", estrellas, sin montos; tocarla abre la hoja que lo explica.
    const sale = page.getByTestId('feed-sale').first();
    await sale.scrollIntoViewIfNeeded();
    await expect(sale).toContainText('le vendió a');
    await expect(sale).toContainText(/ganó \d estrellas?/);
    await expect(sale.getByTestId('feed-sale-example')).toHaveText('Ejemplo');
    await expect(sale).not.toContainText('₡');
    // La foto de la venta de ejemplo carga (archivo propio en public/demo-feed).
    await expect.poll(() => sale.locator('img').first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0).catch(() => false)).toBe(true);
    const sb = (await sale.boundingBox())!;
    expect(sb.width).toBeLessThanOrEqual(vw / 2);
    // Ningún texto del filtro se corta (… ) en 375 px.
    for (const n of ['Identidad confirmada', 'Sin confirmar']) {
      const t = page.getByRole('tab', { name: n }).locator('div[dir="auto"]').first();
      expect(await t.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), `"${n}" cortado`).toBe(true);
    }
    if (info.project.name === 'webkit-iphone-se') {
      await page.getByText('Lo más nuevo').evaluate((e) => e.scrollIntoView({ block: 'start' }));
      await settle(page); await page.screenshot({ path: 'test-results/feed-2col.png' });
      await sale.evaluate((e) => e.scrollIntoView({ block: 'end' }));
      await settle(page); await page.screenshot({ path: 'test-results/feed-2col-venta.png' });
    }
    const url = page.url();
    await sale.click();
    await expect(page.getByText('Es un ejemplo')).toBeVisible();
    await expect(page.getByText(/son ficticios/)).toBeVisible();
    expect(page.url()).toBe(url); // no abre nada real
    await page.getByRole('button', { name: 'Entendido' }).click();
    expect(await page.locator('body').innerText()).not.toMatch(VOSEO);
  });

  test('FEED-06 filtro arriba sin scroll (iPhone SE)', async ({ page }, info) => {
    test.skip(info.project.name !== 'webkit-iphone-se', 'solo pantalla chica');
    await open(page, '/comprar', 'buyer', true);
    await expect(page.getByTestId('feed-card').first()).toBeVisible();
    await settle(page);
    await expect(page.getByTestId('feed-filter')).toBeInViewport();
    await page.screenshot({ path: 'test-results/feed-filtro-2.png' });
  });
});
