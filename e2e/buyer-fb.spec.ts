import { test, expect, type Page } from '@playwright/test';
import { open, expectNoScroll, expectInputs16, settle, BANNED, VOSEO, withoutBetaNotice } from './helpers';

// Comprar → invitar al vendedor desde un anuncio de Facebook Marketplace (comprador sin cuenta).
// El demo responde import_facebook igual que /api/store (sin red, sin Facebook); el endpoint real con los fixtures
// de scripts/ci/fixtures/facebook está en api-contract.spec.ts (API-FB-BUYER) y t49.
const FB = 'https://www.facebook.com/share/18HroUrSak/?mibextid=wwXIfr';
const st = (page: Page) => page.evaluate(() => (window as any).__meteoritoDemo.state());
const shot = async (page: Page, info: { project: { name: string } }, name: string) => {
  if (info.project.name === 'webkit-iphone-13') { await settle(page); await page.screenshot({ path: `test-results/comprar-fb-${name}.png` }); }
};
/** Título en 16,16 (como expectTitleAt16, pero solo el visible: Comprar sigue montado debajo con un botón del mismo texto). */
async function titleAt16(page: Page, title: string) {
  const box = await page.getByText(title, { exact: true }).filter({ visible: true }).first().boundingBox();
  expect(box, `no encontré el título "${title}"`).not.toBeNull();
  expect(Math.round(box!.x)).toBe(16);
  expect(Math.abs(box!.y - 16)).toBeLessThanOrEqual(6);
}
/** Foto de la invitación: miniatura junto al nombre y el precio (no una foto grande). */
async function expectCompactPhoto(page: Page) {
  const box = (await page.getByTestId('invite-photo').filter({ visible: true }).first().boundingBox())!;
  expect(box.height, `foto de ${box.height}px`).toBeLessThanOrEqual(72);
  expect(box.width).toBeLessThanOrEqual(72);
  const name = (await page.getByText('Bicicleta de montaña aro 29', { exact: true }).filter({ visible: true }).first().boundingBox())!;
  expect(name.x).toBeGreaterThan(box.x + box.width - 1); // al lado, no encima
}
/** navigator.share simulado: guarda lo que se compartiría (Messenger, WhatsApp…). */
const captureShare = (page: Page) => page.addInitScript(() => {
  (window as any).__shared = [];
  Object.defineProperty(navigator, 'share', { configurable: true, value: async (d: any) => { (window as any).__shared.push(d); } });
});

test.describe('Comprar: invitar desde Facebook', () => {
  test('CMP-FB-01 pegar link de FB -> invitación precargada -> mensaje para Messenger -> el vendedor ve foto y precio y publica', async ({ page }, info) => {
    await captureShare(page);
    await open(page, '/comprar/link?buyer=A', 'buyer', true); // Comprar › Pagar con link
    const entry = page.getByRole('button', { name: 'Importar de un link' });
    await expect(entry).toBeVisible();
    // Pegar el link (Facebook u otro marketplace) es el caso más común: botón principal (blanco); invitar a mano queda secundario, debajo.
    const manual = page.getByRole('button', { name: 'Invitar a un vendedor' });
    const bg = (l: typeof entry) => l.evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(await bg(entry)).toBe('rgb(255, 255, 255)');
    expect(await bg(manual)).not.toBe('rgb(255, 255, 255)');
    expect((await entry.boundingBox())!.y).toBeLessThan((await manual.boundingBox())!.y);
    await expectNoScroll(page);
    await shot(page, info, '1-comprar');
    await entry.click();
    await expect(page).toHaveURL(/\/i\/nueva/);
    const input = page.getByLabel('Link del anuncio');
    await expect(input).toBeVisible();
    await input.fill(FB);
    await expect(page.getByTestId('import-provider')).toContainText('Anuncio de Facebook: llenamos el nombre, el precio y la foto.');
    await page.waitForTimeout(600); // animación de la hoja
    await expectInputs16(page);
    await expect(page.getByRole('button', { name: /Importar$/ })).toBeInViewport();
    await shot(page, info, '2-pegar-link');
    await page.getByRole('button', { name: /Importar$/ }).click();
    await expect(page.getByText('Importado de Facebook')).toBeVisible();
    await expect(page.getByPlaceholder('Ej. iPhone 13 de 128 GB')).toHaveValue('Bicicleta de montaña aro 29');
    await expect(page.getByLabel('Precio acordado')).toHaveValue('185 000');
    await expect(page.getByLabel('Quitar foto')).toHaveCount(1);
    await expectNoScroll(page);
    await expectInputs16(page);
    await titleAt16(page, 'Invitar a un vendedor');
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(BANNED); expect(text).not.toMatch(VOSEO); expect(withoutBetaNotice(text)).not.toMatch(/modo prueba|de prueba|testnet/i); // solo el aviso de beta (BETA_NOTICE)
    await shot(page, info, '3-precargado');
    await page.getByRole('button', { name: /Crear invitación/ }).click();
    await expect(page).toHaveURL(/\/i\/inv\d+/);
    await expect(page.getByText('Tu invitación')).toBeVisible();
    const code = page.url().match(/\/i\/(inv\d+)/)![1];
    const s = await st(page);
    expect(s.invites[code].source_url).toMatch(/^https:\/\/www\.facebook\.com\/share\/18HroUrSak\//);
    expect(s.invites[code].photos).toHaveLength(1);
    expect(s.invites[code].price_crc).toBe(185000);
    await expect(page.getByText('Bicicleta de montaña aro 29')).toBeVisible();
    await expect(page.getByRole('link', { name: /Ver anuncio en Facebook/ })).toBeVisible();
    await expectCompactPhoto(page);
    await expectNoScroll(page);
    await shot(page, info, '4-invitacion-lista');
    await page.getByRole('button', { name: /Enviar link al vendedor/ }).click();
    const shared = await page.evaluate(() => (window as any).__shared);
    expect(shared).toHaveLength(1);
    expect(shared[0].text).toContain('Facebook');
    expect(shared[0].text).toContain('Bicicleta de montaña aro 29');
    expect(shared[0].text).toContain('₡185 000');
    expect(shared[0].text).toMatch(/custodia/);
    expect(shared[0].text).toContain(`/i/${code}`);
    expect(shared[0].text).not.toMatch(VOSEO);

    // El vendedor (otro navegador) abre el link de Messenger.
    await open(page, `/i/${code}?buyer=S`, 'seller');
    await expect(page.getByText('Quieren comprarte')).toBeVisible();
    await expect(page.getByText('Bicicleta de montaña aro 29')).toBeVisible();
    await expect(page.getByText('₡185 000').first()).toBeVisible();
    await expect(page.getByTestId('invite-photo')).toBeVisible();
    await expectCompactPhoto(page);
    await expectNoScroll(page);
    await expect(page.getByText('Otro', { exact: true })).toHaveCount(0); // categoría genérica: sin chip
    await expect(page.getByText('Esperando al vendedor')).toBeVisible();
    await expect(page.getByRole('link', { name: /Ver anuncio en Facebook/ })).toBeVisible();
    await shot(page, info, '5-vendedor-ve-invitacion');
    await page.getByText('Publicar para esta compra').click();
    await expect(page).toHaveURL(/\/vender\?invite=/);
    await expect(page.getByPlaceholder('Ej. iPhone 13 de 128 GB')).toHaveValue('Bicicleta de montaña aro 29');
    await expect(page.getByText('Fotos (1/4)')).toBeVisible(); // la foto del anuncio ya viene; no hay que volver a subirla
    await shot(page, info, '6-vendedor-publica');
    await page.getByText('Generar link').click();
    await expect(page.getByText('¡Tu link está listo!')).toBeVisible();
    const s2 = await st(page);
    expect(s2.invites[code].status).toBe('aceptada');
    expect(s2.orders[s2.invites[code].order_slug].photos[0]).toBe(s.invites[code].photos[0]);
  });

  test('CMP-FB-02 anuncio de Facebook que no se puede leer: aviso neutro, formulario a mano y el link va en la invitación', async ({ page }) => {
    await open(page, '/i/nueva?fb=1&buyer=A', 'buyer', true);
    const input = page.getByLabel('Link del anuncio');
    await input.fill('esto no es un link');
    await page.getByRole('button', { name: /Importar$/ }).click();
    await expect(page.getByText('Pega el link completo del anuncio (empieza con https://).')).toBeVisible();
    await input.fill('https://www.facebook.com/marketplace/item/1/');
    await page.getByRole('button', { name: /Importar$/ }).click();
    await expect(page.getByText('Anuncio de Facebook', { exact: true })).toBeVisible();
    await expect(page.getByText(/No pudimos/)).toHaveCount(0);
    await expect(page.getByPlaceholder('Ej. iPhone 13 de 128 GB')).toHaveValue('');
    await expectNoScroll(page);
    await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('Bicicleta aro 29');
    await page.getByLabel('Precio acordado').fill('150000');
    await page.getByRole('button', { name: /Crear invitación/ }).click();
    await expect(page).toHaveURL(/\/i\/inv\d+/);
    const code = page.url().match(/\/i\/(inv\d+)/)![1];
    const s = await st(page);
    expect(s.invites[code].title).toBe('Bicicleta aro 29');
    expect(s.invites[code].source_url).toBe('https://www.facebook.com/marketplace/item/1/'); // queda de referencia para el vendedor
  });

  test('CMP-FB-03 con el teclado abierto el formulario no se aplasta (iPhone SE)', async ({ page }, info) => {
    test.skip(info.project.name !== 'webkit-iphone-se', 'solo pantalla chica');
    await open(page, '/i/nueva?buyer=A', 'buyer', true);
    await expect(page.getByLabel('Precio acordado')).toBeVisible();
    await settle(page);
    // Altos y separaciones de los campos (el teclado no debe comprimir el formulario).
    const layout = () => page.evaluate(() => {
      const q = (sel: string) => { const r = document.querySelector(sel)!.getBoundingClientRect(); return { top: Math.round(r.top + window.scrollY), h: Math.round(r.height) }; };
      return { fb: q('[aria-label="Importar de un link"]'), name: q('input[aria-label="Nombre del producto"]'), price: q('input[aria-label="Precio acordado"]'), root: Math.round(document.getElementById('root')!.getBoundingClientRect().height) };
    });
    const before = await layout();
    await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').focus();
    await page.setViewportSize({ width: 375, height: 667 - 260 }); // teclado de iOS
    await page.waitForTimeout(300);
    const after = await layout();
    // Puede desplazarse en bloque (el campo enfocado se trae a la vista), pero nada cambia de alto ni de separación.
    const rel = (l: typeof before) => ({ fbH: l.fb.h, nameH: l.name.h, priceH: l.price.h, gap1: l.name.top - l.fb.top, gap2: l.price.top - l.name.top, root: l.root });
    expect(rel(after)).toEqual(rel(before));
  });
});
