// Encabezados de seguridad + CSP (los mismos de vercel.json, los aplica mock-server) y secretos del comprador fuera de
// localStorage (bóveda cifrada en IndexedDB) con migración desde la versión anterior.
import { test, expect, type Page } from '@playwright/test';
import { reset, MOCK_PIN, readVault, plainGuestSecrets } from './mock';
import { PAID } from './helpers';

test.describe.configure({ mode: 'serial' });
const KEY = 'c'.repeat(64);

/** Junta las violaciones de CSP de la página (evento securitypolicyviolation). */
async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    (window as any).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => (window as any).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return () => page.evaluate(() => (window as any).__csp as string[]);
}

test('SEC-01 encabezados de seguridad y CSP en el HTML', async ({ request }) => {
  const r = await request.get('/');
  const h = r.headers();
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['content-security-policy']).toContain("object-src 'none'");
  expect(h['content-security-policy']).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['permissions-policy']).toContain('camera=(self)');
  expect(h['permissions-policy']).toContain('microphone=()');
  expect(h['strict-transport-security']).toMatch(/max-age=\d{7,}/);
});

test('SEC-02 sin violaciones de CSP: bienvenida, Comprar, tienda, producto y pago como invitado', async ({ page, request }) => {
  await reset(request, [{ slug: 'prod01', kind: 'listing', model: 'Bici de montaña', price_crc: 150000 }]);
  const csp = await watchCsp(page);
  for (const u of ['/', '/comprar', '/t/valeria', '/como-funciona']) { await page.goto(u); await expect(page.locator('#root')).not.toBeEmpty(); }
  await page.goto('/p/prod01');
  await page.getByText(/Pagar en custodia/).last().click();
  await expect(page.getByText('Paga por SINPE Móvil')).toBeVisible();
  await page.getByText('Ya pagué', { exact: true }).click();
  await expect(page.getByText(PAID).first()).toBeVisible();
  await page.waitForTimeout(500);
  expect(await csp()).toEqual([]);
  // Secretos del comprador: cifrados en IndexedDB, nada en texto plano en localStorage.
  expect(await plainGuestSecrets(page)).toEqual([]);
  const v = await readVault(page);
  expect(v['guest:key']).toMatch(/^[a-f0-9]{64}$/);
  const raw = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  expect(raw).not.toContain(v['guest:key']);
});

test('SEC-03 migración: llave y código de la versión anterior pasan a la bóveda, se borran de localStorage y la compra sigue', async ({ page, request }) => {
  await reset(request, [{ slug: 'old111', status: 'fondeado', contract_id: 'C1', buyer: KEY, model: 'Consola', price_crc: 90000, delivery_mode: 'cara_a_cara' }]);
  await page.goto('/como-funciona');
  await page.evaluate(([k, pin]) => { localStorage.setItem('meteorito:guest:v1', k); localStorage.setItem('meteorito:guest:pin:old111', pin); }, [KEY, MOCK_PIN]);
  await page.goto('/p/old111');
  await expect(page.getByTestId('delivery-code')).toHaveText(MOCK_PIN);
  await expect.poll(() => plainGuestSecrets(page)).toEqual([]);
  const v = await readVault(page);
  expect(v['guest:key']).toBe(KEY);
  expect(v['guest:pin:old111']).toBe(MOCK_PIN);
  await page.reload(); // ya sin localStorage: sale de la bóveda
  await expect(page.getByTestId('delivery-code')).toHaveText(MOCK_PIN);
  await page.goto('/comprar/compras');
  await expect(page.getByText('Consola')).toBeVisible();
});
