// Última conexión del vendedor (estilo P2P), SOLO con consentimiento (Ley 8968): apagada por defecto; se invita una vez
// después del primer link (hoja chica, interruptor apagado) y queda en Mi cuenta. Rango grueso, nunca la hora. Demo.
import { test, expect, type Page } from '@playwright/test';
import { expectInputs16, expectNoScroll, open, settle, takePhoto, BANNED, VOSEO } from './helpers';

const INVITE = 'Mostrar a quienes ven tu tienda en Meteorito cuándo estuviste activo por última vez (aproximado, sin hora exacta). Puedes apagarlo cuando quieras en Mi cuenta.';
const noHScroll = async (page: Page) => {
  const w = await page.evaluate(() => ({ sw: document.scrollingElement!.scrollWidth, iw: window.innerWidth }));
  expect(w.sw, 'scroll horizontal').toBeLessThanOrEqual(w.iw + 1);
};
const demoStore = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('meteorito:demo:v1')!).store ?? {});
async function createLink(page: Page, title: string) {
  await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill(title);
  await page.getByPlaceholder('0').fill('150000');
  await takePhoto(page);
  await page.getByText('Generar link').click();
  await expect(page.getByText('¡Tu link está listo!')).toBeVisible();
}

test.describe('Última conexión', () => {
  test('ACT-01 feed y perfil: solo quien la encendió, en rango, nunca la hora; quien no, nada (ni "inactivo")', async ({ page }, info) => {
    await open(page, '/comprar?verified=all', 'buyer', true);
    await expect(page.getByTestId('seller-activity').first()).toBeVisible();
    const feedText = await page.locator('body').innerText();
    expect(feedText).toMatch(/Activo hace 15 min/); // José (de ejemplo) la tiene encendida
    expect(feedText).not.toMatch(/\d{1,2}:\d{2}/); // nunca una hora exacta
    expect(feedText).not.toMatch(/inactiv/i);
    expect(feedText).not.toMatch(/[\u{1F7E2}\u{1F534}]/u);
    await settle(page); await noHScroll(page);
    if (info.project.name === 'webkit-iphone-se') await page.screenshot({ path: 'test-results/actividad-feed.png' });
    await open(page, '/t/jose-games', 'buyer');
    await expect(page.getByTestId('profile-hero').getByText('Activo hace 15 min')).toBeVisible();
    // Valeria (la vendedora del demo) nunca la encendió: su perfil no muestra nada.
    await open(page, '/t/valeria', 'buyer');
    await expect(page.getByTestId('profile-hero')).toBeVisible();
    await expect(page.getByTestId('profile-hero').getByTestId('seller-activity')).toHaveCount(0);
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/En línea|Activo hace|inactiv/i);
    expect(text).not.toMatch(BANNED); expect(text).not.toMatch(VOSEO);
    await noHScroll(page);
  });

  test('ACT-02 Mi cuenta: apagada por defecto; encenderla la muestra y apagarla la quita al instante', async ({ page }) => {
    await open(page, '/pedidos', 'seller', true);
    await page.getByRole('button', { name: 'Mi cuenta' }).click();
    const sw = page.getByTestId('last-seen-switch').locator('input');
    await expect(sw).toBeVisible();
    await expect(sw).not.toBeChecked();
    await expect(page.getByText('Mostrar mi última conexión')).toBeVisible();
    await expect(page.getByText('Apagado: nadie ve cuándo estuviste activo.')).toBeVisible();
    await expectInputs16(page);
    await sw.click();
    await expect(sw).toBeChecked();
    await expect(page.getByText(/aproximado, sin hora exacta/)).toBeVisible();
    await expect.poll(async () => (await demoStore(page)).seenOn).toBe(true);
    await open(page, '/t/valeria', 'buyer');
    await expect(page.getByTestId('profile-hero').getByText('En línea')).toBeVisible();
    await open(page, '/pedidos', 'seller');
    await page.getByRole('button', { name: 'Mi cuenta' }).click();
    await page.getByTestId('last-seen-switch').locator('input').click();
    await expect(page.getByText('Apagado: nadie ve cuándo estuviste activo.')).toBeVisible();
    await expect.poll(async () => (await demoStore(page)).seenOn).toBe(false);
    await open(page, '/t/valeria', 'buyer');
    await expect(page.getByTestId('profile-hero')).toBeVisible();
    await expect(page.getByTestId('profile-hero').getByTestId('seller-activity')).toHaveCount(0);
  });

  test('ACT-03 Vender: invitación una sola vez después del primer link, interruptor apagado, sin scroll', async ({ page }, info) => {
    await open(page, '/vender', 'seller', true, { seenInvite: true });
    await createLink(page, 'Bici de montaña');
    const sheet = page.getByTestId('last-seen-invite');
    await expect(sheet).toBeVisible({ timeout: 6000 });
    await expect(sheet.getByText(INVITE, { exact: true })).toBeVisible();
    await expect(page.getByTestId('last-seen-invite-switch').locator('input')).not.toBeChecked();
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/venden más|más ventas/i);
    expect(text).not.toMatch(BANNED); expect(text).not.toMatch(VOSEO);
    await expectNoScroll(page); await noHScroll(page);
    if (info.project.name === 'webkit-iphone-se') await page.screenshot({ path: 'test-results/actividad-optin-vender.png' });
    // "Listo" sin tocar nada: sigue apagada y no se vuelve a preguntar.
    await page.getByRole('button', { name: 'Listo' }).click();
    await expect(sheet).toHaveCount(0);
    expect((await demoStore(page)).seenOn ?? false).toBe(false);
    await page.getByRole('button', { name: 'Otro link' }).click();
    await createLink(page, 'Casco de bici');
    await page.waitForTimeout(2500);
    await expect(page.getByTestId('last-seen-invite')).toHaveCount(0);
  });

  test('ACT-04 Vender: encenderla desde la invitación queda registrada y se ve en el perfil', async ({ page }) => {
    await open(page, '/vender', 'seller', true, { seenInvite: true });
    await createLink(page, 'Bici de montaña');
    await expect(page.getByTestId('last-seen-invite')).toBeVisible({ timeout: 6000 });
    await page.getByTestId('last-seen-invite-switch').locator('input').click();
    await expect(page.getByTestId('last-seen-invite-switch').locator('input')).toBeChecked();
    await expect.poll(async () => (await demoStore(page)).seenDecided).toBe(true);
    await page.getByRole('button', { name: 'Listo' }).click();
    await open(page, '/t/valeria', 'buyer');
    await expect(page.getByTestId('profile-hero').getByText('En línea')).toBeVisible();
  });
});
