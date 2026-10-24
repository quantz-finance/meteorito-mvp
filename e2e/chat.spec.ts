// Chat comprador-vendedor (demo): chat dentro de una compra (comprador en el seguimiento, vendedor en la venta).
// iPhone SE: sin scroll horizontal, inputs a 16 px, sin palabras prohibidas ni voseo.
import { test, expect, type Page } from '@playwright/test';
import { BANNED, open, openSellerRow, seed, settle, VOSEO } from './helpers';

const OUT = process.env.CHAT_SHOTS; // carpeta para capturas (opcional, solo iPhone SE)
async function shot(page: Page, name: string) {
  if (!OUT || test.info().project.name !== 'webkit-iphone-se') return;
  await settle(page);
  await page.screenshot({ path: `${OUT}/chat-${name}.png` });
}
async function noHScroll(page: Page) {
  const w = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth }));
  expect(w.sw, 'scroll horizontal').toBeLessThanOrEqual(w.iw + 1);
}
async function cleanCopy(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(BANNED);
  expect(text).not.toMatch(VOSEO);
}
/** Espera a que ningún mensaje propio siga "Enviando" (antes de cambiar de pantalla). */
async function delivered(page: Page) {
  await expect(page.getByTestId('bubble-mine').last()).toHaveAttribute('aria-label', /\. (Enviado|Leído)$/);
}
async function input16(page: Page) {
  const fs = await page.getByTestId('chat-input').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fs).toBeGreaterThanOrEqual(16);
}

test('CHAT-02 chat dentro de una compra: comprador en el seguimiento, vendedor en la venta', async ({ page }) => {
  await open(page, '/comprar', 'buyer', true);
  const slug = await seed(page, 'fondeado', 'Bici de montaña');
  await page.evaluate((s) => localStorage.setItem(`meteorito:guest:pin:${s}`, '482915'), slug); // dispositivo del comprador
  await open(page, `/p/${slug}`, 'buyer');
  const card = page.getByTestId('order-chat');
  await expect(card).toBeVisible();
  await page.getByTestId('order-chat-buyer').click();
  await expect(page).toHaveURL(/\/chat\?c=.+&r=b/);
  await expect(page.getByTestId('chat-context')).toContainText('Bici de montaña');
  await expect(page.getByTestId('chat-quick')).toHaveCount(0); // ya pagó: sin respuestas rápidas de antes de comprar
  await page.getByTestId('chat-input').fill('Hola, ¿cuándo me lo envías? Mi número es 8888 8888');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('bubble-mine').filter({ hasText: 'cuándo me lo envías' })).toBeVisible();
  await delivered(page);
  await expect(page.getByTestId('chat-pay-inside')).toHaveCount(0); // ya pagó: sin aviso
  await input16(page);
  await noHScroll(page);
  await cleanCopy(page);
  await shot(page, 'order');

  // Vendedor: desde la venta en Home (hoja del pedido) -> "Chatear con el comprador"
  await openSellerRow(page, /Pagado/, /Chatear con el comprador/);
  await page.getByTestId('order-chat-seller').click();
  await expect(page).toHaveURL(/\/chat\?c=.+&r=s/);
  await expect(page.getByTestId('chat-context')).toContainText('Bici de montaña');
  await expect(page.getByTestId('bubble-theirs').filter({ hasText: 'cuándo me lo envías' })).toBeVisible();
  // Opciones del vendedor: Reportar y Bloquear
  await page.getByRole('button', { name: 'Opciones de la conversación' }).click();
  await expect(page.getByText('Reportar', { exact: true })).toBeVisible();
  await page.getByText('Bloquear conversación', { exact: true }).click();
  await expect(page.getByText('Bloqueaste esta conversación. Nadie puede escribir.')).toBeVisible();
});
