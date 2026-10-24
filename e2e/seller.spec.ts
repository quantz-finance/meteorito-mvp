import { test, expect } from '@playwright/test';
import { open, takePhoto, expectNoScroll, expectInputs16, expectTitleAt16 } from './helpers';

test.describe('Vendedor (demo)', () => {
  test('VEN-01 crea un link con título, precio y foto', async ({ page }) => {
    await open(page, '/vender', 'seller', true);
    await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('Bici de montaña');
    await page.getByPlaceholder('0').fill('150000');
    await takePhoto(page);
    await expect(page.getByText('FOTOS (1/4)', { exact: false })).toBeVisible();
    await page.getByText('Generar link').click();
    await expect(page.getByText('¡Tu link está listo!')).toBeVisible();
    await expect(page.getByText(/pago\.meteorito\.app\/p\/demo01/)).toBeVisible();
    await expectNoScroll(page);
  });

  test('VEN-06 fotos: hasta 4, se puede quitar una', async ({ page }) => {
    await open(page, '/vender', 'seller', true);
    for (let i = 1; i <= 4; i++) {
      await takePhoto(page);
      await expect(page.getByText(`FOTOS (${i}/4)`, { exact: false })).toBeVisible();
    }
    await expect(page.getByLabel('Tomar foto', { exact: true })).toHaveCount(0); // no deja más de 4
    await page.getByLabel('Quitar foto').first().click();
    await expect(page.getByText('FOTOS (3/4)', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Tomar foto', { exact: true })).toBeVisible();
    await expectNoScroll(page);
  });

  test('VEN-02 sin foto no genera link', async ({ page }) => {
    await open(page, '/vender', 'seller', true);
    await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('Bici');
    await page.getByPlaceholder('0').fill('150000');
    await page.getByText('Generar link').click();
    await expect(page.getByText('¡Tu link está listo!')).toHaveCount(0);
  });

  test('VEN-03 precio menor a ₡1 000 no genera link', async ({ page }) => {
    await open(page, '/vender', 'seller', true);
    await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('Bici');
    await page.getByPlaceholder('0').fill('500');
    await takePhoto(page);
    await page.getByText('Generar link').click();
    await expect(page.getByText('¡Tu link está listo!')).toHaveCount(0);
  });

  test('VEN-04 el producto aparece en la tienda pública /t/valeria', async ({ page }) => {
    await open(page, '/', 'seller', true);
    await page.evaluate(() => (window as any).__meteoritoDemo.seed('creado', { title: 'Guitarra', price_crc: 90000 }));
    await open(page, '/t/valeria', 'buyer');
    await expect(page.getByText('Guitarra')).toBeVisible();
  });

  test('VEN-05 Mi cuenta: IBAN inválido se rechaza, válido se guarda enmascarado', async ({ page }) => {
    await open(page, '/mi-tienda', 'seller', true);
    await page.getByText('Agrega tu cuenta IBAN').click();
    const iban = page.getByPlaceholder('CR00 0000 0000 0000 0000 00');
    const save = page.getByRole('button', { name: /Guardar cuenta/ });
    await page.getByPlaceholder('Como aparece en el banco').fill('Valeria Mora');
    await iban.fill('CR05015202001026284067'); // dígito de control mod-97 malo
    await expect(save).toBeDisabled();
    await iban.fill('CR05015202001026284066');
    await page.getByPlaceholder('8888 1234').fill('8888123');  // SINPE de 7 dígitos
    await expect(save).toBeDisabled();
    await page.getByPlaceholder('8888 1234').fill('88881234');
    await expect(save).toBeEnabled();
    await save.click();
    await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('meteorito:demo:v1')!).payout?.iban_last4)).toBe('4066');
    await expect(page.getByText(/4066/).first()).toBeVisible();
    await expect(page.getByText('CR05015202001026284066')).toHaveCount(0); // siempre enmascarada
  });

  // Importar de un link: el API simulado del demo responde como /api/store {action:'import_listing'} (sin red).
  test('VEN-07 importar de un link (Facebook): botón, pegar link, formulario precargado, generar link', async ({ page }, info) => {
    await open(page, '/vender', 'seller', true);
    const btn = page.getByRole('button', { name: 'Importar de un link' });
    await expect(btn).toBeVisible();
    await expectNoScroll(page);
    await expectTitleAt16(page, 'Vender');
    if (info.project.name === 'webkit-iphone-se') await page.screenshot({ path: 'test-results/fb-import-1-boton.png' });
    await btn.click();
    const input = page.getByLabel('Link del anuncio');
    await expect(input).toBeVisible();
    await expect(page.getByTestId('import-providers')).toContainText('Pega el link de tu anuncio');
    await expectInputs16(page);
    await input.fill('https://www.facebook.com/share/18HroUrSak/?mibextid=wwXIfr');
    await page.waitForTimeout(600); // animación de la hoja
    if (info.project.name === 'webkit-iphone-se') await page.screenshot({ path: 'test-results/fb-import-2-pegar.png' });
    await expect(page.getByRole('button', { name: /Importar$/ })).toBeInViewport();
    await expect(page.getByTestId('import-provider')).toContainText('Anuncio de Facebook');
    await page.getByRole('button', { name: /Importar$/ }).click();
    await expect(page.getByText('Importado de Facebook')).toBeVisible();
    await expect(page.getByPlaceholder('Ej. iPhone 13 de 128 GB')).toHaveValue('Bicicleta de montaña aro 29');
    await expect(page.getByPlaceholder('0')).toHaveValue('185 000');
    await expect(page.getByText('FOTOS (1/4)', { exact: false })).toBeVisible();
    await expect(page.getByText(/Incluye la descripción del anuncio/)).toBeVisible();
    await expect(page.getByText('Modo prueba', { exact: false })).toHaveCount(0);
    await page.waitForTimeout(400); // la foto termina de comprimirse
    await expectNoScroll(page);
    await expectInputs16(page);
    await expectTitleAt16(page, 'Vender');
    if (info.project.name === 'webkit-iphone-se') await page.screenshot({ path: 'test-results/fb-import-3-precargado.png' });
    await page.getByText('Generar link').click();
    await expect(page.getByText('¡Tu link está listo!')).toBeVisible();
    const o = await page.evaluate(() => { const s = JSON.parse(sessionStorage.getItem('meteorito:demo:v1')!); return Object.values(s.orders as Record<string, any>).pop(); });
    expect(o.model).toBe('Bicicleta de montaña aro 29');
    expect(o.price_crc).toBe(185000);
    expect(o.photos).toHaveLength(1);
    expect(String(o.description)).toContain('frenos de disco');
    expect(o.source_provider).toBe('facebook'); // de dónde vino (migración 019)
    expect(o.source_url).toBe('https://www.facebook.com/share/18HroUrSak/?mibextid=wwXIfr');
  });

  test('VEN-08 importar de un link: link inválido se rechaza; anuncio ilegible -> mensaje amable y completar a mano', async ({ page }, info) => {
    await open(page, '/vender', 'seller', true);
    await page.getByRole('button', { name: 'Importar de un link' }).click();
    await page.getByLabel('Link del anuncio').fill('http://localhost/admin');
    await page.getByRole('button', { name: /Importar$/ }).click();
    await expect(page.getByText('Pega el link completo de tu anuncio (empieza con https://).')).toBeVisible();
    await page.getByLabel('Link del anuncio').fill('https://www.facebook.com/marketplace/item/1/');
    await page.getByRole('button', { name: /Importar$/ }).click();
    await expect(page.getByText('Todavía no podemos leer ese link. Tómale foto a tu anuncio y súbela.')).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar' }).last().click();
    await expect(page.getByPlaceholder('Ej. iPhone 13 de 128 GB')).toHaveValue('');
    await expect(page.getByText('FOTOS (0/4)', { exact: false })).toBeVisible();
    await expectNoScroll(page);
    if (info.project.name === 'webkit-iphone-se') { await page.waitForTimeout(400); await page.screenshot({ path: 'test-results/fb-import-4-no-se-pudo.png' }); }
    // Sigue funcionando a mano
    await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('Silla de oficina');
    await page.getByPlaceholder('0').fill('45000');
    await takePhoto(page);
    await page.getByText('Generar link').click();
    await expect(page.getByText('¡Tu link está listo!')).toBeVisible();
  });

  test('VEN-09 importar de un link: Mercado Libre avisa que no se puede leer; tienda genérica con skeleton y vista previa editable', async ({ page }, info) => {
    await open(page, '/vender', 'seller', true);
    await page.getByRole('button', { name: 'Importar de un link' }).click();
    // Mercado Libre no deja leer sus anuncios desde nuestros servidores: se avisa al pegar y no se intenta
    await page.getByLabel('Link del anuncio').fill('https://articulo.mercadolibre.com.mx/MLM-1770588108-bicicleta-gravel-andes-mtb-de-montana-r29-24v-shimano-altus-_JM');
    await expect(page.getByTestId('import-provider')).toContainText('Todavía no podemos leer ese link. Tómale foto a tu anuncio y súbela.');
    await expect(page.getByRole('button', { name: /Importar$/ })).toBeDisabled();
    await expectInputs16(page);
    if (info.project.name === 'webkit-iphone-se') { await page.waitForTimeout(500); await page.screenshot({ path: 'test-results/import-1-mercadolibre.png' }); }
    await page.getByLabel('Link del anuncio').fill('https://www.bicishop.com.mx/p/gravel-andes-r29');
    await expect(page.getByTestId('import-provider')).toContainText('Anuncio de bicishop.com.mx');
    await page.getByRole('button', { name: /Importar$/ }).click();
    await expect(page.getByTestId('import-skeleton')).toContainText('Leyendo tu anuncio de bicishop.com.mx');
    await expect(page.getByText('Importado de bicishop.com.mx')).toBeVisible();
    await expect(page.getByText(/Sugerido de MX\$7,238\.99: confírmalo/)).toBeVisible();
    const name = page.getByPlaceholder('Ej. iPhone 13 de 128 GB');
    await expect(name).toHaveValue('Bicicleta de montaña aro 29');
    await name.fill('Bicicleta Gravel Andes R29'); // la vista previa se edita
    await expect(page.getByPlaceholder('0')).toHaveValue('197 400');
    await page.waitForTimeout(400);
    await expectNoScroll(page);
    // El aviso de beta (Ley 7472) no puede quedar tapado por "Generar link" con el aviso de importación abierto
    const beta = await page.getByText(/Beta en testnet/).boundingBox();
    const btn = await page.getByRole('button', { name: 'Generar link' }).boundingBox();
    expect(beta!.y + beta!.height).toBeLessThanOrEqual(btn!.y);
    await expect(page.getByText('Modo prueba', { exact: false })).toHaveCount(0);
    if (info.project.name === 'webkit-iphone-se') { await page.screenshot({ path: 'test-results/import-2-vista-previa.png' }); }
  });
});
