// Demo (iPhone SE / iPhone 13 / Chromium): comprador que ya tiene sesión guarda la compra en su cuenta desde la tarjeta
// "Recibe avisos de tu compra" (la mitad posterior al login del vínculo; la vuelta del redirect está en mock-contacto).
import { test, expect } from '@playwright/test';
import { open, seed, PAID, BANNED, VOSEO, expectInputs16 } from './helpers';

test('CNT-D1 comprador con sesión: "Guardar en mi cuenta" vincula la compra sin salir de la página', async ({ page }, info) => {
  await open(page, '/', 'seller', true);
  const slug = await seed(page, 'creado');
  await open(page, `/p/${slug}`, 'buyer');
  await page.getByText(/Pagar en custodia/).last().click();
  await page.getByText('Ya pagué', { exact: true }).click();
  await expect(page.getByText(PAID).first()).toBeVisible();
  await page.getByText('Entendido', { exact: true }).click();
  const card = page.getByTestId('contact-card');
  await expect(card.getByText('Recibe avisos de tu compra')).toBeVisible();
  const url = page.url();
  await card.getByRole('radio', { name: 'Guardar en mi cuenta' }).click();
  await page.getByTestId('contact-consent').click();
  await page.getByTestId('contact-save').click();
  await expect(page.getByText('Listo: tu compra quedó en tu cuenta')).toBeVisible();
  expect(page.url()).toBe(url);
  // WhatsApp sigue disponible como segunda vía
  await card.getByRole('radio', { name: 'WhatsApp' }).click();
  await expectInputs16(page);
  const text = await card.innerText();
  expect(text).not.toMatch(BANNED); expect(text).not.toMatch(VOSEO);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(sw).toBeLessThanOrEqual(1);
  if (process.env.E2E_SHOTS && info.project.name === 'webkit-iphone-se') await page.screenshot({ path: `${process.env.E2E_SHOTS}/contacto-demo-cuenta.png` }).catch(() => {});
});
