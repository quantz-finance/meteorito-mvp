// Comprar: feed tipo red social + buscador + filtro de verificación, y perfil público del vendedor (/t/<usuario>). Demo.
import { test, expect } from '@playwright/test';
import { expectInputs16, open, settle, VOSEO } from './helpers';

const noHScroll = async (page: import('@playwright/test').Page) => {
  const w = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth }));
  expect(w.sw, 'scroll horizontal').toBeLessThanOrEqual(w.iw + 1);
};

test.describe('Comprar: feed y perfil', () => {
  test('FEED-01 arriba Facebook/invitar/pagar; feed de verificados con tarjetas; filtro Todos; buscar sin acentos; vacío con sugerencia', async ({ page }) => {
    await open(page, '/comprar', 'buyer', true);
    await expect(page.getByRole('button', { name: 'Importar de Facebook' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Invitar a un vendedor' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pagar un link' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Verificados' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('feed-card').first()).toBeVisible();
    expect(await page.getByTestId('feed-card').count()).toBeGreaterThan(1);
    const verifiedCards = await page.getByTestId('feed-card').count();
    await page.getByRole('tab', { name: 'Todos' }).click();
    await expect.poll(() => page.getByTestId('feed-card').count()).toBeGreaterThan(verifiedCards);
    const search = page.getByLabel('Buscar productos');
    await search.fill('PLÁYSTATION');
    await expect(page.getByText('Resultados')).toBeVisible();
    await expect(page.getByTestId('feed-card')).toHaveCount(2);
    await expectInputs16(page);
    await search.fill('zzzz nada');
    await expect(page.getByText(/No encontramos/)).toBeVisible();
    await page.getByRole('button', { name: 'Limpiar búsqueda' }).first().click();
    await expect(page.getByText('Lo más nuevo')).toBeVisible();
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
    await expect(page.getByText('miembro desde')).toBeVisible();
    await expect(page.getByRole('button', { name: /WhatsApp/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Compartir perfil' }).first()).toBeVisible();
    await expect(page.getByTestId('reviews')).toContainText('compra verificada');
    await settle(page);
    await noHScroll(page);
  });

  test('FEED-03 vendedor sin verificar: nota sutil y sin WhatsApp si no lo publicó', async ({ page }) => {
    await open(page, '/t/ana-solis', 'buyer', true);
    await expect(page.getByTestId('unverified-note')).toHaveText(/Vendedor sin verificar/);
    await expect(page.getByRole('button', { name: /WhatsApp/ })).toHaveCount(0);
    await expect(page.getByText(/Todavía no tiene reseñas/)).toBeVisible();
  });

  test('FEED-04 feed vacío: estado vacío bonito con acción', async ({ page }) => {
    await open(page, '/comprar?feed=empty', 'buyer', true);
    await expect(page.getByText('Todavía no hay vendedores verificados')).toBeVisible();
    await page.getByRole('button', { name: 'Ver todos' }).click();
    await expect(page.getByText('Todavía no hay publicaciones')).toBeVisible();
  });
});
