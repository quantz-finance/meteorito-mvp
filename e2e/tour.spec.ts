// Tour guiado con cuenta (demo, iPhone SE / iPhone 13 / Pixel 7): la primera vez en Vender arranca solo y resalta
// "Generar link"; "Ver recorrido" en Mi cuenta cierra la hoja y lo abre de nuevo (destinos reales: pestañas y "Cómo funciona").
// El tour no arranca solo en navegadores automatizados: aquí se activa con el flag de e2e (lib/tour.ts).
import { expect, test } from '@playwright/test';
import { open } from './helpers';
import { TOUR_E2E_KEY, TOUR_STEPS } from '../lib/tour';

test('TOUR-01 vendedor: arranca solo en Vender (resalta Generar link), una sola vez; "Ver recorrido" en Mi cuenta lo abre de nuevo', async ({ page }) => {
  await page.addInitScript((k) => localStorage.setItem(k, '1'), TOUR_E2E_KEY);
  await open(page, '/vender', 'seller', true);
  const tour = page.getByTestId('tour');
  await expect(tour).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour-title')).toHaveText(TOUR_STEPS[1].title);
  await expect.poll(() => tour.getAttribute('data-tour-target')).toBe('launch-space');
  await expect(page.getByTestId('tour-spot')).toBeInViewport();
  await page.getByTestId('tour-skip').click();
  await expect(tour).toHaveCount(0);
  // Home -> Mi cuenta -> "Ver recorrido"
  await open(page, '/pedidos', 'seller');
  await page.waitForTimeout(2000);
  await expect(tour).toHaveCount(0); // ya visto
  await page.getByLabel('Mi cuenta', { exact: true }).click();
  await page.getByTestId('tour-button').click();
  await expect(tour).toBeVisible();
  await expect(page.getByText('Cerrar sesión')).toHaveCount(0); // la hoja de Mi cuenta se cerró
  await expect(page.getByTestId('tour-title')).toHaveText(TOUR_STEPS[0].title);
  await page.getByTestId('tour-next').click(); await page.getByTestId('tour-next').click(); await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour-title')).toHaveText(TOUR_STEPS[3].title);
  // Home ya no tiene pestaña (dos secciones): el paso de entrega se muestra centrado en Home.
  // Paso 4 (el texto más largo): la tarjeta entera y sus botones caben en la pantalla (iPhone SE)
  const box = (await tour.boundingBox())!, vp = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
  await expect(page.getByTestId('tour-next')).toBeInViewport();
  await expect(page.getByTestId('tour-skip')).toBeInViewport();
  await page.getByTestId('tour-next').click();
  await expect.poll(() => tour.getAttribute('data-tour-target')).toBe('rules-link');
  await page.getByTestId('tour-next').click(); // Listo
  await expect(tour).toHaveCount(0);
});
