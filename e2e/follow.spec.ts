// Seguir vendedores (demo): botón Seguir / Siguiendo en el perfil y en la tarjeta del feed, el mismo estado en las dos,
// número de seguidores (nunca quiénes), sin scroll horizontal en iPhone SE.
import { test, expect } from '@playwright/test';
import { open, settle } from './helpers';

test('FOLLOW-01 seguir desde el perfil: Siguiendo + seguidores; la tarjeta del feed lo muestra igual', async ({ page }) => {
  await open(page, '/t/jose-games', 'buyer', true);
  const count = page.getByTestId('followers-count');
  await expect(count).toContainText('seguidores');
  const before = Number((await count.innerText()).match(/\d+/)![0]);
  const btn = page.getByTestId('follow-profile');
  await expect(btn).toHaveAccessibleName('Seguir a José Games');
  await btn.click();
  await expect(btn).toHaveAccessibleName('Dejar de seguir a José Games');
  await expect(btn).toContainText('Siguiendo');
  await expect(count).toContainText(String(before + 1));
  await settle(page);
  const w = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth }));
  expect(w.sw, 'scroll horizontal').toBeLessThanOrEqual(w.iw + 1);
  await open(page, '/comprar', 'buyer', true);
  await expect(page.getByRole('button', { name: 'Dejar de seguir a José Games' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Dejar de seguir a José Games' }).first().click();
  await expect(page.getByRole('button', { name: 'Seguir a José Games' }).first()).toBeVisible();
});

test('FOLLOW-02 Siguiendo: vacío en tuteo sin seguir a nadie; después solo la tienda que sigues, con filtro y buscador', async ({ page }, info) => {
  await open(page, '/comprar', 'buyer', true);
  const forYou = page.getByRole('tab', { name: 'Para ti' });
  const siguiendo = page.getByRole('tab', { name: 'Siguiendo' });
  await expect(forYou).toHaveAttribute('aria-selected', 'true'); // Para ti por defecto
  await expect(page.getByTestId('feed-card').first()).toBeVisible();
  await siguiendo.click();
  await expect(siguiendo).toHaveAttribute('aria-selected', 'true');
  const empty = page.getByTestId('feed-following-empty');
  await expect(empty).toContainText('Aún no sigues tiendas');
  await expect(empty).toContainText('Cuando sigas una, sus publicaciones aparecen aquí.');
  await expect(page.getByTestId('feed-card')).toHaveCount(0);
  await expect(page.getByTestId('feed-filter')).toBeVisible(); // filtro y buscador siguen arriba
  await expect(page.getByLabel('Buscar productos')).toBeVisible();
  for (const n of ['Para ti', 'Siguiendo']) {
    const fs = await page.getByRole('tab', { name: n }).locator('div[dir="auto"]').first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    expect(fs, `"${n}" 16 px`).toBeGreaterThanOrEqual(16);
  }
  if (info.project.name === 'webkit-iphone-se') { await settle(page); await page.screenshot({ path: 'test-results/siguiendo-vacio.png' }); }
  // Sigue a José Games desde Para ti; en Siguiendo aparecen solo sus publicaciones (sin ventas de ejemplo).
  await page.getByRole('button', { name: 'Ver Para ti' }).click();
  await expect(forYou).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Seguir a José Games' }).first().click();
  await expect(page.getByRole('button', { name: 'Dejar de seguir a José Games' }).first()).toBeVisible();
  await siguiendo.click();
  // Solo José Games (se espera a que llegue la página de Siguiendo: la de Para ti se reemplaza).
  await expect.poll(async () => [...new Set(await page.getByTestId('feed-card').getByRole('link', { name: /^Ver el perfil de / })
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))))].join('|')).toBe('Ver el perfil de José Games');
  await expect(page.getByTestId('feed-sale')).toHaveCount(0);
  await expect(page.getByTestId('feed').getByTestId('demo-info')).toHaveCount(0); // sin productos de ejemplo
  // El filtro aplica dentro de Siguiendo: José Games tiene identidad confirmada, en Sin confirmar no aparece.
  await page.getByRole('tab', { name: 'Sin confirmar' }).click();
  await expect(page.getByText('Nada nuevo de las tiendas que sigues')).toBeVisible();
  await page.getByRole('button', { name: 'Ver Identidad confirmada' }).click();
  await expect(page.getByTestId('feed-card').first()).toBeVisible();
  // El buscador también.
  await page.getByLabel('Buscar productos').fill('zzzz nada');
  await expect(page.getByText(/No encontramos/)).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar búsqueda' }).first().click();
  await expect(page.getByTestId('feed-card').first()).toBeVisible();
  await settle(page);
  const w = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth }));
  expect(w.sw, 'scroll horizontal').toBeLessThanOrEqual(w.iw + 1);
  if (info.project.name === 'webkit-iphone-se') {
    await expect(page.getByTestId('feed-filter')).toBeInViewport(); // las pestañas no empujan el filtro fuera de la pantalla
    await page.screenshot({ path: 'test-results/siguiendo-feed.png' });
  }
});
