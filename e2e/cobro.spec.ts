// Dónde cobrar (029, simulada en el demo): Cuenta IBAN (en la beta, dato de ejemplo de solo lectura) o USDC de testnet a una wallet Stellar (valida la dirección y avisa si no
// tiene trustline USDC) + cola de pagos IBAN del admin con "Marcar como pagado". iPhone SE: sin scroll, inputs ≥16 px.
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { open, settle, expectNoScroll, expectInputs16, BANNED, VOSEO } from './helpers';

const OUT = process.env.COBRO_SHOTS ?? '/workspace/out';
const shot = async (page: Page, name: string, info: { project: { name: string } }) => {
  if (info.project.name !== 'webkit-iphone-se') return;
  try { mkdirSync(OUT, { recursive: true }); await settle(page); await page.screenshot({ path: `${OUT}/${name}.png` }); } catch { /* CI sin /workspace */ }
};
const W_READY = 'GDJXD5M6F6B4VFDN3V6FSGQMULDZ7FAICLBXYD7W3FLFPZXHCRYG2K7C';
const W_NOTRUST = 'GDJXD5M6F6B4VFDN3V6FSGQMULDZ7FAICLBXYD7W3FLFPZXHCRYTRUST';
const IBAN_LABEL = 'Cuenta bancaria (IBAN) - en la beta es un dato de ejemplo';
const IBAN_HELP = 'Beta en testnet: no escribas tu IBAN real. No hacemos pagos al banco ni guardamos tu cuenta; en la beta se cobra solo en USDC de testnet, que no es dinero real.';
const WALLET_TITLE = 'Recibir USDC de testnet en tu wallet Stellar (no es dinero real)';
const sellerCopy = async (page: Page) => {
  // La ayuda exacta de Neo (legal) menciona "banco" para decir que NO hay pagos al banco: se excluye solo esa frase.
  const text = (await page.locator('body').innerText()).replace(IBAN_HELP, '');
  expect(text).not.toMatch(/Lo hacemos a mano|días hábiles|Pendiente pagar al banco/);
  expect(text).not.toMatch(BANNED); expect(text).not.toMatch(VOSEO);
  expect(text).not.toMatch(/\b(verificad[oa]|empresa|fintech|banco|billetera|proteg\w*|autom[áa]tic\w*)\b/i);
};

test.describe('Dónde cobrar', () => {
  test('COB-01 elegir wallet Stellar (testnet) o Cuenta IBAN de ejemplo, sin scroll en iPhone SE', async ({ page }, info) => {
    await open(page, '/mi-tienda', 'seller', true);
    await page.getByText('Elige dónde cobrar').click();
    await expect(page.getByTestId('payout-wallet')).toBeVisible();
    await page.getByTestId('payout-iban').click();
    await expect(page.getByText(IBAN_LABEL)).toBeVisible();
    await expect(page.getByTestId('payout-iban-help')).toHaveText(IBAN_HELP);
    // Prellenados con el dato de ejemplo, de solo lectura y fuera de PostHog (clase + data-ph-no-capture).
    for (const [id, v] of [['payout-iban-input', 'CR00 0000 0000 0000 0000 00'], ['payout-holder-input', 'Dato de ejemplo'], ['payout-sinpe-input', '+506 0000 0000']]) {
      const el = page.getByTestId(id);
      await expect(el).toHaveValue(v);
      await expect(el).toHaveAttribute('readonly', /.*/);
      await expect(el).toHaveAttribute('data-ph-no-capture', 'true');
      await expect(el).toHaveClass(/ph-no-capture/);
      await expect(el).not.toBeEditable();
    }
    await expectNoScroll(page); await expectInputs16(page); await sellerCopy(page);
    await shot(page, 'cobro-opciones', info);
    await shot(page, 'neo-cobro-iban', info);
    await page.getByTestId('payout-wallet').click();
    await expect(page.getByText(WALLET_TITLE).first()).toBeVisible();
    const save = page.getByRole('button', { name: /Guardar wallet/ });
    const addr = page.getByTestId('payout-address');
    await addr.fill('GABC');
    await expect(save).toBeDisabled();
    await addr.fill(W_NOTRUST);
    await expect(page.getByTestId('payout-check')).toContainText('todavía no acepta USDC');
    await expect(save).toBeEnabled(); // se puede guardar: mientras tanto cobra en su cuenta de Meteorito
    await addr.fill(W_READY);
    await expect(page.getByTestId('payout-check')).toContainText('Lista para recibir USDC');
    await expectNoScroll(page); await expectInputs16(page); await sellerCopy(page);
    await shot(page, 'cobro-wallet', info);
    await shot(page, 'neo-cobro-wallet', info);
    await save.click();
    await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('meteorito:demo:v1')!).payout?.method)).toBe('wallet');
    await expect(page.getByText(/Stellar GDJX…2K7C/).first()).toBeVisible();
  });

  test('COB-02 admin: cola "Beta: sin pago al banco" y Marcar como revisado con nota', async ({ page }, info) => {
    await open(page, '/admin/pagos?admin=1', 'seller', true);
    await expect(page.getByTestId('payouts-list')).toBeVisible();
    await expect(page.getByText('Beta: sin pago al banco').first()).toBeVisible();
    await expect(page.getByText(/Pendiente pagar al banco|Marcar como pagado|Pagados?\b/)).toHaveCount(0);
    await expect(page.getByText('CR00 0000 0000 0000 0000 00').first()).toBeVisible(); // beta: solo el dato de ejemplo
    await expectInputs16(page);
    await shot(page, 'admin-pagos-iban', info);
    const btn = page.getByTestId('payout-pay001').getByRole('button', { name: /Marcar como revisado/ });
    await expect(btn).toBeDisabled();
    await page.getByTestId('payout-note-pay001').fill('Transferencia 99120');
    await btn.click();
    await expect(page.getByTestId('payout-pay001')).toHaveCount(0);
    await page.getByTestId('ptab-pagado').click();
    await expect(page.getByText(/Transferencia 99120/)).toBeVisible();
    await expect(page.getByText(/^Revisado /).first()).toBeVisible();
    await expect(page.getByText(/Revisados/)).toBeVisible();
  });

  test('COB-03 no admin: /admin/pagos no se encuentra', async ({ page }) => {
    await open(page, '/admin/pagos', 'seller', true);
    await expect(page.getByText(/No encontramos esta página/)).toBeVisible();
  });
});
