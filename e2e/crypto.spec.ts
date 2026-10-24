import { test, expect } from '@playwright/test';
import { open, seed, orderStatus, PAID, expectNoScroll, expectInputs16, BANNED, VOSEO } from './helpers';

// Pago con cripto (demo con ?crypto=1; el demo simula api/_lib/crypto.ts). La tarjeta sigue siendo el camino principal:
// "Cripto" es un botón chico y discreto en "Elige cómo pagar".
test.describe('Pago con cripto (USDC o XLM en Stellar)', () => {
  test('CRI-01 invitado: botón discreto "Cripto" -> hoja con monto, dirección, memo y QR; el pago se detecta solo', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const slug = await seed(page, 'creado');
    await open(page, `/p/${slug}?crypto=1`, 'buyer');
    await page.getByText(/Pagar en custodia/).last().click();
    await expect(page.getByText('Elige cómo pagar')).toBeVisible();
    const sinpe = page.getByText('Pagar por SINPE Móvil', { exact: true });
    const crypto = page.getByTestId('pay-crypto');
    await expect(sinpe).toBeVisible();
    await expect(crypto).toBeVisible();
    // Discreto: más bajo y angosto que un botón principal.
    const cb = (await crypto.boundingBox())!; const vw = page.viewportSize()!.width;
    expect(cb.width).toBeLessThan(vw * 0.4);
    expect(cb.height).toBeLessThanOrEqual(46);
    await expectNoScroll(page);
    await crypto.click();
    await expect(page.getByText('Pagar con cripto')).toBeVisible();
    await expect(page.getByText('Por ahora solo USDC o XLM en Stellar.')).toBeVisible();
    await expect(page.getByTestId('crypto-qr')).toBeVisible();
    await expect(page.getByTestId('crypto-amount')).toContainText('USDC');
    const mine = page.url().match(/\/p\/(demo\d+)/)![1];
    await expect(page.getByTestId('crypto-memo')).toContainText(`MET-${mine.toUpperCase()}`);
    await expect(page.getByTestId('crypto-address')).toContainText('…');
    await expect(page.getByText('Copiar').first()).toBeVisible();
    await expect(page.getByText(/Esperando tu pago/)).toBeVisible();
    await expectNoScroll(page);
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(BANNED); expect(text).not.toMatch(VOSEO);
    expect(text).not.toMatch(/billetera|garant|verificad|empresa|fintech|banco/i);
    // XLM: precio con vencimiento
    await page.getByTestId('crypto-XLM').click();
    await expect(page.getByTestId('crypto-amount')).toContainText('XLM');
    await expect(page.getByText(/Precio válido \d+:\d\d/)).toBeVisible();
    await page.getByTestId('crypto-path-toggle').click();
    await expect(page.getByTestId('crypto-buyer')).toBeVisible();
    await expectInputs16(page);
    await page.getByTestId('crypto-path-toggle').click();
    // Llega el pago (en producción: Horizon). La hoja lo detecta sola y sigue como un pago con tarjeta.
    await page.evaluate((s) => (window as any).__meteoritoDemo.cryptoPay(s, 'XLM', 10), mine);
    await expect(page.getByText(PAID).first()).toBeVisible({ timeout: 15_000 });
    expect(await orderStatus(page, mine)).toBe('fondeado');
  });

  test('CRI-02 "Volver" regresa a elegir método; sin cripto en el servidor no aparece el botón', async ({ page }) => {
    await open(page, '/', 'seller', true);
    const slug = await seed(page, 'creado');
    await open(page, `/p/${slug}?crypto=1`, 'buyer');
    await page.getByText(/Pagar en custodia/).last().click();
    await page.getByTestId('pay-crypto').click();
    await expect(page.getByText('Pagar con cripto')).toBeVisible();
    await page.getByText('Volver', { exact: true }).click();
    await expect(page.getByText('Elige cómo pagar')).toBeVisible();
    await open(page, '/', 'seller', true);
    const s2 = await seed(page, 'creado');
    await open(page, `/p/${s2}?crypto=0`, 'buyer');
    await page.getByText(/Pagar en custodia/).last().click();
    await expect(page.getByText('Paga por SINPE Móvil')).toBeVisible();
    await expect(page.getByTestId('pay-crypto')).toHaveCount(0);
  });
});
