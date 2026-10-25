// Herramientas del vendedor (demo): plantilla de anuncio para Facebook, WhatsApp o Marketplace e historial de ventas.
import { test, expect, type Page } from '@playwright/test';
import { open, expectNoScroll, takePhoto } from './helpers';

const SHOTS = process.env.TOOLS_SHOTS; // carpeta para capturas (opcional, p. ej. /workspace/out)
const shot = async (page: Page, name: string) => { if (SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: `${SHOTS}/tools-${name}.png` }); } };

test('TOOLS-01 link listo: plantilla de anuncio con link, acuerdo y custodia; WhatsApp y Facebook o Marketplace', async ({ page }) => {
  await open(page, '/vender', 'seller', true);
  await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('Bici de montaña');
  await page.getByPlaceholder('0').fill('150000');
  await takePhoto(page);
  await page.getByText('Generar link').click();
  await expect(page.getByText('¡Tu link está listo!')).toBeVisible();
  await expect(page.getByLabel('Plantilla de anuncio')).toBeVisible();
  await expectNoScroll(page);
  await shot(page, 'link-listo');
  await page.getByLabel('Plantilla de anuncio').click();
  const preview = page.getByTestId('ad-preview');
  await expect(preview).toContainText('Bici de montaña por ₡150 000.');
  await expect(preview).toContainText('Entrega: Envío · Protección: 7 días desde el envío');
  await expect(preview).toContainText('Pago en custodia con Meteorito');
  await expect(preview).toContainText(/Paga aquí, sin crear cuenta: https:\/\/pago\.meteorito\.app\/p\/demo\d+/);
  await expect(page.getByLabel('WhatsApp', { exact: true })).toHaveAttribute('aria-checked', 'true');
  await shot(page, 'plantilla-whatsapp');
  await page.getByLabel('Facebook o Marketplace', { exact: true }).click();
  await expect(page.getByLabel('Facebook o Marketplace', { exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(preview).toContainText('Cómo es la compra:');
  await expect(preview).toContainText('- Protección: 7 días desde el envío');
  await shot(page, 'plantilla-marketplace');
  await page.getByText('Copiar anuncio', { exact: true }).click();
  await expect(page.getByText('Anuncio copiado')).toBeVisible();
});

test('TOOLS-02 Home: la hoja de un link sin pagar abre la plantilla con su acuerdo (cara a cara)', async ({ page }) => {
  await open(page, '/', 'seller', true);
  await page.evaluate(() => (window as any).__meteoritoDemo.seed('creado', { title: 'Patineta eléctrica', price_crc: 90000, delivery_mode: 'cara_a_cara', single: true }));
  await open(page, '/pedidos', 'seller');
  await page.getByRole('button').filter({ hasText: 'Patineta eléctrica' }).first().click();
  await page.getByLabel('Plantilla de anuncio').click();
  await expect(page.getByTestId('ad-preview')).toContainText('Entrega: Cara a cara · Protección: 24 h');
  await expect(page.getByTestId('ad-preview')).toContainText('Patineta eléctrica por ₡90 000.');
  await shot(page, 'plantilla-desde-home');
});

test('TOOLS-03 historial de ventas: estado, resultado y total cobrado; sin scroll', async ({ page }) => {
  await open(page, '/', 'seller', true);
  await page.evaluate(async () => {
    const d = (window as any).__meteoritoDemo;
    await d.seed('enviado', { title: 'Bici de montaña', price_crc: 150000 });
    d.advance(8 * 86400_000); d.cron(); // liberado al terminar el plazo
    const disp = await d.seed('fondeado', { title: 'Audífonos Sony', price_crc: 100000 });
    d.state().orders[disp].status = 'en_disputa'; d.resolve(disp, 30); // reparto: 30 % al comprador
    await d.seed('fondeado', { title: 'Consola Switch', price_crc: 120000, delivery_mode: 'cara_a_cara' });
    await d.seed('creado', { title: 'Sin vender', price_crc: 5000, single: true });
  });
  await open(page, '/pedidos', 'seller');
  await expect(page.getByLabel('Ver historial de ventas')).toBeVisible();
  await shot(page, 'home-historial');
  await page.getByLabel('Ver historial de ventas').click();
  await expect(page.getByText('Historial de ventas').first()).toBeVisible();
  await expect(page.getByText('₡220 000', { exact: true })).toBeVisible(); // exact: Home (debajo) dice "₡220 000 cobrado" en su resumen
  await expect(page.getByText('Cobrado · 2 ventas cerradas · 1 en curso')).toBeVisible();
  await expect(page.getByText('Cobro parcial: ₡70 000')).toBeVisible();
  await expect(page.getByText('Cobrado', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('En curso', { exact: true }).last()).toBeVisible(); // .last(): Home sigue montado debajo ("En curso" del resumen)
  await expect(page.getByText('Pagado · fondos apartados').last()).toBeVisible();
  await expect(page.getByText('Sin vender')).toBeHidden(); // link sin pagar: no es venta (solo en Home, que queda debajo)
  await expectNoScroll(page);
  await shot(page, 'historial');
  // También desde Mi cuenta
  await open(page, '/pedidos', 'seller');
  await page.getByLabel('Mi cuenta').click();
  await expect(page.getByText('Tus ventas con su estado y lo que cobraste.')).toBeVisible();
  await shot(page, 'mi-cuenta');
});
