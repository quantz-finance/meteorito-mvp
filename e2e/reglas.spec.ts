// Reglas con texto legal (lib/rules.ts LEGAL_RULES), lado de quien vende (demo): acuerdo de la beta ANTES de publicar
// y plazo de envío de la regla v1 (aviso del día 2, texto exacto). El lado de quien compra: e2e/mock-guest.spec.ts (MCK-REG-*).
// Capturas: REGLAS_SHOTS=/workspace/out -> reglas-*.png (solo iPhone SE).
import { test, expect, type Page } from '@playwright/test';
import { open, seed, takePhoto, openSellerRow, BANNED } from './helpers';
import { CLAIM_RULE, DISPUTE_REPLY_RULE, SHIP_REFUND_RULE } from '../lib/rules';
import { CURRENT_RULES_VERSION } from '../api/_lib/orderRules';

const SHOTS = process.env.REGLAS_SHOTS;
const shot = async (page: Page, name: string) => { if (SHOTS && test.info().project.name === 'webkit-iphone-se') { await page.waitForTimeout(400); await page.screenshot({ path: `${SHOTS}/reglas-${name}.png` }); } };
const KEY = 'meteorito:demo:v1';
const D = 86_400_000;
/** Mueve el pago al pasado (reloj real de la UI) y recarga. */
async function paidAgo(page: Page, slug: string, ms: number) {
  await page.evaluate(([k, s, at]) => { const st = JSON.parse(sessionStorage.getItem(k as string) || '{}'); st.orders[s as string].funded_at = new Date(Date.now() - (at as number)).toISOString(); sessionStorage.setItem(k as string, JSON.stringify(st)); }, [KEY, slug, ms] as const);
}
const seedV1 = (page: Page) => page.evaluate(() => (window as any).__meteoritoDemo.seed('fondeado', { title: 'Bici de montaña', price_crc: 150000, rules: 1 }));
/** Pedido v2 enviado y en disputa (como lo deja /api/escrow/dispute): 48 h para quien vende desde `notifiedAgoMs`. */
async function seedDisputeV2(page: Page, notifiedAgoMs: number) {
  const slug: string = await page.evaluate(() => (window as any).__meteoritoDemo.seed('enviado', { title: 'Bici de montaña', price_crc: 150000, rules: 2 }));
  await page.evaluate(([k, s, ago]) => { const st = JSON.parse(sessionStorage.getItem(k as string) || '{}'); const o = st.orders[s as string]; const at = Date.now() - (ago as number);
    Object.assign(o, { status: 'en_disputa', disputed_at: new Date(at).toISOString(), dispute_reply_due_at: new Date(at + 48 * 3_600_000).toISOString(), dispute: { reason: 'no_llego', description: 'No ha llegado nada todavía', evidence: [], at: new Date(at).toISOString() } });
    sessionStorage.setItem(k as string, JSON.stringify(st)); }, [KEY, slug, notifiedAgoMs] as const);
  return slug;
}

test('RGL-01 primera publicación: "Antes de publicar" con la regla exacta; al aceptar se crea el link con la versión', async ({ page }) => {
  await open(page, '/vender', 'seller', true, { rulesAck: false });
  await page.getByPlaceholder('Ej. iPhone 13 de 128 GB').fill('Bici de montaña');
  await page.getByPlaceholder('0').fill('150000');
  await takePhoto(page);
  await page.waitForTimeout(400);
  await page.getByText('Generar link').click();
  await expect(page.getByText('Antes de publicar')).toBeVisible();
  const rule = page.getByTestId('legal-rule-reembolso_sin_envio');
  await expect(rule.getByText(SHIP_REFUND_RULE, { exact: true })).toBeVisible();
  await expect(page.getByTestId('legal-rule-respuesta_48h').getByText(DISPUTE_REPLY_RULE, { exact: true })).toBeVisible();
  await expect(page.getByTestId('legal-rule-reclamo_30_dias').getByText(CLAIM_RULE, { exact: true })).toBeVisible();
  await expect(page.getByText('¡Tu link está listo!')).toHaveCount(0); // no publica sin aceptar
  expect(BANNED.test(await rule.innerText())).toBe(false);
  await shot(page, 'vendedor-acuerdo');
  await page.getByTestId('rules-accept').click();
  await expect(page.getByText('¡Tu link está listo!')).toBeVisible();
  const st = await page.evaluate((k) => JSON.parse(sessionStorage.getItem(k) || '{}'), KEY);
  const o: any = Object.values(st.orders).pop();
  expect(o.rules_version).toBe(CURRENT_RULES_VERSION);
  // Segunda publicación: ya aceptada (misma versión) -> no vuelve a preguntar
  expect(await page.evaluate(() => localStorage.getItem('meteorito:reglas-vendedor'))).toBe(String(CURRENT_RULES_VERSION));
});

test('RGL-02 quien vende: plazo de 3 días; el día 2 ve "Te queda 1 día para marcar \'Ya lo envié\'"', async ({ page }) => {
  await open(page, '/', 'seller', true);
  const slug = await seedV1(page);
  await openSellerRow(page, /Envíalo/, /Ya lo envié/);
  await expect(page.getByTestId('ship-rule-seller')).toContainText(/Tienes hasta el .+ para marcar 'Ya lo envié'\./);
  await paidAgo(page, slug, 2 * D + 3_600_000);
  await openSellerRow(page, /Envíalo/, /Ya lo envié/);
  await expect(page.getByTestId('ship-rule-seller')).toContainText("Te queda 1 día para marcar 'Ya lo envié'");
  await shot(page, 'vendedor-aviso-dia2');
  await paidAgo(page, slug, 3 * D + 3_600_000);
  await openSellerRow(page, /Envíalo/, /Ya lo envié/);
  await expect(page.getByTestId('ship-rule-seller')).toContainText('quien compra puede cancelar');
});

test('RGL-03 pedidos anteriores a las reglas (sin versión): sin plazo nuevo', async ({ page }) => {
  await open(page, '/', 'seller', true);
  const slug = await seed(page, 'fondeado');
  await paidAgo(page, slug, 4 * D);
  await openSellerRow(page, /Envíalo/, /Ya lo envié/);
  await expect(page.getByTestId('ship-rule-seller')).toHaveCount(0);
});

test('RGL-04 disputa v2: quien vende ve la cuenta regresiva de 48 h y responde con la guía de envío', async ({ page }) => {
  await open(page, '/', 'seller', true);
  const slug = await seedDisputeV2(page, 3_600_000);
  await openSellerRow(page, /disputa/i, /Cuéntanos tu versión/);
  await expect(page.getByTestId('seller-reply-countdown')).toContainText(/Tienes hasta el .+ para responder\./);
  await expect(page.getByTestId('seller-reply-send')).toBeDisabled();
  await page.getByTestId('seller-reply-guide').fill('CR123456789');
  await shot(page, 'vendedor-disputa-48h');
  await page.getByTestId('seller-reply-send').click();
  await expect(page.getByTestId('seller-reply-done')).toContainText('Guía de envío: CR123456789');
  const st = await page.evaluate((k) => JSON.parse(sessionStorage.getItem(k) || '{}'), KEY);
  expect(st.orders[slug].dispute_replied_at).toBeTruthy();
  expect(st.orders[slug].status).toBe('en_disputa'); // decide una persona
});

test('RGL-05 disputa v2 vencida sin respuesta: quien vende ya no puede responder', async ({ page }) => {
  await open(page, '/', 'seller', true);
  await seedDisputeV2(page, 49 * 3_600_000);
  await openSellerRow(page, /disputa|Reembolsado|Resuelto/i, /Pasaron las 48 h|Reembolsado|Resuelto/);
  await expect(page.getByTestId('seller-reply')).toHaveCount(0);
});

/** Pedido v3 liberado con un reporte de quien compró (como lo deja claim_open) hace `agoMs`. */
async function seedClaimV3(page: Page, agoMs: number) {
  const slug: string = await page.evaluate(() => (window as any).__meteoritoDemo.seed('enviado', { title: 'Bici de montaña', price_crc: 150000, rules: 3 }));
  await page.evaluate(([k, s, ago]) => { const st = JSON.parse(sessionStorage.getItem(k as string) || '{}'); const o = st.orders[s as string]; const at = Date.now() - (ago as number);
    Object.assign(o, { status: 'liberado', released_tx: 'r'.repeat(64), released_at: new Date(at - 86_400_000).toISOString() });
    st.claims = { ...(st.claims ?? {}), [s as string]: { reason: 'no_funciona', description: 'Los frenos no agarran bien', status: 'abierto', opened_at: new Date(at).toISOString(), counts_at: new Date(at + 48 * 3_600_000).toISOString(), seller_response: null, responded_at: null, resolved_at: null } };
    sessionStorage.setItem(k as string, JSON.stringify(st)); }, [KEY, slug, agoMs] as const);
  return slug;
}

test('RGL-06 reporte después de liberar (v3): quien vende lo ve y responde antes de que cuente en su historial', async ({ page }) => {
  await open(page, '/', 'seller', true);
  const slug = await seedClaimV3(page, 3_600_000);
  await openSellerRow(page, /liberado|Cobrado/i, /Reporte de quien compró/);
  await expect(page.getByTestId('seller-claim')).toContainText('Los frenos no agarran bien');
  await expect(page.getByTestId('seller-claim-countdown')).toContainText(/Responde antes del .+ así el reporte entra a tu historial ya respondido\./);
  await expect(page.getByTestId('seller-claim')).toContainText('En tu historial público solo se ve el estado del reporte, no el texto.');
  await page.getByTestId('seller-claim-text').fill('Los ajusté antes de enviarla; te explico cómo regularlos.');
  await shot(page, '3-vendedor-reporte');
  await page.getByTestId('seller-claim-send').click();
  await expect(page.getByTestId('seller-claim-done')).toContainText('te explico cómo regularlos');
  await expect(page.getByTestId('seller-claim-status')).toHaveText('Respondido');
  const st = await page.evaluate((k) => JSON.parse(sessionStorage.getItem(k) || '{}'), KEY);
  expect(st.claims[slug].status).toBe('respondido');
  expect(st.orders[slug].status).toBe('liberado'); // no mueve fondos
});

test('RGL-07 reporte sin respuesta después de 48 h: ya cuenta como abierto (quien vende todavía puede responder)', async ({ page }) => {
  await open(page, '/', 'seller', true);
  await seedClaimV3(page, 49 * 3_600_000);
  await openSellerRow(page, /liberado|Cobrado/i, /Reporte de quien compró/);
  await expect(page.getByTestId('seller-claim-countdown')).toContainText('El reporte ya está en tu historial como abierto.');
  await expect(page.getByTestId('seller-claim-send')).toBeVisible();
});
