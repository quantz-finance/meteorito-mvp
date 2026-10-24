// Panel admin de disputas (modo demo, admin simulado con ?admin=1; en producción el rol lo decide el servidor contra
// el token Cavos: ver t82). iPhone SE + Chromium: lista con filtros, detalle, decisión con confirmación, devolución al
// invitado, respuesta del vendedor con foto de cámara, no admin = sin entrada y "no encontrada". Capturas en /workspace/out.
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { open, seed, takePhoto, expectInputs16, settle, BANNED, VOSEO } from './helpers';

const OUT = process.env.DISPUTAS_SHOTS ?? '/workspace/out';
const shot = async (page: Page, name: string, info: { project: { name: string } }) => {
  if (info.project.name !== 'webkit-iphone-se') return;
  try { mkdirSync(OUT, { recursive: true }); await settle(page); await page.screenshot({ path: `${OUT}/disputas-${name}.png`, fullPage: true }); } catch { /* CI sin /workspace */ }
};
/** Sin scroll horizontal (iPhone SE 375 px): ni el documento ni ningún elemento visible se sale del ancho. */
async function expectNoHScroll(page: Page) {
  await settle(page);
  const m = await page.evaluate(() => {
    const W = window.innerWidth; const doc = document.scrollingElement!.scrollWidth;
    // Contenido real (texto, inputs, imágenes); los adornos del fondo (universo animado) no cuentan
    const own = (e: Element) => [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
    const over = [...document.querySelectorAll('body *')].filter((e) => (own(e) || ['INPUT', 'TEXTAREA', 'IMG', 'BUTTON'].includes(e.tagName)) && (e as HTMLElement).offsetParent !== null)
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > W + 1 || r.left < -1); })
      .slice(0, 3).map((e) => `${e.tagName}:${(e.textContent ?? '').slice(0, 30)}`);
    return { doc, W, over };
  });
  expect(m.doc, `scrollWidth ${m.doc} > ${m.W}`).toBeLessThanOrEqual(m.W + 1);
  expect(m.over, 'elementos fuera del ancho').toEqual([]);
}
async function expectCopy(page: Page, testId?: string) {
  const text = await (testId ? page.getByTestId(testId) : page.locator('body')).innerText();
  expect(text).not.toMatch(BANNED); expect(text).not.toMatch(VOSEO);
  expect(text).not.toMatch(/\b(verificad[oa]|empresa|fintech|banco|billetera|proteg\w*)\b/i);
}
/** Pedido enviado + disputa abierta por el comprador (mismo API simulado que la UI). */
async function disputed(page: Page, description = 'La bici llegó con la rueda rota y el vendedor no contesta.') {
  await open(page, '/', 'seller', true);
  const slug = await seed(page, 'enviado');
  await page.evaluate(async ([s, d]) => { const m = (window as any).__meteoritoDemo; m.setRole('buyer'); await m.api('/api/escrow/dispute', { slug: s, reason: 'no_es_lo_descrito', description: d }); m.setRole('seller'); }, [slug, description] as const);
  return slug;
}

test.describe('Panel de disputas (admin)', () => {
  test('ADM-01 no admin: sin entrada "Disputas" y /admin/disputas no existe', async ({ page }) => {
    await disputed(page);
    await open(page, '/pedidos?admin=0', 'seller');
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.getByTestId('admin-disputes')).toHaveCount(0);
    await open(page, '/admin/disputas', 'seller');
    await expect(page.getByTestId('admin-not-found')).toBeVisible();
    await expect(page.getByTestId('admin-list')).toHaveCount(0);
    await open(page, '/admin/disputa?slug=demo01', 'buyer');
    await expect(page.getByTestId('admin-not-found')).toBeVisible();
  });

  test('ADM-02 admin: entrada en el header, lista con filtros, detalle y reembolso con confirmación', async ({ page }, info) => {
    const slug = await disputed(page);
    await open(page, '/pedidos?admin=1', 'seller');
    await page.getByTestId('admin-disputes').click();
    await expect(page.getByTestId('admin-list')).toBeVisible();
    const row = page.getByTestId(`dispute-${slug}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText('No es lo descrito');
    await expect(row).toContainText('150');
    await expect(page.getByTestId('admin-flags')).toContainText('Auto-resolución: apagada');
    await expectNoHScroll(page); await expectCopy(page);
    await shot(page, 'lista', info);
    // Recién abierta y con prueba de envío: está en "Nuevas" (esperando al vendedor 48 h); la lista abre esa pestaña sola
    await page.getByTestId('tab-decidir').click();
    await expect(page.getByTestId('admin-empty')).toBeVisible();
    await page.getByTestId('tab-resueltas').click();
    await expect(page.getByTestId('admin-empty')).toBeVisible();
    await page.getByTestId('tab-nuevas').click();
    await page.getByTestId(`dispute-${slug}`).click();

    await expect(page.getByTestId('dispute-head')).toBeVisible();
    for (const id of ['dispute-description', 'dispute-timeline', 'dispute-ship', 'dispute-chat', 'dispute-onchain', 'dispute-ai', 'decide'])
      await expect(page.getByTestId(id), id).toBeVisible();
    await expect(page.getByTestId('dispute-description')).toContainText('rueda rota');
    await expect(page.getByTestId('ai-unavailable')).toContainText('Resumen IA no disponible');
    await expect(page.getByTestId('dispute-onchain').getByRole('link', { name: /Contrato/ }).first()).toBeVisible();
    await expectInputs16(page); await expectNoHScroll(page); await expectCopy(page);
    await shot(page, 'detalle', info);

    // Dividir: el % es obligatorio (1..99) y la nota también
    await page.getByTestId('decide-split').click();
    await expect(page.getByTestId('decide-pct')).toBeVisible();
    await expect(page.getByTestId('decide-submit')).toBeDisabled();
    // Reembolsar con nota -> confirmar
    await page.getByTestId('decide-refund').click();
    await page.getByTestId('decide-note').fill('Llegó dañada y el vendedor no mostró prueba del estado.');
    await page.getByTestId('decide-submit').click();
    await expect(page.getByTestId('decide-confirm')).toBeVisible();
    await shot(page, 'confirmar', info);
    await page.getByTestId('decide-go').click();
    await expect(page.getByTestId('decide-result')).toBeVisible();
    await expect(page.getByTestId('dispute-audit')).toContainText('Llegó dañada');
    await expect.poll(() => page.evaluate((s) => (window as any).__meteoritoDemo.state().orders[s].status, slug)).toBe('resuelto');
    await expectNoHScroll(page);
    await shot(page, 'resuelta', info);
  });

  test('ADM-03 admin: dividir 40 % y devolución pendiente al invitado', async ({ page }, info) => {
    const slug = await disputed(page);
    // comprador invitado: la parte del comprador va a la cuenta de la plataforma y queda la tarea manual
    await page.evaluate((s) => { const m = (window as any).__meteoritoDemo; m.state().orders[s].buyer = 'guest:demo'; m.advance(0); }, slug);
    await open(page, `/admin/disputa?slug=${slug}&admin=1`, 'seller');
    await page.getByTestId('decide-split').click();
    await page.getByTestId('decide-pct').fill('40');
    await page.getByTestId('decide-note').fill('Ambos tienen parte de razón.');
    await page.getByTestId('decide-submit').click();
    await page.getByTestId('decide-go').click();
    await expect(page.getByTestId('decide-result')).toBeVisible();
    await expect.poll(() => page.evaluate((s) => (window as any).__meteoritoDemo.state().orders[s].resolution?.buyerPct, slug)).toBe(40);
    const guest = page.getByTestId('guest-refund');
    await expect(guest).toContainText(/devolver al comprador/i);
    await shot(page, 'devolucion', info);
    await page.getByTestId('guest-refund-done').click();
    await expect(guest).toHaveCount(0);
    await expectNoHScroll(page);
  });

  test('ADM-04 vendedor responde con texto y foto de cámara; el admin la ve', async ({ page }, info) => {
    const slug = await disputed(page);
    await open(page, '/pedidos', 'seller');
    await expect(async () => {
      await page.getByRole('button').filter({ hasText: /En disputa/ }).filter({ hasNotText: 'Disponible' }).first().click({ timeout: 4000 });
      await expect(page.getByTestId('seller-reply')).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 30_000 });
    await page.getByTestId('seller-reply-text').fill('Lo envié bien empacado, adjunto el comprobante.');
    await takePhoto(page, 'Tomar foto para tu respuesta');
    await expectInputs16(page); await expectCopy(page, 'seller-reply');
    await shot(page, 'vendedor', info);
    await page.getByTestId('seller-reply-send').click();
    await expect(page.getByTestId('seller-reply-done')).toBeVisible();
    await open(page, `/admin/disputa?slug=${slug}&admin=1`, 'seller');
    await expect(page.getByTestId('seller-response')).toContainText('bien empacado');
    await expectNoHScroll(page);
  });
});
