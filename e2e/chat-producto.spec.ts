// Chat con el producto (demo), estilo Messenger: "Preguntar al vendedor" siempre en la ficha (sin cuenta), tarjeta del
// producto pegada al primer mensaje (abre la ficha), misma conversación con una tarjeta nueva por otro producto de la
// tienda, y la bandeja del vendedor con la miniatura y el título del producto. El dueño no ve el botón.
import { test, expect, type Page } from '@playwright/test';
import { BANNED, open, seed, settle, VOSEO } from './helpers';

const OUT = process.env.CHAT_SHOTS;
async function shot(page: Page, name: string) {
  if (!OUT || test.info().project.name !== 'webkit-iphone-se') return;
  await settle(page);
  await page.screenshot({ path: `${OUT}/chat-producto-${name}.png` });
}
const seedP = (page: Page, title: string, photo: string, price: number) =>
  page.evaluate(([t, p, n]) => (window as any).__meteoritoDemo.seed('creado', { title: t, price_crc: n, photos: [p] }), [title, photo, price] as const);
async function delivered(page: Page) {
  await expect(page.getByTestId('bubble-mine').last()).toHaveAttribute('aria-label', /\. (Enviado|Leído)$/);
}

test('CHATP-01 ficha -> Preguntar al vendedor: tarjeta del producto en el hilo, otro producto reutiliza la conversación, bandeja del vendedor con el producto', async ({ page }) => {
  await open(page, '/comprar', 'buyer', true);
  const bici = await seedP(page, 'Bici de montaña', '/demo-feed/p-bicimtb.jpg', 150000);
  const silla = await seedP(page, 'Cámara réflex', '/demo-feed/p-camara.jpg', 220000);
  await open(page, `/p/${bici}`, 'buyer');
  const ask = page.getByTestId('ask-seller');
  await expect(ask).toBeVisible();
  await expect(ask).toContainText('Preguntar al vendedor');
  expect(await ask.innerText()).not.toMatch(/\p{Extended_Pictographic}/u);
  const box = (await ask.boundingBox())!;
  expect(box.y + box.height, 'visible sin hacer scroll').toBeLessThanOrEqual(page.viewportSize()!.height);
  await shot(page, 'boton');
  await ask.click();
  await expect(page).toHaveURL(new RegExp(`/chat\\?c=[A-Za-z0-9_-]{32}&r=b&src=product&p=${bici}`));
  const token = new URL(page.url()).searchParams.get('c');
  await expect(page.getByTestId('chat-context')).toContainText('Bici de montaña');
  await page.getByTestId('chat-input').fill('Hola, ¿sigue disponible?');
  await page.getByTestId('chat-send').click();
  await delivered(page);
  const card = page.getByTestId('chat-item-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Bici de montaña');
  await expect(card).toContainText('150');
  await expect(card).toHaveAttribute('aria-label', /Ver producto: Bici de montaña/);
  // La tarjeta va pegada ARRIBA del primer mensaje, del lado del comprador.
  const cb = (await card.boundingBox())!, bb = (await page.getByTestId('bubble-mine').first().boundingBox())!;
  expect(cb.y + cb.height).toBeLessThanOrEqual(bb.y + 1);
  expect(cb.x + cb.width).toBeGreaterThan(page.viewportSize()!.width / 2);
  // Un segundo mensaje no repite la tarjeta.
  await page.getByTestId('chat-input').fill('¿Haces envíos?');
  await page.getByTestId('chat-send').click();
  await delivered(page);
  await expect(card).toHaveCount(1);
  await expect(page.getByTestId('chat-pay-pinned')).toContainText('Para que tu compra quede en custodia, paga dentro de Meteorito.');
  await shot(page, 'hilo');
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(BANNED); expect(text).not.toMatch(VOSEO);
  // Tocar la tarjeta abre el producto.
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/p/${bici}`));

  // Otro producto de la misma tienda: misma conversación + tarjeta nueva.
  await open(page, `/p/${silla}`, 'buyer');
  await page.getByTestId('ask-seller').click();
  await expect(page).toHaveURL(new RegExp(`c=${token}&r=b&src=product&p=${silla}`));
  await expect(page.getByTestId('chat-context')).toContainText('Cámara réflex');
  await page.getByTestId('chat-input').fill('¿Y la cámara?');
  await page.getByTestId('chat-send').click();
  await delivered(page);
  await expect(page.getByTestId('chat-item-card')).toHaveCount(2);
  await expect(page.getByTestId('chat-item-card').last()).toContainText('Cámara réflex');

  // Vendedor: la bandeja dice de qué producto vino la pregunta (miniatura + título) y el hilo trae las tarjetas.
  await open(page, '/mensajes?as=s', 'seller');
  const row = page.getByTestId('inbox-row').first();
  await expect(row.getByTestId('inbox-item-thumb')).toBeVisible();
  await expect(row.getByTestId('inbox-item-title')).toContainText('Cámara réflex');
  await shot(page, 'inbox-vendedor');
  await row.click();
  await expect(page.getByTestId('chat-item-card')).toHaveCount(2);
  const sc = (await page.getByTestId('chat-item-card').first().boundingBox())!;
  expect(sc.x, 'del lado del comprador (izquierda para el vendedor)').toBeLessThan(page.viewportSize()!.width / 2);
});

test('CHATP-02 el dueño no ve "Preguntar al vendedor" en su propio producto', async ({ page }) => {
  await open(page, '/comprar', 'buyer', true);
  const slug = await seed(page, 'creado', 'Silla gamer');
  await open(page, `/p/${slug}`, 'seller');
  await expect(page.getByText(/Silla gamer/).first()).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByTestId('ask-seller')).toHaveCount(0);
});

test('CHATP-03 precio actual en la tarjeta; producto borrado: la conversación sigue y la tarjeta dice que ya no está', async ({ page }) => {
  await open(page, '/comprar', 'buyer', true);
  const slug = await seedP(page, 'Bici de montaña', '/demo-feed/p-bicimtb.jpg', 150000);
  await open(page, `/p/${slug}`, 'buyer');
  await page.getByTestId('ask-seller').click();
  await page.getByTestId('chat-input').fill('¿Sigue disponible?');
  await page.getByTestId('chat-send').click();
  await delivered(page);
  const url = page.url();
  const patch = (f: string) => page.evaluate(([s0, f0]) => { const k = 'meteorito:demo:v1'; const st = JSON.parse(sessionStorage.getItem(k)!); (new Function('o', f0))(st.orders[s0]); sessionStorage.setItem(k, JSON.stringify(st)); }, [slug, f] as const);
  await patch('o.price_crc = 120000');
  await page.goto(url);
  await expect(page.getByTestId('chat-item-card')).toContainText('120'); // precio de hoy, no el del mensaje
  await expect(page.getByTestId('chat-item-card')).not.toContainText('150');
  await patch("o.status = 'cancelado'");
  await page.goto(url);
  await expect(page.getByTestId('chat-item-gone')).toContainText('Este producto ya no está disponible');
  await expect(page.getByTestId('chat-item-gone').getByRole('link')).toHaveCount(0);
  await expect(page.getByTestId('chat-item-card')).toHaveCount(0);
  await page.getByTestId('chat-input').fill('¿Lo vas a volver a publicar?');
  await page.getByTestId('chat-send').click();
  await delivered(page); // la conversación sigue
  await shot(page, 'no-disponible');
});
