// Build REAL + backend simulado, como producción ANTES de aplicar la migración 025: el chat no está disponible y la app
// no muestra botones de mensaje ni bandejas; el resto sigue igual.
import { test, expect } from '@playwright/test';
import { reset } from './mock';

test.describe.configure({ mode: 'serial' });
const listing = { slug: 'prod01', kind: 'listing', model: 'Bici de montaña', price_crc: 150000 };

test('MCK-CHAT-01 sin la migración 025: sin "Enviar mensaje" en la tienda ni en el producto, sin bandeja en Mis compras', async ({ page, request }) => {
  await reset(request, [listing]);
  await page.goto('/t/valeria');
  await expect(page.getByTestId('share-store')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('store-chat')).toHaveCount(0);
  await page.goto('/p/prod01');
  await expect(page.getByText(/Pagar en custodia/).last()).toBeVisible();
  await expect(page.getByTestId('ask-seller')).toHaveCount(0);
  await page.goto('/comprar/compras');
  await expect(page.getByTestId('screen-title')).toBeVisible();
  await expect(page.getByTestId('buyer-inbox')).toHaveCount(0);
  await expect(page.getByTestId('compras-unread')).toHaveCount(0);
});
