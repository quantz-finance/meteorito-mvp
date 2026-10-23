import { test, expect } from '@playwright/test';
import { open, seed, orderStatus, DEMO_PIN, expectNoScroll } from './helpers';

test.describe('Comprador sin cuenta + ciclo de custodia (demo)', () => {
  test('COM-01 paga por SINPE con "Ya pagué" y ve su PIN', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const slug = await seed(page, 'creado');
    await open(page, `/p/${slug}`, 'buyer');
    await expect(page.getByText('Disponible')).toBeVisible();
    await page.getByText(/Pagar en custodia/).last().click();
    await expect(page.getByText('Paga por SINPE Móvil')).toBeVisible();
    await expect(page.getByText(`Referencia MET-${slug.toUpperCase()}`)).toBeVisible();
    await page.getByText('Ya pagué', { exact: true }).click();
    await expect(page.getByText(DEMO_PIN)).toBeVisible();
    expect(await orderStatus(page, slug)).toBe('fondeado');
  });

  test('COM-02 recargar a mitad del pago retoma el mismo pedido (no crea otro)', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const slug = await seed(page, 'creado');
    await open(page, `/p/${slug}`, 'buyer');
    await page.getByText(/Pagar en custodia/).last().click();
    await expect(page.getByText('Paga por SINPE Móvil')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Esperando pago').first()).toBeVisible();
    await page.getByText(/Pagar en custodia|Continuar pago/).last().click();
    await page.getByText('Ya pagué', { exact: true }).click();
    expect(await orderStatus(page, slug)).toBe('fondeado');
    const n = await page.evaluate(() => Object.keys(JSON.parse(sessionStorage.getItem('meteorito:demo:v1')!).orders).length);
    expect(n).toBe(1);
  });

  test('ESC-01 ciclo completo: pagado → enviado → PIN → liberado', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const slug = await seed(page, 'fondeado');
    await open(page, '/pedidos', 'seller');
    await page.getByText('Bici de montaña').first().click();
    await page.getByPlaceholder('Encuentro, envío, número de guía…').fill('Entrega en Escazú');
    await page.getByText('Marcar como enviado').last().click();
    await expect.poll(() => orderStatus(page, slug)).toBe('enviado');
    await open(page, '/pedidos', 'seller');
    await page.getByText('Bici de montaña').first().click();
    await page.getByPlaceholder('••••••').fill(DEMO_PIN);
    await page.getByText('Confirmar PIN y cobrar').click();
    await expect.poll(() => orderStatus(page, slug)).toBe('liberado');
    await expect(page.getByText(/¡Cobrado!/).first()).toBeVisible();
  });

  test('ESC-02 PIN incorrecto no libera', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const slug = await seed(page, 'enviado');
    await open(page, '/pedidos', 'seller');
    await page.getByText('Bici de montaña').first().click();
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
    await open(page, '/pedidos', 'seller');
    await page.getByText('Bici de montaña').first().click();
    await expect(page.getByPlaceholder('••••••')).toHaveCount(0);
  });
});
