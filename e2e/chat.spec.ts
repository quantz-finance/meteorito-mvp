// Chat comprador-vendedor (demo): "Enviar mensaje" en la tienda, respuestas rápidas, aviso suave de pagar dentro,
// bandejas con insignia (vendedor en Home, comprador en Mis compras, sin pestaña nueva) y chat dentro de una compra.
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

test('CHAT-01 tienda -> Enviar mensaje: respuestas rápidas, envío optimista, aviso suave; bandejas con insignia', async ({ page }) => {
  await open(page, '/t/valeria', 'buyer', true);
  const btn = page.getByTestId('store-chat');
  await expect(btn).toBeVisible();
  await expect(btn).toContainText('Enviar mensaje');
  await noHScroll(page);
  await shot(page, 'store-button');
  await btn.click();
  await expect(page).toHaveURL(/\/chat\?c=[A-Za-z0-9_-]{32}&r=b/);
  const quick = page.getByTestId('chat-quick');
  await expect(quick).toBeVisible();
  for (const q of ['¿Sigue disponible?', '¿Haces envíos?', '¿Precio final?']) await expect(quick.getByText(q, { exact: true })).toBeVisible();
  await input16(page);
  await quick.getByText('¿Sigue disponible?', { exact: true }).click();
  await expect(page.getByTestId('bubble-mine').filter({ hasText: '¿Sigue disponible?' })).toBeVisible();
  await expect(page.getByLabel(/Enviado|Leído/).first()).toBeVisible();
  // Contacto antes de pagar: aviso suave, no bloquea
  await page.getByTestId('chat-input').fill('Si quieres me escribes al 8888 8888');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('bubble-mine').filter({ hasText: '8888 8888' })).toBeVisible();
  await expect(page.getByTestId('chat-pay-inside')).toContainText('Para que tu compra quede en custodia, paga dentro de Meteorito.');
  await noHScroll(page);
  await cleanCopy(page);
  await delivered(page);
  await shot(page, 'quick-replies');

  // Vendedor: insignia en Home -> bandeja -> conversación -> responde
  await open(page, '/pedidos', 'seller');
  await expect(page.getByTestId('seller-inbox-badge')).toHaveText('1');
  await noHScroll(page);
  await shot(page, 'seller-home-badge');
  await page.getByTestId('seller-inbox').click();
  await expect(page).toHaveURL(/\/mensajes\?as=s/);
  const row = page.getByTestId('inbox-row').first();
  await expect(row).toContainText('Comprador ·');
  await expect(row.getByTestId('inbox-unread')).toBeVisible();
  await noHScroll(page);
  await cleanCopy(page);
  await shot(page, 'seller-inbox');
  await row.click();
  await expect(page.getByTestId('bubble-theirs').filter({ hasText: '¿Sigue disponible?' })).toBeVisible();
  await expect(page.getByTestId('chat-quick')).toHaveCount(0); // solo el comprador
  await page.getByTestId('chat-input').fill('Sí, sigue disponible. Te lo envío por Correos.');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('bubble-mine').filter({ hasText: 'sigue disponible' })).toBeVisible();
  await delivered(page);

  // Comprador: punto en Mis compras + fila "Tus mensajes" con insignia -> bandeja
  await open(page, '/comprar/compras', 'buyer');
  await expect(page.getByTestId('compras-unread')).toBeVisible();
  const inbox = page.getByTestId('buyer-inbox');
  await expect(inbox).toBeVisible();
  await expect(page.getByTestId('buyer-inbox-badge')).toHaveText('1');
  await noHScroll(page);
  await shot(page, 'buyer-compras-badge');
  await page.getByTestId('buyer-inbox').click();
  await expect(page).toHaveURL(/\/mensajes\?as=b/);
  await expect(page.getByTestId('inbox-row').first()).toContainText('Valeria');
  await noHScroll(page);
  await cleanCopy(page);
  await shot(page, 'buyer-inbox');
  await page.getByTestId('inbox-row').first().click();
  await expect(page.getByTestId('bubble-theirs').filter({ hasText: 'sigue disponible' })).toBeVisible();
});

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

test('CHAT-03 producto sin pagar: "Preguntar al vendedor" abre el chat ligado al producto', async ({ page }) => {
  await open(page, '/comprar', 'buyer', true);
  await open(page, '/t/valeria', 'buyer');
  await expect(page.getByTestId('store-chat')).toBeVisible();
  // En la ficha de un producto sin pagar: "Preguntar al vendedor"
  const slug = await seed(page, 'creado', 'Silla gamer');
  await open(page, `/p/${slug}`, 'buyer');
  await expect(page.getByTestId('ask-seller')).toContainText('Preguntar al vendedor');
  await page.getByTestId('ask-seller').click();
  await expect(page.getByTestId('chat-context')).toContainText('Silla gamer');
  await expect(page.getByTestId('chat-quick')).toBeVisible();
});
