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
  await expect(page.getByTestId('socials-note')).toHaveText('Meteorito no verifica estas cuentas. Para que tu compra quede en custodia, paga dentro de Meteorito.');
  await settle(page);
  const w = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth }));
  expect(w.sw).toBeLessThanOrEqual(w.iw + 1);
  if (se) await page.screenshot({ path: 'test-results/redes-perfil.png' });

  // Quitarlas: dejar vacío borra la red; sin ninguna, ni iconos ni aviso.
  await open(page, '/t/valeria', 'seller');
  await page.getByText('Editar nombre o usuario', { exact: true }).click();
  for (const k of ['instagram', 'tiktok', 'website']) await page.getByTestId(`social-input-${k}`).fill('');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByTestId('social-input-instagram')).toHaveCount(0);
  await open(page, '/t/valeria', 'buyer');
  await expect(page.getByTestId('profile-hero')).toBeVisible();
  await expect(page.getByTestId('store-socials')).toHaveCount(0);
  await expect(page.getByTestId('socials-note')).toHaveCount(0);
});

// Bug de prod (Rolando no encontraba dónde poner sus redes): fila propia "Tus redes (opcional)" en "Tu tienda" y los iconos
// con el aviso salen en la tarjeta horizontal de la tienda (vista del dueño y página pública), sin desbordar en iPhone SE.
test('REDES-02 el vendedor pone sus redes desde "Tus redes" y salen en su tarjeta y en la página pública', async ({ page }, info) => {
  const NOTE = 'Meteorito no verifica estas cuentas. Para que tu compra quede en custodia, paga dentro de Meteorito.';
  const noOverflow = async () => {
    await settle(page);
    const w = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth }));
    expect(w.sw).toBeLessThanOrEqual(w.iw + 1);
    const vw = page.viewportSize()!.width;
    for (const id of ['store-socials', 'socials-note']) {
      const b = (await page.getByTestId('profile-hero').getByTestId(id).boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.width).toBeLessThanOrEqual(vw + 1);
    }
    // El aviso va pegado a los iconos (justo debajo).
    const icons = (await page.getByTestId('store-socials').boundingBox())!, note = (await page.getByTestId('socials-note').boundingBox())!;
    expect(note.y - (icons.y + icons.height)).toBeLessThan(16);
  };
  await open(page, '/t/valeria', 'seller', true);
  await expect(page.getByTestId('profile-hero').getByTestId('store-socials')).toHaveCount(0); // sin redes: ni iconos ni aviso
  await expect(page.getByTestId('socials-note')).toHaveCount(0);
  const row = page.getByTestId('owner-socials');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Tus redes (opcional)');
  await row.click();
  await expect(page.getByTestId('social-input-instagram')).toBeVisible();
  await expect(page.getByLabel('Tu nombre', { exact: true })).toHaveCount(0); // hoja solo con las redes
  await page.getByTestId('social-input-instagram').fill('@valeria.cr');
  await page.getByTestId('social-input-youtube').fill('@valeriacr');
  await page.getByTestId('social-input-website').fill('valeria.cr');
  await expectInputs16(page);
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByTestId('social-input-instagram')).toHaveCount(0);

  // Vista del dueño: su tarjeta ya las muestra, con el aviso, y la fila "Tus redes" muestra los iconos.
  const hero = page.getByTestId('profile-hero');
  await expect(hero.getByTestId('store-socials').getByRole('link')).toHaveCount(3);
  await expect(hero.getByTestId('socials-note')).toHaveText(NOTE);
  await noOverflow();

  // Página pública (comprador): mismos iconos y aviso en la tarjeta, links canónicos que abren aparte.
  await open(page, '/t/valeria', 'buyer');
  await expect(hero.getByTestId('social-instagram')).toHaveAttribute('href', 'https://www.instagram.com/valeria.cr');
  await expect(hero.getByTestId('social-youtube')).toHaveAttribute('href', 'https://www.youtube.com/@valeriacr');
  await expect(hero.getByTestId('social-website')).toHaveAttribute('href', 'https://valeria.cr/');
  await expect(hero.getByTestId('social-website')).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  await expect(hero.getByTestId('social-tiktok')).toHaveCount(0);
  await expect(hero.getByTestId('socials-note')).toHaveText(NOTE);
  await expect(page.getByTestId('owner-socials')).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toMatch(BANNED);
  await noOverflow();
  if (info.project.name === 'webkit-iphone-se') await page.screenshot({ path: 'test-results/redes-tarjeta-se.png' });
});
