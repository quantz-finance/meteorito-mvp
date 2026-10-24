import { test, expect } from '@playwright/test';
import { open, seed, orderStatus, DEMO_PIN, PAID, expectNoScroll, openSellerRow, takePhoto } from './helpers';

test.describe('Comprador sin cuenta + ciclo de custodia (demo)', () => {
  test('COM-01 paga por SINPE con "Ya pagué" y ve su PIN', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const slug = await seed(page, 'creado');
    await open(page, `/p/${slug}`, 'buyer');
    await expect(page.getByText('Disponible')).toBeVisible();
    await page.getByText(/Pagar en custodia/).last().click();
    await expect(page.getByText('Paga por SINPE Móvil')).toBeVisible();
    await expect(page.getByText(/Referencia MET-DEMO\d+/)).toBeVisible();
    await page.getByText('Ya pagué', { exact: true }).click();
    await expect(page.getByText(PAID).first()).toBeVisible();
    await expect(page.getByText(DEMO_PIN)).toHaveCount(0);
    // Producto permanente (como producción): el comprador queda en su propio pedido; el producto sigue disponible
    const mine = page.url().match(/\/p\/(demo\d+)/)![1];
    expect(mine).not.toBe(slug);
    expect(await orderStatus(page, mine)).toBe('fondeado');
    expect(await orderStatus(page, slug)).toBe('creado');
  });

  test('COM-02 recargar a mitad del pago retoma el mismo pedido (no crea otro)', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const slug = await seed(page, 'creado');
    await open(page, `/p/${slug}`, 'buyer');
    await page.getByText(/Pagar en custodia/).last().click();
    await expect(page.getByText('Paga por SINPE Móvil')).toBeVisible();
    await page.reload(); // la URL del pedido propio trae ?pay=1: la hoja SINPE se vuelve a abrir sola
    await expect(page.getByText('Esperando pago').first()).toBeVisible();
    await page.getByText('Ya pagué', { exact: true }).click();
    await expect(page.getByText(PAID).first()).toBeVisible();
    await expect(page.getByText(DEMO_PIN)).toHaveCount(0);
    const mine = page.url().match(/\/p\/(demo\d+)/)![1];
    expect(await orderStatus(page, mine)).toBe('fondeado');
    const n = await page.evaluate(() => Object.keys(JSON.parse(sessionStorage.getItem('meteorito:demo:v1')!).orders).length);
    expect(n).toBe(2); // producto + un solo pedido
  });

  test('ESC-01 ciclo completo: pagado → enviado → PIN → liberado', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const slug = await seed(page, 'fondeado');
    await openSellerRow(page, 'Pagado · fondos apartados', /Ya lo envié/);
    await takePhoto(page, 'Tomar foto del envío'); // obligatoria, con la cámara de la app
    await page.getByText('Ya lo envié', { exact: true }).last().click();
    await expect.poll(() => orderStatus(page, slug)).toBe('enviado');
    await openSellerRow(page, /Enviado|En disputa/, '••••••');
    await page.getByPlaceholder('••••••').fill(DEMO_PIN);
    await page.getByText('Confirmar PIN y cobrar').click();
    await expect.poll(() => orderStatus(page, slug)).toBe('liberado');
    await expect(page.getByText(/¡Cobrado!/).first()).toBeVisible();
  });

  test('ESC-02 PIN incorrecto no libera', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const slug = await seed(page, 'enviado');
    await openSellerRow(page, /Enviado|En disputa/, '••••••');
    await page.getByPlaceholder('••••••').fill('000000');
    await page.getByText('Confirmar PIN y cobrar').click();
    await expect(page.getByText(/PIN incorrecto/i).first()).toBeVisible();
    expect(await orderStatus(page, slug)).toBe('enviado');
  });

  test('ESC-03 el comprador confirma "Recibí y está bien" y se libera', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const slug = await seed(page, 'enviado');
    await open(page, `/p/${slug}`, 'buyer');
    await expect(page.getByText(/se libera solo/)).toBeVisible();
    await page.getByText('Recibí y está bien', { exact: true }).click();
    await expect.poll(() => orderStatus(page, slug)).toBe('liberado');
    await expect(page.getByText('¡Listo! Pago liberado')).toBeVisible();
    await page.getByText('Cerrar', { exact: true }).click();
    await expectNoScroll(page);
  });

  test('DIS-01 el comprador abre una disputa y el pedido queda En disputa', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const slug = await seed(page, 'enviado');
    await open(page, `/p/${slug}`, 'buyer');
    await page.getByText('Tengo un problema').first().click();
    await page.getByText('No llegó', { exact: true }).click();
    await page.getByPlaceholder('Cuéntanos qué pasó (opcional)').fill('Nunca llegó el paquete');
    await page.getByText('Reportar problema', { exact: true }).click();
    await expect.poll(() => orderStatus(page, slug)).toBe('en_disputa');
    await expect(page.getByText(/En disputa/).first()).toBeVisible();
  });

  test('DIS-02 el vendedor no puede liberar con PIN un pedido en disputa', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const slug = await seed(page, 'enviado');
    await open(page, `/p/${slug}`, 'buyer');
    await page.getByText('Tengo un problema').first().click();
    await page.getByText('No funciona', { exact: true }).click();
    await page.getByText('Reportar problema', { exact: true }).click();
    await expect.poll(() => orderStatus(page, slug)).toBe('en_disputa');
    await openSellerRow(page, 'En disputa', /Comprador reportó|disputa/i);
    await expect(page.getByPlaceholder('••••••')).toHaveCount(0);
  });
});
