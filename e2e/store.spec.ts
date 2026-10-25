// Una sola página de tienda: /t/<usuario> es el perfil público y también "Mi tienda". Las herramientas del dueño solo
// con su sesión en su propia tienda; compartir siempre visible. Demo (el vendedor del demo es "valeria").
import { test, expect } from '@playwright/test';
import { expectInputs16, open, settle, BANNED, VOSEO } from './helpers';

const noHScroll = async (page: import('@playwright/test').Page) => {
  const w = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth }));
  expect(w.sw, 'scroll horizontal').toBeLessThanOrEqual(w.iw + 1);
};

test.describe('Tienda: una sola página', () => {
  test('STORE-01 Mi tienda abre /t/<usuario> con las herramientas del dueño y compartir', async ({ page }, info) => {
    await open(page, '/mi-tienda', 'seller', true);
    await expect(page).toHaveURL(/\/t\/valeria/);
    await expect(page.getByTestId('profile-hero')).toBeVisible();
    await expect(page.getByTestId('owner-tools')).toBeVisible();
    await expect(page.getByTestId('share-store')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Compartir mi tienda' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cambiar la foto de tu tienda' })).toBeVisible();
    for (const t of ['Editar nombre o usuario', 'Mi cuenta', 'Historial de ventas']) await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
    await settle(page); await noHScroll(page); await expectInputs16(page);
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(BANNED); expect(text).not.toMatch(VOSEO);
    if (info.project.name === 'webkit-iphone-se') await page.screenshot({ path: 'test-results/tienda-duenio.png' });
    await page.getByText('Editar nombre o usuario', { exact: true }).click();
    await expect(page.getByLabel('Nombre de usuario')).toBeVisible();
    await expectInputs16(page);
  });

  test('STORE-02 visitante: misma página, compartir visible, sin herramientas del dueño', async ({ page }, info) => {
    await open(page, '/t/valeria', 'buyer', true);
    await expect(page.getByTestId('profile-hero')).toBeVisible();
    await expect(page.getByTestId('share-store')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Compartir perfil' }).first()).toBeVisible();
    await expect(page.getByTestId('owner-tools')).toHaveCount(0);
    for (const t of ['Editar nombre o usuario', 'Mi cuenta', 'Historial de ventas', 'Tu tienda']) await expect(page.getByText(t, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cambiar la foto de tu tienda' })).toHaveCount(0);
    await settle(page); await noHScroll(page);
    if (info.project.name === 'webkit-iphone-se') await page.screenshot({ path: 'test-results/tienda-visitante.png' });
  });

  test('STORE-05 tarjeta horizontal: foto, nombre, seguidores, reseñas y Seguir a la vista sin scroll', async ({ page }) => {
    await open(page, '/t/jose-games', 'buyer', true);
    const hero = page.getByTestId('profile-hero');
    await expect(hero.getByRole('heading', { name: 'José Games' })).toBeVisible();
    await expect(hero.getByText('@jose-games')).toBeVisible();
    await expect(hero.getByTestId('followers-count')).toBeVisible();
    await expect(hero.getByText(/reseña|sin reseñas/).first()).toBeVisible();
    await expect(hero.getByText('miembro desde')).toBeVisible();
    await expect(page.getByTestId('store-cover')).toHaveCount(0);
    const follow = page.getByTestId('follow-profile');
    await expect(follow).toBeVisible();
    await settle(page); await noHScroll(page);
    const vh = page.viewportSize()!.height;
    expect((await hero.boundingBox())!.y + (await hero.boundingBox())!.height, 'tarjeta completa en la primera pantalla').toBeLessThanOrEqual(vh);
  });

  test('STORE-03 compartir: navigator.share con el link de la tienda; sin share, copia el link', async ({ page }) => {
    await page.addInitScript(() => { (window as any).__shared = null; (navigator as any).share = async (d: unknown) => { (window as any).__shared = d; }; });
    await open(page, '/t/valeria', 'buyer', true);
    await page.getByTestId('share-store').click();
    await expect.poll(() => page.evaluate(() => (window as any).__shared?.url ?? '')).toMatch(/\/t\/valeria$/);
  });

  test('STORE-04 sin navigator.share: copia el link y avisa', async ({ page }) => {
    await page.addInitScript(() => { try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch { /* */ } });
    await open(page, '/mi-tienda', 'seller', true);
    await expect(page).toHaveURL(/\/t\/valeria/);
    await page.getByTestId('share-store').click();
    await expect(page.getByText('Link copiado').first()).toBeVisible();
  });
});
