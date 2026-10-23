// Flujos completos en modo demo (lib/demo.ts simula el API igual que producción: producto permanente, pedido por
// comprador, invitación reservada, PIN con bloqueo, liberación automática, resolución de disputa).
import { test, expect, type Page } from '@playwright/test';
import { open, seed, orderStatus, DEMO_PIN, PHOTO, expectNoScroll, openSellerRow } from './helpers';

const demo = (page: Page, fn: string, ...args: unknown[]) => page.evaluate(([f, a]) => (window as any).__meteoritoDemo[f as string](...(a as unknown[])), [fn, args] as const);
const st = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('meteorito:demo:v1') || '{}'));
async function buyerPays(page: Page, product: string, buyer: string): Promise<string> {
  await open(page, `/p/${product}?buyer=${buyer}`, 'buyer');
  await page.getByText(/Pagar en custodia/).last().click();
  await expect(page).toHaveURL(/\/p\/demo\d+\?/);
  await page.getByText('Ya pagué', { exact: true }).click();
  await expect(page.getByText(DEMO_PIN)).toBeVisible();
  return page.url().match(/\/p\/(demo\d+)/)![1];
}

test.describe('Productos permanentes', () => {
  test('PER-01 dos compradores pagan el mismo producto: dos pedidos, el producto sigue disponible y el vendedor ve ambos', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const prod = await seed(page, 'creado');
    const a = await buyerPays(page, prod, 'A');
    const b = await buyerPays(page, prod, 'B');
    expect(a).not.toBe(b);
    const s = await st(page);
    expect(s.orders[prod].status).toBe('creado');
    expect([s.orders[a].status, s.orders[b].status]).toEqual(['fondeado', 'fondeado']);
    await open(page, '/pedidos', 'seller');
    await expect(page.getByRole('button').filter({ hasText: 'Pagado · fondos apartados' })).toHaveCount(2);
    await open(page, '/t/valeria', 'buyer');
    await expect(page.getByText('Bici de montaña')).toBeVisible();
  });

  test('PER-02 el mismo comprador retoma su pedido ("Ver mi pedido") sin crear otro', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const prod = await seed(page, 'creado');
    await open(page, `/p/${prod}`, 'buyer');
    await page.getByText(/Pagar en custodia/).last().click();
    await expect(page).toHaveURL(/pay=1/);
    await open(page, `/p/${prod}`, 'buyer');
    await expect(page.getByText('Ver mi pedido')).toBeVisible();
    await page.getByText(/Pagar en custodia/).last().click();
    await expect(page).toHaveURL(/pay=1/);
    expect(Object.keys((await st(page)).orders).length).toBe(2); // producto + un pedido
  });

  test('PER-03 pausar desde Mi tienda: sale de la tienda pública y el comprador no puede pagar; reactivar lo devuelve', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const prod = await seed(page, 'creado');
    await open(page, '/mi-tienda', 'seller');
    await page.getByText('Bici de montaña').first().click();
    await page.getByText('Pausar ventas', { exact: true }).click();
    await expect.poll(async () => (await st(page)).orders[prod].listing_status).toBe('pausada');
    await open(page, '/t/valeria', 'buyer');
    await expect(page.getByText('Bici de montaña')).toHaveCount(0);
    await open(page, `/p/${prod}`, 'buyer');
    await page.getByText(/Pagar en custodia/).last().click();
    await expect(page.getByText(/pausó este producto/)).toBeVisible();
    await open(page, '/mi-tienda', 'seller');
    await page.getByText('Bici de montaña').first().click();
    await page.getByText('Reactivar', { exact: true }).click();
    await expect.poll(async () => (await st(page)).orders[prod].listing_status).toBe('activa');
  });

  test('PER-04 archivar: sale de Mi tienda y de la tienda pública; los pedidos en curso siguen', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const prod = await seed(page, 'creado');
    const a = await buyerPays(page, prod, 'A');
    await open(page, '/mi-tienda', 'seller');
    await page.getByText('Bici de montaña').first().click();
    await page.getByText('Archivar', { exact: true }).click();
    await expect.poll(async () => (await st(page)).orders[prod].listing_status).toBe('archivada');
    await open(page, '/mi-tienda', 'seller');
    await expect(page.getByText(/TUS PRODUCTOS \(0\)/i)).toBeVisible();
    await open(page, '/t/valeria', 'buyer');
    await expect(page.getByText('Bici de montaña')).toHaveCount(0);
    expect(await orderStatus(page, a)).toBe('fondeado');
  });
});

test.describe('Invitaciones', () => {
  test('INV-05 flujo completo: el comprador invita, el vendedor publica, solo quien invitó puede pagar', async ({ page }) => {
    await open(page, '/i/nueva?buyer=A', 'buyer', true);
    await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('iPhone 13');
    await page.getByPlaceholder('250 000').fill('250000');
    await page.getByRole('button', { name: /Crear invitación/ }).click();
    await expect(page).toHaveURL(/\/i\/inv\d+/);
    await expect(page.getByText('Tu invitación')).toBeVisible();
    const code = page.url().match(/\/i\/(inv\d+)/)![1];
    // El vendedor (otro navegador = otra llave) publica desde la invitación
    await open(page, `/i/${code}?buyer=S`, 'seller');
    await expect(page.getByText('Quieren comprarte')).toBeVisible();
    await page.getByText('Publicar para esta compra').click();
    await expect(page).toHaveURL(/\/vender\?invite=/);
    const title = page.getByPlaceholder('Ej. iPhone 13 de 128 GB');
    if (!(await title.inputValue())) await title.fill('iPhone 13');
    const price = page.getByPlaceholder('0');
    if (await price.isEditable() && !(await price.inputValue())) await price.fill('250000');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('Agregar', { exact: true }).click()]);
    await fc.setFiles(PHOTO);
    await page.getByText('Generar link').click();
    await expect(page.getByText('¡Tu link está listo!')).toBeVisible();
    const s = await st(page);
    expect(s.invites[code].status).toBe('aceptada');
    const slug = s.invites[code].order_slug;
    // Otro comprador no puede pagarlo
    await open(page, `/p/${slug}?buyer=B`, 'buyer');
    await page.getByText(/Pagar en custodia/).last().click();
    await expect(page.getByText(/reservado para quien inició la compra/)).toBeVisible();
    // Quien invitó ve el botón y paga
    await open(page, `/i/${code}?buyer=A`, 'buyer');
    await page.getByText('Ir a pagar en custodia').click();
    await page.getByText(/Pagar en custodia/).last().click();
    await page.getByText('Ya pagué', { exact: true }).click();
    await expect(page.getByText(DEMO_PIN)).toBeVisible();
    expect(await orderStatus(page, slug)).toBe('fondeado');
  });

  test('INV-06 no puedes responder tu propia invitación (mismo navegador)', async ({ page }) => {
    await open(page, '/i/nueva?buyer=A', 'buyer', true);
    await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('iPhone 13');
    await page.getByPlaceholder('250 000').fill('250000');
    await page.getByRole('button', { name: /Crear invitación/ }).click();
    await expect(page).toHaveURL(/\/i\/inv\d+/);
    const code = page.url().match(/\/i\/(inv\d+)/)![1];
    await open(page, `/vender?invite=${code}`, 'seller');
    const title = page.getByPlaceholder('Ej. iPhone 13 de 128 GB');
    if (!(await title.inputValue())) await title.fill('iPhone 13');
    const price = page.getByPlaceholder('0');
    if (await price.isEditable() && !(await price.inputValue())) await price.fill('250000');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('Agregar', { exact: true }).click()]);
    await fc.setFiles(PHOTO);
    await page.getByText('Generar link').click();
    await expect(page.getByText(/propia invitación/)).toBeVisible();
  });

  test('INV-07 cancelar la invitación: el vendedor ve que ya no está disponible', async ({ page }) => {
    await open(page, '/i/nueva?buyer=A', 'buyer', true);
    await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('iPhone 13');
    await page.getByPlaceholder('250 000').fill('250000');
    await page.getByRole('button', { name: /Crear invitación/ }).click();
    await expect(page).toHaveURL(/\/i\/inv\d+/);
    const code = page.url().match(/\/i\/(inv\d+)/)![1];
    await page.getByText('Cancelar invitación').click();
    await expect.poll(async () => (await st(page)).invites[code].status).toBe('cancelada');
    await open(page, `/i/${code}?buyer=S`, 'seller');
    await expect(page.getByText('El comprador canceló esta invitación.')).toBeVisible();
  });
});

test.describe('PIN, liberación automática y disputas', () => {
  test('PIN-02 tres PIN incorrectos bloquean el cobro con PIN', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const slug = await seed(page, 'enviado');
    await openSellerRow(page, 'Enviado', '••••••');
    for (let i = 0; i < 3; i++) {
      await page.getByPlaceholder('••••••').fill('000000');
      await page.getByText('Confirmar PIN y cobrar').click();
      await expect(page.getByText(/PIN incorrecto/i).first()).toBeVisible();
    }
    await page.getByPlaceholder('••••••').fill(DEMO_PIN);
    await page.getByText('Confirmar PIN y cobrar').click();
    await expect(page.getByText(/intentos/i).first()).toBeVisible();
    expect(await orderStatus(page, slug)).toBe('enviado');
  });

  test('PIN-03 + ESC-05 vencido el plazo (10 min) se libera solo, salvo con PIN bloqueado', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const ok = await seed(page, 'enviado');
    const locked = await seed(page, 'enviado', 'Guitarra');
    await page.evaluate((s) => { const d = (window as any).__meteoritoDemo; d.state().orders[s].pin_attempts = 3; }, locked);
    await demo(page, 'advance', 9 * 60_000);
    expect(await demo(page, 'cron')).toEqual([]);
    await demo(page, 'advance', 2 * 60_000);
    expect(await demo(page, 'cron')).toEqual([ok]);
    expect(await orderStatus(page, locked)).toBe('enviado');
    await open(page, `/p/${ok}`, 'buyer');
    await expect(page.getByText('Pago liberado').first()).toBeVisible();
  });

  test('ESC-04 la página del comprador muestra el plazo real de liberación (10 min)', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const slug = await seed(page, 'enviado');
    await open(page, `/p/${slug}`, 'buyer');
    await expect(page.getByText(/se libera solo en (10|9) min/)).toBeVisible();
  });

  test('DIS-06 la lista del vendedor pasa a "En disputa" sola (sin recargar) cuando el comprador reporta', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const slug = await seed(page, 'enviado');
    await open(page, '/pedidos', 'seller');
    await expect(page.getByRole('button').filter({ hasText: 'Enviado' }).filter({ hasNotText: 'Disponible' }).first()).toBeVisible();
    // El comprador reporta (mismo estado simulado; la vista del vendedor sigue abierta)
    await page.evaluate(async (s) => { const st = JSON.parse(sessionStorage.getItem('meteorito:demo:v1')!); st.orders[s].status = 'en_disputa'; st.orders[s].disputed_at = new Date().toISOString(); (window as any).__meteoritoDemo.state().orders[s].status = 'en_disputa'; }, slug);
    await expect(page.getByRole('button').filter({ hasText: /En disputa/ }).first()).toBeVisible({ timeout: 10_000 });
  });

  for (const [pct, label] of [[100, 'Reembolsado'], [0, 'Disputa resuelta: pago al vendedor'], [40, 'Disputa resuelta: 40 % reembolsado']] as const) {
    test(`DIS-05 resolución ${pct} % -> comprador ve "${label}"`, async ({ page }) => {
      await open(page, '/', 'seller', true);
      const slug = await seed(page, 'enviado');
      await open(page, `/p/${slug}`, 'buyer');
      await page.getByText('Tengo un problema').first().click();
      await page.getByText('No funciona', { exact: true }).click();
      await page.getByText('Reportar problema', { exact: true }).click();
      await expect.poll(() => orderStatus(page, slug)).toBe('en_disputa');
      await demo(page, 'resolve', slug, pct);
      await open(page, `/p/${slug}`, 'buyer');
      await expect(page.getByText(label).first()).toBeVisible();
      if (pct > 0) await expect(page.getByText('Pago liberado', { exact: true })).toHaveCount(0);
      await expectNoScroll(page);
    });
  }
});

test.describe('Calificaciones y push (demo)', () => {
  test('CAL-01 el comprador califica 5 estrellas una vez y la tienda muestra el promedio', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const prod = await seed(page, 'creado');
    const slug = await buyerPays(page, prod, 'A'); // pagó en este navegador: aquí puede calificar
    await openSellerRow(page, 'Pagado · fondos apartados', 'Encuentro, envío, número de guía…');
    await page.getByPlaceholder('Encuentro, envío, número de guía…').fill('En persona');
    await page.getByText('Marcar como enviado').last().click();
    await expect.poll(() => orderStatus(page, slug)).toBe('enviado');
    await open(page, `/p/${slug}?buyer=A`, 'buyer');
    await page.getByText('Recibí y está bien', { exact: true }).click();
    await page.getByText('Cerrar', { exact: true }).click();
    await page.getByRole('button', { name: '5 estrellas' }).click();
    await expect(page.getByText('Tu calificación ayuda a otros compradores.')).toBeVisible();
    await expect(page.getByRole('button', { name: '4 estrellas' })).toBeDisabled();
    await open(page, '/t/valeria', 'buyer');
    await expect(page.getByText(/5[.,]0/).first()).toBeVisible();
  });

  test('PSH-02 vendedor activa avisos desde Pedidos y la tarjeta desaparece', async ({ page }) => {
    await open(page, '/pedidos', 'seller', true);
    await page.getByText('Activar', { exact: true }).first().click();
    await expect(page.getByText('Activa las notificaciones para seguir tu venta')).toHaveCount(0);
  });
});
