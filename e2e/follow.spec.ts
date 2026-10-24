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
