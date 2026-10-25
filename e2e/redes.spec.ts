// Redes del vendedor: las agrega en "Editar mi tienda" y salen como iconos en su perfil público (demo; vendedor "valeria").
import { test, expect } from '@playwright/test';
import { expectInputs16, open, settle, BANNED } from './helpers';

test('REDES-01 edita sus redes y se ven en el perfil público', async ({ page }, info) => {
  const se = info.project.name === 'webkit-iphone-se';
  await open(page, '/t/valeria', 'seller', true);
  await page.getByText('Editar nombre o usuario', { exact: true }).click();
  await page.getByTestId('social-input-instagram').fill('@valeria.cr');
  await page.getByTestId('social-input-website').fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Revisa tu sitio web: usa un link que empiece con https://.')).toBeVisible();
  await page.getByTestId('social-input-website').fill('valeria.cr');
  await page.getByTestId('social-input-tiktok').fill('https://www.tiktok.com/@valeriacr');
  await expectInputs16(page);
  expect(await page.locator('body').innerText()).not.toMatch(BANNED);
  if (se) await page.screenshot({ path: 'test-results/redes-editar.png' });
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByTestId('social-input-instagram')).toHaveCount(0);

  await open(page, '/t/valeria', 'buyer');
  const ig = page.getByTestId('social-instagram');
  await expect(ig).toHaveAttribute('href', 'https://www.instagram.com/valeria.cr');
  await expect(ig).toHaveAttribute('target', '_blank');
  await expect(ig).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  await expect(page.getByTestId('social-tiktok')).toHaveAttribute('href', 'https://www.tiktok.com/@valeriacr');
  await expect(page.getByTestId('social-website')).toHaveAttribute('href', 'https://valeria.cr/');
  await expect(page.getByTestId('social-x')).toHaveCount(0);
  await expect(page.getByTestId('social-youtube')).toHaveCount(0);
  await settle(page);
  const w = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth }));
  expect(w.sw).toBeLessThanOrEqual(w.iw + 1);
  if (se) await page.screenshot({ path: 'test-results/redes-perfil.png' });
});
