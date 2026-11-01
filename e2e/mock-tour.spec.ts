// Build REAL + backend simulado: tour guiado (components/Tour.tsx, lib/tour.ts) como lo ve quien abre la app sin cuenta.
// Arranca solo UNA vez (primera vez en una pestaña: aquí Comprar), se cierra con "Saltar", no vuelve al recargar y
// "Ver recorrido" (Cómo funciona) lo abre de nuevo. Pasos sin destino en pantalla: centrados, sin resaltar.
// En navegadores automatizados el tour no arranca solo (taparía los demás e2e): este archivo lo activa con el flag.
// Sin reset ni estado del mock: puede correr en paralelo con mock-guest sin pisarlo.
import { test, expect, type Page } from '@playwright/test';
import { TOUR_AUTO_DELAY_MS, TOUR_E2E_KEY, TOUR_SEEN_KEY, TOUR_STEPS } from '../lib/tour';
import { BANNED, VOSEO } from './helpers';

test.beforeEach(async ({ page }) => { await page.addInitScript((k) => localStorage.setItem(k, '1'), TOUR_E2E_KEY); });
const tour = (page: Page) => page.getByTestId('tour');
const title = (page: Page) => page.getByTestId('tour-title');
const attr = (page: Page, a: string) => tour(page).getAttribute(a);
async function expectInViewport(page: Page) {
  const box = (await tour(page).boundingBox())!; const vp = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1); expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 1);
}

test('MCK-TOUR-01 primera vez: arranca solo una vez, "Saltar" lo cierra, no vuelve al recargar; "Ver recorrido" lo abre de nuevo', async ({ page }) => {
  await page.goto('/comprar');
  await expect(tour(page)).toBeVisible({ timeout: 15_000 });
  await expect(title(page)).toHaveText(TOUR_STEPS[0].title);
  await expect(page.getByTestId('tour-count')).toHaveText(`1 de ${TOUR_STEPS.length}`);
  expect(await page.evaluate((k) => localStorage.getItem(k), TOUR_SEEN_KEY)).toBe('1');
  const text = (await tour(page).innerText());
  expect(text).not.toMatch(BANNED); expect(text).not.toMatch(VOSEO);
  // Paso 2 (link de pago): el invitado no tiene Vender; resalta "Pagar con link"
  await page.getByTestId('tour-next').click();
  await expect(title(page)).toHaveText(TOUR_STEPS[1].title);
  await expect.poll(() => attr(page, 'data-tour-target')).toBe('comprar-link');
  await expect(page.getByTestId('tour-spot')).toBeVisible();
  await expectInViewport(page);
  await page.getByTestId('tour-back').click();
  await expect(title(page)).toHaveText(TOUR_STEPS[0].title);
  await page.getByTestId('tour-skip').click();
  await expect(tour(page)).toHaveCount(0);
  // Ya visto: ni al recargar ni en otra pestaña de la app
  await page.reload();
  await expect(page.locator('#root')).not.toBeEmpty();
  await page.waitForTimeout(TOUR_AUTO_DELAY_MS + 1500);
  await expect(tour(page)).toHaveCount(0);
  await page.goto('/comprar/compras');
  await page.waitForTimeout(TOUR_AUTO_DELAY_MS + 1500);
  await expect(tour(page)).toHaveCount(0);
  // "Ver recorrido" en Cómo funciona (Reglas): visible sin scroll, abre desde el paso 1 y se recorre hasta "Listo"
  await page.goto('/como-funciona');
  await expect(page.getByTestId('tour-button')).toBeInViewport();
  await page.getByTestId('tour-button').click();
  await expect(tour(page)).toBeVisible();
  await expect(title(page)).toHaveText(TOUR_STEPS[0].title);
  for (let i = 1; i < TOUR_STEPS.length; i++) {
    await page.getByTestId('tour-next').click();
    await expect(title(page)).toHaveText(TOUR_STEPS[i].title);
    await expect(page.getByTestId('tour-text')).toHaveText(TOUR_STEPS[i].text);
  }
  await expect(page.getByTestId('tour-next')).toHaveText('Listo');
  await expect(page.getByTestId('tour-skip')).toHaveCount(0);
  await page.getByTestId('tour-next').click();
  await expect(tour(page)).toHaveCount(0);
});

test('MCK-TOUR-02 sin destinos en pantalla (Cómo funciona, sin pedidos ni productos): pasos centrados; no arranca solo en links públicos', async ({ page }) => {
  await page.goto('/como-funciona'); // ruta pública que no es pestaña: no abre solo
  await expect(page.getByText('Cómo funciona Meteorito')).toBeVisible();
  await page.waitForTimeout(TOUR_AUTO_DELAY_MS + 1500);
  await expect(tour(page)).toHaveCount(0);
  await page.getByTestId('tour-button').click();
  await expect(tour(page)).toBeVisible();
  for (let i = 0; i < TOUR_STEPS.length; i++) {
    await expect(title(page)).toHaveText(TOUR_STEPS[i].title);
    const id = TOUR_STEPS[i].id;
    if (id === 'reglas') { // único destino en esta pantalla: el propio botón "Ver recorrido"
      await expect.poll(() => attr(page, 'data-tour-target')).toBe('tour-button');
      await expect(page.getByTestId('tour-spot')).toBeVisible();
    } else {
      await expect.poll(() => attr(page, 'data-tour-target')).toBe('none');
      await expect(page.getByTestId('tour-spot')).toHaveCount(0);
    }
    await expectInViewport(page);
    if (i < TOUR_STEPS.length - 1) await page.getByTestId('tour-next').click();
  }
  await page.keyboard.press('Escape'); // Escape (web) / atrás (Android) también lo cierra
  await expect(tour(page)).toHaveCount(0);
});
