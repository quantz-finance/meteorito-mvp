// Build REAL + backend simulado (scripts/e2e/mock-server.mjs): el comprador sin cuenta tal como corre en producción.
import { test, expect, type Page } from '@playwright/test';
import { reset, state, patch, failNext, calls, MOCK, MOCK_PIN, accessToken } from './mock';
import { expectNoScroll, PAID, BANNED, VOSEO, expectInputs16, settle, expectLegalVisible } from './helpers';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.describe.configure({ mode: 'serial' });
const listing = { slug: 'prod01', kind: 'listing', model: 'Bici de montaña', price_crc: 150000 };
const childOf = async (request: any, parent = 'prod01') => Object.values((await state(request)).orders).filter((o: any) => o.listing_slug === parent) as any[];

async function payAsGuest(page: Page) {
  await page.goto('/p/prod01');
  await page.getByText(/Pagar en custodia/).last().click();
  await expect(page).toHaveURL(/\/p\/h[0-9a-f]{5}\?pay=1/);
  await expect(page.getByText('Paga por SINPE Móvil')).toBeVisible();
  await page.getByText('Ya pagué', { exact: true }).click();
  await expect(page.getByText(PAID).first()).toBeVisible();
  await expect(page.getByText(MOCK_PIN)).toHaveCount(0);
  return page.url().match(/\/p\/(h[0-9a-f]{5})/)![1];
}

test('MCK-COM-01 comprador sin cuenta paga un producto permanente (build real)', async ({ page, request }) => {
  await reset(request, [listing]);
  const slug = await payAsGuest(page);
  const s = await state(request);
  expect(s.orders[slug].status).toBe('fondeado');
  expect(s.orders.prod01.status).toBe('creado'); // el producto sigue disponible
  const api = s.calls.filter((c: any) => c.path === '/api/escrow/pay');
  expect(api.every((c: any) => c.guest)).toBe(true); // siempre con X-Guest-Key, nunca login
});

test('MCK-PER-01 dos compradores en dos navegadores -> dos pedidos; un tercero ve el producto disponible', async ({ browser, request }) => {
  await reset(request, [listing]);
  const a = await (await browser.newContext()).newPage(); const b = await (await browser.newContext()).newPage();
  const sa = await payAsGuest(a); const sb = await payAsGuest(b);
  expect(sa).not.toBe(sb);
  const kids = await childOf(request);
  expect(kids.map((k) => k.status).sort()).toEqual(['fondeado', 'fondeado']);
  const c = await (await browser.newContext()).newPage();
  await c.goto('/p/prod01');
  await expect(c.getByText('Disponible')).toBeVisible();
  await expect(c.getByText(/Pagar en custodia/).last()).toBeVisible();
});

test('MCK-COM-02 recargar y volver al producto reusa el pedido propio (sin escrow nuevo)', async ({ page, request }) => {
  await reset(request, [listing]);
  await page.goto('/p/prod01');
  await page.getByText(/Pagar en custodia/).last().click();
  await expect(page).toHaveURL(/\?pay=1/);
  await page.reload();
  await page.goto('/p/prod01');
  await expect(page.getByText('Ver mi pedido')).toBeVisible();
  await page.getByText(/Pagar en custodia/).last().click();
  await expect(page).toHaveURL(/\?pay=1/);
  expect((await childOf(request)).length).toBe(1);
});

test('MCK-LIM-03 botón atrás en medio del pago: vuelve a la tienda y al reabrir retoma el mismo pedido', async ({ page, request }) => {
  await reset(request, [listing]);
  await page.goto('/t/valeria');
  await page.getByText('Bici de montaña').first().click();
  await expect(page).toHaveURL(/\/p\/prod01/);
  await page.getByText(/Pagar en custodia/).last().click();
  await expect(page.getByText('Paga por SINPE Móvil')).toBeVisible();
  await page.goBack(); // el pedido reemplaza al producto en el historial: atrás vuelve a la tienda
  await expect(page).toHaveURL(/\/t\/valeria/);
  await page.getByText('Bici de montaña').first().click();
  await expect(page.getByText('Ver mi pedido')).toBeVisible();
  await page.getByText(/Pagar en custodia/).last().click();
  await page.getByText('Ya pagué', { exact: true }).click();
  await expect(page.getByText(PAID).first()).toBeVisible();
  await expect(page.getByText(MOCK_PIN)).toHaveCount(0);
  expect((await childOf(request)).length).toBe(1);
});

test('MCK-LIM-02 doble toque en "Pagar" y en "Ya pagué": una sola llamada y el PIN se ve', async ({ page, request }) => {
  await reset(request, [listing]);
  await failNext(request, { path: '/api/escrow/pay', step: 'start', delayMs: 600 }); // respuesta lenta: da tiempo al segundo toque
  await page.goto('/p/prod01');
  await page.getByText(/Pagar en custodia/).last().dblclick();
  await expect(page.getByText('Paga por SINPE Móvil')).toBeVisible();
  // 1 toque en el producto (+1 al abrir el pedido propio con ?pay=1, que solo trae los datos del SINPE)
  expect((await calls(request, '/api/escrow/pay', 'start')).filter((c: any) => c.slug === 'prod01').length).toBe(1);
  await failNext(request, { path: '/api/escrow/pay', step: 'confirm_sinpe', delayMs: 600 });
  await page.getByText('Ya pagué', { exact: true }).dblclick();
  await expect(page.getByText(PAID).first()).toBeVisible();
  await expect(page.getByText(MOCK_PIN)).toHaveCount(0);
  expect((await calls(request, '/api/escrow/pay', 'confirm_sinpe')).length).toBe(1);
});

test('MCK-LIM-01 sin red al tocar "Ya pagué": mensaje claro, sin cambio; con red vuelve a funcionar', async ({ page, context, request }) => {
  await reset(request, [listing]);
  await page.goto('/p/prod01');
  await page.getByText(/Pagar en custodia/).last().click();
  await expect(page.getByText('Ya pagué', { exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.getByText('Ya pagué', { exact: true }).click();
  await expect(page.getByText(/conexión|red|internet|intenta/i).first()).toBeVisible();
  const [kid] = await childOf(request);
  expect(kid.status).toBe('escrow_creado');
  await context.setOffline(false);
  await page.getByText('Ya pagué', { exact: true }).click();
  await expect(page.getByText(PAID).first()).toBeVisible();
  await expect(page.getByText(MOCK_PIN)).toHaveCount(0);
});

test('MCK-API-01 error 500 del API al iniciar el pago: mensaje y reintento sin pedido duplicado', async ({ page, request }) => {
  await reset(request, [listing]);
  await failNext(request, { path: '/api/escrow/pay', step: 'start', status: 500, error: 'Falla temporal' });
  await page.goto('/p/prod01');
  await page.getByText(/Pagar en custodia/).last().click();
  await expect(page.getByText(/Falla temporal|Intenta/).first()).toBeVisible();
  await page.getByText(/Pagar en custodia/).last().click();
  await expect(page.getByText('Paga por SINPE Móvil')).toBeVisible();
  expect((await childOf(request)).length).toBe(1);
});

test('MCK-ESC-01 liberación automática: vencido el plazo, la página del comprador lo libera y muestra "Pago liberado"', async ({ page, request }) => {
  await reset(request, [{ slug: 'ord001', status: 'enviado', contract_id: 'C1', buyer: 'x', auto_release_at: new Date(Date.now() - 60_000).toISOString() }]);
  await page.goto('/p/ord001');
  await expect(page.getByText('Pago liberado').first()).toBeVisible();
  expect((await state(request)).orders.ord001.approval_reason).toBe('timeout');
});

test('MCK-PIN-01 PIN bloqueado: vencido el plazo NO se libera solo', async ({ page, request }) => {
  await reset(request, [{ slug: 'ord001', status: 'enviado', contract_id: 'C1', buyer: 'x', pin_attempts: 3, auto_release_at: new Date(Date.now() - 60_000).toISOString() }]);
  await page.goto('/p/ord001');
  await expect(page.getByText(/Enviado/).first()).toBeVisible();
  await page.waitForTimeout(1500);
  expect((await state(request)).orders.ord001.status).toBe('enviado');
  await expect(page.getByText('Pago liberado')).toHaveCount(0);
});

test('MCK-SHP-01 comprador: código oculto hasta el envío; luego "Va en camino", foto y código (build real)', async ({ page, request }) => {
  await reset(request, [listing]);
  const slug = await payAsGuest(page);
  await page.goto(`/p/${slug}`);
  await expect(page.getByText(PAID).first()).toBeVisible();
  await expect(page.getByText(MOCK_PIN)).toHaveCount(0);
  const photo = 'data:image/png;base64,' + readFileSync(resolve(__dirname, '../scripts/demo/assets/producto-demo.png')).toString('base64');
  await patch(request, slug, { status: 'enviado', shipped_tx: 's'.repeat(64), auto_release_at: new Date(Date.now() + 7 * 86_400_000).toISOString(), ship_evidence: { at: new Date().toISOString(), photo } });
  await page.reload();
  await expect(page.getByText('Va en camino')).toBeVisible();
  await expect(page.getByText(MOCK_PIN)).toBeVisible();
  await expect(page.getByText('Dáselo al vendedor cuando lo recibas.')).toBeVisible();
  await expect(page.getByTestId('ship-photo')).toBeVisible();
  const pub = await (await request.get(`${MOCK}/sb/rest/v1/public_orders?slug=eq.${slug}`)).json();
  expect(JSON.stringify(pub)).not.toContain('ship_evidence'); // la foto no va a la vista pública
});

for (const [pct, label] of [[100, 'Reembolsado'], [0, 'Disputa resuelta: pago al vendedor'], [40, 'Disputa resuelta: 40 % reembolsado']] as const) {
  test(`MCK-DIS-05 disputa resuelta ${pct} % al comprador -> "${label}" (nunca "Pago liberado")`, async ({ page, request }) => {
    await reset(request, [{ slug: 'ord001', status: 'resuelto', contract_id: 'C1', resolution: { buyerPct: pct } }]);
    await page.goto('/p/ord001');
    await expect(page.getByText(label).first()).toBeVisible();
    if (pct > 0) await expect(page.getByText('Pago liberado', { exact: true })).toHaveCount(0);
  });
}

test('MCK-DIS-01 + CAL: el comprador disputa un pedido; otro pedido lo confirma y califica una sola vez', async ({ page, request }) => {
  await reset(request, [listing]);
  const slug = await payAsGuest(page);
  await page.goto(page.url().split('?')[0]); // cierra la hoja del PIN
  await patch(request, slug, { status: 'enviado', auto_release_at: new Date(Date.now() + 600_000).toISOString() });
  await page.reload();
  await page.getByText('Tengo un problema').first().click();
  await page.getByText('No llegó', { exact: true }).click();
  await page.getByText('Reportar problema', { exact: true }).click();
  await expect.poll(async () => (await state(request)).orders[slug].status).toBe('en_disputa');
  // Segundo pedido: confirma recibido y califica
  const slug2 = await payAsGuest(page); // espera el PIN: si navegamos antes, este navegador no queda como comprador
  await patch(request, slug2, { status: 'enviado', auto_release_at: new Date(Date.now() + 600_000).toISOString() });
  await page.goto(`/p/${slug2}`);
  await page.getByText('Recibí y está bien', { exact: true }).click();
  await expect(page.getByText('¡Listo! Pago liberado')).toBeVisible();
  await page.getByText('Cerrar', { exact: true }).last().click();
  await page.getByRole('button', { name: '5 estrellas' }).click();
  await page.getByText('Publicar reseña', { exact: true }).click();
  await expect(page.getByText('¡Gracias por tu reseña!')).toBeVisible();
  expect((await state(request)).ratings[slug2]).toBe(5);
});

test('MCK-PSH-01 activar avisos como comprador: permiso + PushManager simulados -> suscripción guardada con su llave', async ({ page, request, browserName }) => {
  await page.addInitScript(() => {
    let perm: NotificationPermission = 'default';
    (window as any).Notification = Object.assign(function () { /* */ }, { get permission() { return perm; }, requestPermission: async () => (perm = 'granted') });
    Object.defineProperty(navigator, 'standalone', { get: () => true }); // iPhone: PWA instalada en inicio
    const sub = { endpoint: 'https://push.example.test/e2e', toJSON: () => ({ endpoint: 'https://push.example.test/e2e', keys: { p256dh: 'x', auth: 'y' } }) };
    const PM: any = (window as any).PushManager ?? function PushManager() { /* */ };
    (window as any).PushManager = PM;
    PM.prototype.getSubscription = async () => null; PM.prototype.subscribe = async () => sub;
    if ('serviceWorker' in navigator) {
      const reg: any = { pushManager: new PM(), update: async () => {} };
      navigator.serviceWorker.register = async () => reg; navigator.serviceWorker.getRegistration = async () => reg;
      Object.defineProperty(navigator.serviceWorker, 'ready', { get: () => Promise.resolve(reg) });
    }
  });
  await reset(request, [listing]);
  const slug = await payAsGuest(page);
  await page.goto(page.url().split('?')[0]); // cierra la hoja del PIN
  test.skip(!(await page.evaluate(() => 'serviceWorker' in navigator)), `${browserName} sin serviceWorker en este perfil`);
  await page.getByText('Activar', { exact: true }).first().click();
  await expect.poll(async () => (await state(request)).subs.length).toBe(1);
  expect((await state(request)).subs[0].endpoint).toBe('https://push.example.test/e2e');
  void slug;
});

test('MCK-PSH-02 iPhone en Safari (sin instalar): explica "Agregar a inicio" en vez de pedir permiso', async ({ page, request, browserName }) => {
  test.skip(browserName !== 'webkit', 'solo iPhone');
  await reset(request, [listing]);
  await payAsGuest(page);
  await page.goto(page.url().split('?')[0]); // cierra la hoja del PIN
  await expect(page.getByText(/Agregar a inicio/)).toBeVisible();
});

test('MCK-PWA-01 versión nueva del service worker: recarga sola y avisa "Actualizado"; no recarga con texto a medio escribir', async ({ page, request, browserName }) => {
  test.skip(browserName !== 'chromium', 'service worker en Chromium (WebKit de Playwright no lo soporta)');
  await reset(request, [{ slug: 'ord001', status: 'fondeado', contract_id: 'C1', buyer: 'x' }]);
  const sw = resolve('dist-e2e/sw.js'); const orig = readFileSync(sw, 'utf8');
  try {
    await page.goto('/p/ord001');
    await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 15_000 });
    writeFileSync(sw, orig + `\n// e2e ${Date.now()}\n`);
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));
    await expect(page.getByText('Actualizado')).toBeVisible({ timeout: 15_000 });
    // Con un formulario a medio llenar no recarga
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'e2e-draft'; i.value = 'a medio escribir'; document.body.appendChild(i); (window as any).__noReload = true; });
    writeFileSync(sw, orig + `\n// e2e2 ${Date.now()}\n`);
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));
    await page.waitForTimeout(5000);
    expect(await page.evaluate(() => (window as any).__noReload === true)).toBe(true);
  } finally { writeFileSync(sw, orig); }
});

// ── UTMs del landing (PostHog simulado en mock-server: S.ph). Aquí y no en otro archivo: el backend simulado es único y va en serie.
const LANDING_Q = '?utm_source=landing&utm_medium=cta&utm_content=hero';
// posthog-js descarta eventos de navegadores automatizados (navigator.webdriver, marca HeadlessChrome): el test se presenta como un navegador normal.
const asRealBrowser = (page: Page) => page.addInitScript(() => {
  Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
  Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
});
const phEvents = async (request: any, name?: string) => ((await state(request)).ph as any[]).filter((e) => !name || e.event === name);

test('MCK-UTM-01 entra desde el landing con UTMs: app_opened y cada evento llevan las UTMs, también después de navegar', async ({ page, request }) => {
  await reset(request, [listing]);
  await asRealBrowser(page);
  await page.goto('/' + LANDING_Q);
  await expect.poll(async () => (await phEvents(request, 'app_opened')).length, { timeout: 20_000 }).toBe(1);
  const [opened] = await phEvents(request, 'app_opened');
  expect(opened.properties).toMatchObject({ utm_source: 'landing', utm_medium: 'cta', utm_content: 'hero', first_touch: true });
  expect(String(opened.properties.$current_url ?? '')).not.toContain('?'); // la URL sigue sin query
  expect(opened.properties.$ip).toBeUndefined();
  // Primer evento de la carga
  const all = await phEvents(request);
  expect(all.findIndex((e) => e.event === 'app_opened')).toBe(0);
  // Guardado como first-touch
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('meteorito:first-touch:v1')!).utm_content)).toBe('hero');
  // Navegar (el router ya borró el query): los eventos siguientes siguen con las UTMs (super propiedades)
  await page.getByText(/Quiero comprar|Comprar sin cuenta/).first().click();
  await expect(page).toHaveURL(/\/comprar$/); // la bienvenida abre el feed
  await page.goto('/p/prod01'); // otra carga sin UTMs
  await expect.poll(async () => (await phEvents(request, 'payment_link_opened')).length, { timeout: 20_000 }).toBeGreaterThan(0);
  const linkOpened = (await phEvents(request, 'payment_link_opened'))[0];
  expect(linkOpened.properties).toMatchObject({ utm_source: 'landing', utm_content: 'hero' });
  const screens = (await phEvents(request, 'screen_viewed')).filter((e) => e.properties.screen === '/comprar');
  expect(screens.length).toBeGreaterThan(0);
  expect(screens[0].properties.utm_source).toBe('landing');
});

test('MCK-UTM-02 visita posterior con otras UTMs no pisa el first-touch', async ({ page, request }) => {
  await reset(request, [listing]);
  await asRealBrowser(page);
  await page.goto('/' + LANDING_Q);
  await expect.poll(async () => (await phEvents(request, 'app_opened')).length, { timeout: 20_000 }).toBe(1);
  await page.goto('/?utm_source=landing&utm_medium=cta&utm_content=gracias');
  await expect.poll(async () => (await phEvents(request, 'app_opened')).length, { timeout: 20_000 }).toBe(2);
  const second = (await phEvents(request, 'app_opened'))[1];
  expect(second.properties).toMatchObject({ utm_content: 'hero', first_touch: false });
});

test('MCK-UTM-03 con opt-out no se guarda ni se envía nada', async ({ page, request }) => {
  await reset(request, [listing]);
  await asRealBrowser(page);
  await page.addInitScript(() => localStorage.setItem('meteorito:analytics-optout', '1'));
  await page.goto('/' + LANDING_Q);
  await expect(page.locator('#root')).not.toBeEmpty();
  await page.waitForTimeout(4000);
  expect(await phEvents(request)).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('meteorito:first-touch:v1'))).toBeNull();
});

// ---- Pago con tarjeta: NUESTRO formulario (components/CardSheet.tsx). El servidor cobra con Lendara headless (card_pay);
// aquí el backend simulado responde igual que api/_lib/lendara.ts. Número y CVC no deben salir del navegador.
const CVC = '913';
const NUM = { approved: '4242 4242 4242 4242', rejected: '4000 0000 0000 0002', notReceived: '4000 0000 0000 9995', delayed: '4000 0000 0000 0077' };

async function openMethods(page: Page) {
  await page.goto('/p/prod01');
  await page.getByText(/Pagar en custodia/).last().click();
  await expect(page.getByText('Elige cómo pagar')).toBeVisible();
}
async function openCardForm(page: Page) {
  await page.getByText('Pagar con tarjeta', { exact: true }).click();
  await expect(page.getByTestId('card-number')).toBeVisible();
}
async function fillCard(page: Page, number: string, o: { exp?: string; cvc?: string; name?: string; email?: string } = {}) {
  await page.getByTestId('card-number').fill(number);
  await page.getByTestId('card-exp').fill(o.exp ?? '12/30');
  await page.getByTestId('card-cvc').fill(o.cvc ?? CVC);
  await page.getByTestId('card-name').fill(o.name ?? 'Ana Pérez');
  await page.getByTestId('card-email').fill(o.email ?? 'ana@example.com');
}
/** Todas las requests del navegador (URL + cuerpo) para verificar que el número y el CVC no salen. */
function recordNetwork(page: Page) {
  const reqs: { url: string; body: string }[] = [];
  page.on('request', (r) => { const b = r.postDataBuffer(); reqs.push({ url: r.url(), body: b ? b.toString('latin1') : '' }); });
  return reqs;
}
async function expectNoCardLeak(request: any, reqs: { url: string; body: string }[]) {
  const digitsOnly = (x: string) => x.replace(/\D/g, '');
  expect(reqs.some((r) => r.body.includes('"card_pay"'))).toBe(true); // sí se registró el tráfico del pago
  for (const r of reqs) {
    expect(new URL(r.url).hostname, r.url).not.toMatch(/lendara/i); // nada del navegador a Lendara
    for (const n of Object.values(NUM)) {
      expect(r.url.includes(digitsOnly(n)) || r.url.includes(n) || r.url.includes(encodeURIComponent(n)), r.url).toBe(false);
      expect(r.body.includes(digitsOnly(n)) || r.body.includes(n), `cuerpo de ${r.url}`).toBe(false);
    }
    if (/\/api\//.test(r.url) && r.body) { // JSON propio: ni claves de tarjeta ni el CVC como valor
      const j = JSON.parse(r.body);
      expect(Object.keys(j).filter((k) => /card|number|pan|cvc|cvv|csc|exp/i.test(k))).toEqual([]);
      expect(Object.values(j)).not.toContain(CVC);
    }
  }
  const ph = JSON.stringify((await state(request)).ph);
  for (const n of Object.values(NUM)) expect(ph.includes(digitsOnly(n)) || ph.includes(n)).toBe(false);
  expect(ph).not.toContain(`"${CVC}"`);
}
const NO_TEST_LABELS = /lendara|sandbox|modo prueba|prueba|test card|4242/i;

test('MCK-CARD-01 invitado paga con tarjeta aprobada en nuestro formulario: procesando -> PIN; número y CVC no salen', async ({ page, request }) => {
  await reset(request, [listing], true);
  const reqs = recordNetwork(page);
  await openMethods(page);
  await expect(page.getByText('Pagar con tarjeta', { exact: true })).toBeInViewport();
  await expect(page.getByText('Pagar por SINPE Móvil', { exact: true })).toBeInViewport();
  await openCardForm(page);
  await expect(page.getByText(NO_TEST_LABELS)).toHaveCount(0); // sin etiquetas de prueba ni del proveedor
  await expect(page.locator('iframe')).toHaveCount(0);
  await fillCard(page, NUM.approved);
  await expect(page.getByTestId('card-number')).toHaveValue('4242 4242 4242 4242'); // espacios automáticos
  await expect(page.getByLabel('VISA')).toBeVisible(); // ícono de marca
  await failNext(request, { path: '/api/escrow/pay', step: 'card_pay', delayMs: 1200 }); // ver el estado "procesando"
  await page.getByTestId('card-pay').click();
  await expect(page.getByTestId('card-processing')).toBeVisible();
  await expect(page.getByText(PAID).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(MOCK_PIN)).toHaveCount(0);
  const slug = page.url().match(/\/p\/(h[0-9a-f]{5})/)![1];
  expect((await state(request)).orders[slug].status).toBe('fondeado');
  const pays = await calls(request, '/api/escrow/pay', 'card_pay');
  expect(pays).toHaveLength(1);
  expect(Object.keys(pays[0].body).sort()).toEqual(['email', 'name', 'scenario', 'slug', 'step']);
  expect(pays[0].body).toMatchObject({ name: 'Ana Pérez', email: 'ana@example.com', scenario: 'approved' });
  expect((await calls(request, '/api/escrow/pay', 'card_confirm')).length).toBeGreaterThanOrEqual(1);
  expect(await calls(request, '/api/escrow/pay', 'card_session')).toHaveLength(0);
  expect(await calls(request, '/api/escrow/pay', 'confirm_sinpe')).toHaveLength(0);
  await expectNoCardLeak(request, reqs);
});

test('MCK-CARD-02 tarjeta rechazada: "Tu tarjeta fue rechazada" y puede pagar por SINPE', async ({ page, request }) => {
  await reset(request, [listing], true);
  const reqs = recordNetwork(page);
  await openMethods(page);
  await openCardForm(page);
  await fillCard(page, NUM.rejected);
  await page.getByTestId('card-pay').click();
  await expect(page.getByText(/Tu tarjeta fue rechazada/)).toBeVisible();
  await expect(page.getByTestId('card-cvc')).toHaveValue(''); // el CVC se borra tras un intento fallido
  await page.getByText('Pagar por SINPE Móvil', { exact: true }).click();
  await expect(page.getByText('Paga por SINPE Móvil', { exact: true })).toBeVisible();
  await page.getByText('Ya pagué', { exact: true }).click();
  await expect(page.getByText(PAID).first()).toBeVisible();
  await expect(page.getByText(MOCK_PIN)).toHaveCount(0);
  await expectNoCardLeak(request, reqs);
});

test('MCK-CARD-03 tarjeta demorada: procesando varios segundos y luego PIN (sin cobrar dos veces)', async ({ page, request }) => {
  await reset(request, [listing], true);
  await openMethods(page);
  await openCardForm(page);
  await fillCard(page, NUM.delayed);
  await page.getByTestId('card-pay').click();
  await expect(page.getByTestId('card-processing')).toBeVisible();
  await expect(page.getByText(PAID).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(MOCK_PIN)).toHaveCount(0);
  expect(await calls(request, '/api/escrow/pay', 'card_pay')).toHaveLength(1);
  expect((await calls(request, '/api/escrow/pay', 'card_confirm')).length).toBeGreaterThanOrEqual(3);
});

test('MCK-CARD-04 sin pago con tarjeta configurado: directo al SINPE (como antes)', async ({ page, request }) => {
  await reset(request, [listing]);
  await page.goto('/p/prod01');
  await page.getByText(/Pagar en custodia/).last().click();
  await expect(page.getByText('Paga por SINPE Móvil')).toBeVisible();
  await expect(page.getByText('Pagar con tarjeta', { exact: true })).toHaveCount(0);
});

test('MCK-CARD-05 validación en el navegador: Luhn, vencida, tarjeta no aceptada (sin llamar al servidor)', async ({ page, request }) => {
  await reset(request, [listing], true);
  await openMethods(page);
  await openCardForm(page);
  await fillCard(page, '4242 4242 4242 4241');
  await page.getByTestId('card-pay').click();
  await expect(page.getByText('Revisa el número de la tarjeta.')).toBeVisible();
  await fillCard(page, NUM.approved, { exp: '01/20' });
  await page.getByTestId('card-pay').click();
  await expect(page.getByText(/vencida/)).toBeVisible();
  await fillCard(page, '5555 5555 5555 4444');
  await expect(page.getByLabel('Mastercard')).toBeVisible();
  await page.getByTestId('card-pay').click();
  await expect(page.getByText(/Tarjeta no aceptada/)).toBeVisible();
  expect(await calls(request, '/api/escrow/pay', 'card_pay')).toHaveLength(0);
});

test('MCK-CARD-06 formulario en iPhone SE: sin scroll, letra ≥16 px, teclado numérico, autocompletar y sin captura de analítica', async ({ page, request }) => {
  await reset(request, [listing], true);
  await openMethods(page);
  await openCardForm(page);
  for (const id of ['card-number', 'card-exp', 'card-cvc', 'card-name', 'card-email']) await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId('card-pay')).toBeInViewport({ ratio: 1 });
  await expect(page.getByText('Pagar por SINPE Móvil', { exact: true })).toBeInViewport({ ratio: 1 });
  const info = await page.evaluate(() => {
    const form = document.querySelector('[data-card-form]') as HTMLElement;
    let scrolls = false;
    for (let el: HTMLElement | null = form; el; el = el.parentElement) { const st = getComputedStyle(el); if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 1) scrolls = true; }
    const inputs = Array.from(form.querySelectorAll('input')).map((i) => ({ id: i.dataset.testid, ac: i.getAttribute('autocomplete'), im: i.getAttribute('inputmode'), fs: parseFloat(getComputedStyle(i).fontSize), ph: i.getAttribute('data-ph-no-autocapture') }));
    return { scrolls, inputs, wrap: form.className, docScroll: document.scrollingElement!.scrollHeight > window.innerHeight + 1 };
  });
  expect(info.scrolls).toBe(false);
  expect(info.docScroll).toBe(false);
  expect(info.wrap).toMatch(/ph-no-capture/);
  const by = Object.fromEntries(info.inputs.map((i) => [i.id, i]));
  expect(by['card-number']).toMatchObject({ ac: 'cc-number', im: 'numeric' });
  expect(by['card-exp']).toMatchObject({ ac: 'cc-exp', im: 'numeric' });
  expect(by['card-cvc']).toMatchObject({ ac: 'cc-csc', im: 'numeric' });
  expect(by['card-name']).toMatchObject({ ac: 'cc-name' });
  expect(by['card-email']).toMatchObject({ ac: 'email', im: 'email' });
  for (const i of info.inputs) { expect(i.fs).toBeGreaterThanOrEqual(16); expect(i.ph).toBe('true'); }
});

test('MCK-CARD-07 pago no recibido: "No pudimos procesar el pago" y SINPE disponible', async ({ page, request }) => {
  await reset(request, [listing], true);
  await openMethods(page);
  await openCardForm(page);
  await fillCard(page, NUM.notReceived);
  await page.getByTestId('card-pay').click();
  await expect(page.getByText(/No pudimos procesar el pago/)).toBeVisible();
  await expect(page.getByText('Pagar por SINPE Móvil', { exact: true })).toBeVisible();
});

test('MCK-CARD-08 respaldo LENDARA_MODE=widget: el widget (iframe) sigue funcionando', async ({ page, request }) => {
  await reset(request, [listing], true, 'widget');
  await openMethods(page);
  await page.getByText('Pagar con tarjeta', { exact: true }).click();
  const w = page.frameLocator('iframe.lendara-frame');
  await w.locator('#n').fill('4242 4242 4242 4242');
  await w.getByText('Pagar', { exact: true }).click();
  await expect(page.getByText(PAID).first()).toBeVisible();
  await expect(page.getByText(MOCK_PIN)).toHaveCount(0);
  expect(await calls(request, '/api/escrow/pay', 'card_session')).toHaveLength(1);
  expect(await calls(request, '/api/escrow/pay', 'card_pay')).toHaveLength(0);
});

// WhatsApp del vendedor: solo en el dispositivo del comprador y solo tras pagar (nunca en la tienda ni antes del pago).
test('MCK-TEL-01 "Contacta al vendedor" solo para el comprador y solo después de pagar', async ({ page, browser, request }) => {
  await reset(request, [listing]);
  await page.goto('/t/valeria'); // tienda pública: nunca
  await expect(page.getByText('Bici de montaña').first()).toBeVisible();
  await expect(page.getByText('Contacta al vendedor')).toHaveCount(0);
  await page.goto('/p/prod01'); // antes de pagar: nunca
  await expect(page.getByText(/Pagar en custodia/).last()).toBeVisible();
  await expect(page.getByText('Contacta al vendedor')).toHaveCount(0);
  await page.getByText(/Pagar en custodia/).last().click();
  await expect(page).toHaveURL(/\/p\/h[0-9a-f]{5}\?pay=1/);
  await expect(page.getByText('Paga por SINPE Móvil')).toBeVisible();
  await expect(page.getByText('Contacta al vendedor')).toHaveCount(0); // pedido creado, sin pagar
  expect((await calls(request, '/api/store')).filter((c: any) => c.action === 'seller_contact')).toHaveLength(0);
  await page.getByText('Ya pagué', { exact: true }).click();
  await expect(page.getByText(PAID).first()).toBeVisible();
  const slug = page.url().match(/\/p\/(h[0-9a-f]{5})/)![1];
  await page.goto(`/p/${slug}`);
  await expect(page.getByText('Contacta al vendedor')).toBeVisible();
  const wa = page.getByTestId('seller-whatsapp');
  await expect(wa).toHaveAttribute('href', 'https://wa.me/50688887777');
  await expect(page.getByText('+506 8888 7777')).toBeVisible();
  const asked = (await calls(request, '/api/store')).filter((c: any) => c.action === 'seller_contact');
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.every((c: any) => c.guest && c.slug === slug)).toBe(true); // con la llave del comprador

  // Otro navegador (no es el comprador) con el mismo link pagado: no lo ve ni lo pide.
  const other = await (await browser.newContext()).newPage();
  await other.goto(`/p/${slug}`);
  await expect(other.getByText('Bici de montaña').first()).toBeVisible();
  await expect(other.getByText('Contacta al vendedor')).toHaveCount(0);
  expect((await calls(request, '/api/store')).filter((c: any) => c.action === 'seller_contact').length).toBe(asked.length);
});

// Aviso de beta (lib/rules.ts BETA_NOTICE): en el pago, visible SIN scroll y ANTES del botón de pagar, también con fotos.
test('MCK-BETA-01 aviso de beta visible en el viewport antes de "Pagar en custodia" (producto con fotos)', async ({ page, request }) => {
  await reset(request, [{ ...listing, photos: ['/demo-fb-import.jpg', '/demo-fb-import.jpg', '/demo-fb-import.jpg'] }]);
  await page.goto('/p/prod01');
  await expect(page.getByTestId('order-photo')).toBeVisible();
  const notice = page.getByTestId('beta-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Pago en custodia (beta en testnet, sin dinero real): se libera con tu PIN de entrega, o por tiempo si no abres una disputa antes. Meteorito no verifica el producto.');
  // Aviso legal UNA sola vez en la página y sin "Protección" ni "7 días" (Neo).
  const body = await page.locator('body').innerText();
  expect(body.split('Meteorito no verifica el producto').length - 1).toBe(1);
  expect(body).not.toMatch(/Protecci|7 días/);
  await expect(notice.getByText('Ver cómo funciona')).toBeVisible();
  const pay = page.getByText(/Pagar en custodia/).last();
  const vh = page.viewportSize()!.height;
  const n = (await notice.boundingBox())!, b = (await pay.boundingBox())!;
  expect(n.y).toBeGreaterThanOrEqual(0);
  expect(n.y + n.height).toBeLessThanOrEqual(vh); // dentro del viewport, sin scroll
  expect(n.y + n.height).toBeLessThanOrEqual(b.y); // antes del botón de pagar
  await expectLegalVisible(page, ['beta-notice', 'rules-hint']); // con la animación de entrada activa: ni él ni sus contenedores se animan
  await notice.getByText('Ver cómo funciona').click();
  await expect(page).toHaveURL(/\/como-funciona/);
});

test('MCK-BETA-02 con la animación de entrada ACTIVA: aviso de beta y "Ver reglas" visibles desde el primer cuadro (ni ellos ni sus contenedores se animan)', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('meteorito:e2e-anim', '1'));
  await reset(request, [{ ...listing, photos: ['/demo-fb-import.jpg'] }]);
  await page.goto('/p/prod01');
  await expect(page.getByTestId('beta-notice')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.classList.contains('no-appear'))).toBe(false);
  await expectLegalVisible(page, ['beta-notice', 'rules-hint']);
  const n = (await page.getByTestId('beta-notice').boundingBox())!, b = (await page.getByText(/Pagar en custodia/).last().boundingBox())!;
  expect(n.y + n.height).toBeLessThanOrEqual(Math.min(page.viewportSize()!.height, b.y));
});

// Plazo acordado (t57): el comprador ve el acuerdo antes de pagar; cara a cara ve su código apenas paga; responde una
// extensión pedida por el vendedor. En este archivo (no en uno nuevo): los MCK de un mismo archivo corren en serie.
test('MCK-WIN-01 cara a cara: "Entrega: Cara a cara" antes de pagar y el código al pagar', async ({ page, request }) => {
  await reset(request, [{ slug: 'prod01', kind: 'listing', model: 'Bici de montaña', price_crc: 150000, delivery_mode: 'cara_a_cara', protection_minutes: 1440 }]);
  await page.goto('/p/prod01');
  await expect(page.getByText('Entrega: Cara a cara', { exact: true })).toBeVisible();
  await page.getByText(/Pagar en custodia/).last().click();
  await expect(page).toHaveURL(/\/p\/h[0-9a-f]{5}\?pay=1/);
  await page.getByText('Ya pagué', { exact: true }).click();
  await expect(page.getByText(MOCK_PIN).first()).toBeVisible(); // cara a cara: el código se ve al pagar
  const slug = page.url().match(/\/p\/(h[0-9a-f]{5})/)![1];
  const o = (await state(request)).orders[slug];
  expect([o.delivery_mode, o.status]).toEqual(['cara_a_cara', 'fondeado']);
  expect(Date.parse(o.auto_release_at) - Date.parse(o.funded_at)).toBeGreaterThan(86_000_000); // ~24 h desde el pago
  await page.goto(`/p/${slug}`);
  await expect(page.getByText('Dáselo al vendedor cuando revises el producto.')).toBeVisible();
  await expect(page.getByText('Ya lo envié')).toHaveCount(0);
});

test('MCK-WIN-02 envío: "Entrega: Envío" sin plazo prometido; el comprador acepta 3 días más que pidió el vendedor', async ({ page, request }) => {
  await reset(request, [{ slug: 'prod01', kind: 'listing', model: 'Bici de montaña', price_crc: 150000 }]);
  await page.goto('/p/prod01');
  await expect(page.getByText('Entrega: Envío', { exact: true })).toBeVisible(); // sin columnas: default
  await page.getByText(/Pagar en custodia/).last().click();
  await page.getByText('Ya pagué', { exact: true }).click();
  // Esperar la respuesta de "Ya pagué" (guarda el código en este navegador = comprador). Si navegamos antes, la petición
  // se aborta, el navegador no queda como comprador y no ve la solicitud de extensión (falló así en CI, mock-chromium).
  await expect(page.getByText(PAID).first()).toBeVisible();
  const slug = page.url().match(/\/p\/(h[0-9a-f]{5})/)![1];
  expect((await state(request)).orders[slug].status).toBe('fondeado');
  const due = Date.now() + 7 * 86_400_000;
  await patch(request, slug, { status: 'enviado', auto_release_at: new Date(due).toISOString(), release_ext: { by: 'seller', days: 3, at: new Date().toISOString() } });
  await page.goto(`/p/${slug}`);
  await expect(page.getByText('El vendedor pidió 3 días más')).toBeVisible();
  await page.getByText('Aceptar', { exact: true }).click();
  await expect.poll(async () => (await state(request)).orders[slug].release_ext).toBeNull();
  expect(Date.parse((await state(request)).orders[slug].auto_release_at) - due).toBe(3 * 86_400_000);
  await expect(page.getByLabel('Pedir más tiempo')).toBeVisible(); // ya sin pendiente: puede pedir otra
});

// Mis compras (build real, sin cuenta): en este archivo (serial) porque los tests mock comparten el mismo backend
// simulado y cada uno hace reset. La compra queda guardada al pagar y se vuelve a encontrar; las anteriores se
// recuperan por la llave de invitado o el PIN guardado; nunca aparecen las de otra llave.
const SHOTS = process.env.MIS_COMPRAS_SHOTS; // carpeta opcional para capturas (no se usa en CI)
const KEY = '7'.repeat(64), OTHER = '8'.repeat(64);

test('MCK-MIS-01 sin cuenta: paga, sale del seguimiento y vuelve desde Mis compras', async ({ page, request }) => {
  await reset(request, [{ slug: 'prod01', kind: 'listing', model: 'Bici de montaña', price_crc: 150000 }]);
  await page.goto('/p/prod01');
  await page.getByText(/Pagar en custodia/).last().click();
  await page.getByText('Ya pagué', { exact: true }).click();
  await expect(page.getByText(PAID).first()).toBeVisible();
  const slug = page.url().match(/\/p\/(h[0-9a-f]{5})/)![1];
  await page.goto('/t/valeria'); // salió de la página de seguimiento
  await page.goto('/comprar/compras');
  const row = page.getByTestId('purchase-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Bici de montaña');
  await expect(row).toContainText('₡150 000');
  await expect(row).toContainText('Esperando que el vendedor lo envíe.');
  await expect(page.getByText(MOCK_PIN)).toHaveCount(0); // el PIN no sale en la lista
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/p/${slug}`));
  await expect(page.getByText(PAID).first()).toBeVisible();
});

test('MCK-MIS-02 recuperación: compras anteriores por la llave y por el PIN guardado; nunca las de otra llave', async ({ page, request }, info) => {
  await reset(request, [
    { slug: 'old111', status: 'enviado', contract_id: 'C1', buyer: KEY, model: 'iPhone 13', price_crc: 250000 },
    { slug: 'pin222', status: 'fondeado', contract_id: 'C2', buyer: 'x', model: 'Consola', price_crc: 90000 },
    { slug: 'done33', status: 'liberado', contract_id: 'C3', buyer: KEY, model: 'Audífonos', price_crc: 20000 },
    { slug: 'otro44', status: 'enviado', contract_id: 'C4', buyer: OTHER, model: 'De otra persona', price_crc: 1000 },
  ]);
  await page.addInitScript(([k]) => { localStorage.setItem('meteorito:guest:v1', k); localStorage.setItem('meteorito:guest:pin:pin222', '135790'); }, [KEY]);
  await page.goto('/comprar/compras');
  const rows = page.getByTestId('purchase-row');
  await expect(rows).toHaveCount(2);
  await expect(page.getByText('iPhone 13')).toBeVisible();
  await expect(page.getByText('Consola')).toBeVisible();
  await expect(page.getByText('De otra persona')).toHaveCount(0);
  await expectNoScroll(page);
  if (SHOTS && info.project.name === 'mock-iphone-se') await page.screenshot({ path: `${SHOTS}/mis-compras-recuperadas.png` });
  await page.getByRole('tab', { name: 'Cerradas, 1' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Audífonos');
  await expect(page.getByText('De otra persona')).toHaveCount(0);
});

test('MCK-MIS-03 navegador nuevo: vacío con texto amable', async ({ page, request }) => {
  await reset(request, []);
  await page.goto('/comprar/compras');
  await expect(page.getByTestId('purchases-empty')).toHaveText('Aquí verás tus compras activas.');
});

// Bug: sin sesión, el icono "Mis compras" de la bienvenida abría la app completa (barra Vender/Comprar/Home + iconos)
// sin salida. Ahora: Comprar entera es pública, sin la barra del vendedor, con "Volver" a la bienvenida.
test('MCK-MIS-04 sin cuenta: bienvenida -> Mis compras sin menús del vendedor; Feed, seguimiento y Volver funcionan', async ({ page, request }, info) => {
  await reset(request, [{ slug: 'trk555', status: 'enviado', contract_id: 'C5', buyer: KEY, model: 'Bici de montaña', price_crc: 150000 }, listing]);
  await page.addInitScript(([k]) => { localStorage.setItem('meteorito:guest:v1', k); }, [KEY]);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('meteorito:purchases:v1', JSON.stringify([{ slug: 'trk555', title: 'Bici de montaña', price_crc: 150000, status: 'enviado' }])));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible(); // bienvenida (sin sesión)
  await page.getByLabel('Mis compras', { exact: true }).click();
  await expect(page).toHaveURL(/\/comprar\/compras$/);
  await expect(page.getByTestId('screen-title')).toHaveText('Mis compras');
  // Un solo menú: los 3 iconos de Comprar; nada de Vender/Comprar/Home ni de login.
  await expect(page.getByRole('tab', { name: 'Vender' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Home' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Comprar' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Feed' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toHaveCount(0);
  const rows = page.getByTestId('purchase-row');
  await expect(rows).toHaveCount(1);
  await expectNoScroll(page);
  if (SHOTS && info.project.name === 'mock-iphone-se') await page.screenshot({ path: `${SHOTS}/miscompras-invitado-lista.png` });
  // Seguimiento y atrás: vuelve a Mis compras.
  await rows.first().click();
  await expect(page).toHaveURL(/\/p\/trk555/);
  await page.getByRole('button', { name: 'Volver' }).first().click();
  await expect(page).toHaveURL(/\/comprar\/compras$/);
  await expect(rows).toHaveCount(1);
  // Feed sin cuenta (no la bienvenida) y de vuelta.
  await page.getByRole('tab', { name: 'Feed' }).click();
  await expect(page).toHaveURL(/\/comprar$/);
  await expect(page.getByTestId('feed-card').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Mis compras' }).click();
  await expect(page).toHaveURL(/\/comprar\/compras$/);
  // Volver: sale a la bienvenida.
  await page.getByTestId('back-button').click();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
});

test('MCK-MIS-05 sin cuenta, sin compras: vacío amable con link al feed', async ({ page, request }, info) => {
  await reset(request, [listing]);
  await page.goto('/comprar/compras');
  await expect(page.getByTestId('purchases-empty')).toHaveText('Aquí verás tus compras activas.');
  await expect(page.getByRole('tab', { name: 'Vender' })).toHaveCount(0);
  await expect(page.getByTestId('back-button')).toBeVisible();
  await expectNoScroll(page);
  if (SHOTS && info.project.name === 'mock-iphone-se') await page.screenshot({ path: `${SHOTS}/miscompras-invitado-vacio.png` });
  await page.getByTestId('purchases-to-feed').click();
  await expect(page).toHaveURL(/\/comprar$/);
  await expect(page.getByTestId('feed-card').first()).toBeVisible();
});

// Compra completa sin cuenta desde la bienvenida: feed -> producto -> pagar (llave de invitado) -> seguimiento -> Mis compras.
test('MCK-BUY-01 sin cuenta: bienvenida -> feed -> producto -> paga -> seguimiento -> Mis compras, sin login en ningún paso', async ({ page, request }) => {
  await reset(request, [listing]);
  await page.goto('/');
  await page.getByText(/Quiero comprar|Comprar sin cuenta/).first().click();
  await expect(page).toHaveURL(/\/comprar$/);
  const card = page.getByTestId('feed-card').filter({ hasText: 'Bici de montaña' }).first();
  await expect(card).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toHaveCount(0);
  await card.getByRole('link', { name: /Bici de montaña/ }).click();
  await expect(page).toHaveURL(/\/p\/prod01/);
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toHaveCount(0);
  await page.getByText(/Pagar en custodia/).last().click();
  await expect(page).toHaveURL(/\/p\/h[0-9a-f]{5}\?pay=1/);
  await page.getByText('Ya pagué', { exact: true }).click();
  await expect(page.getByText(PAID).first()).toBeVisible();
  const slug = page.url().match(/\/p\/(h[0-9a-f]{5})/)![1];
  const api = (await state(request)).calls.filter((c: any) => c.path === '/api/escrow/pay');
  expect(api.length).toBeGreaterThan(0);
  expect(api.every((c: any) => c.guest)).toBe(true); // llave de invitado, nunca login
  await page.getByText('Entendido', { exact: true }).click(); // cierra la hoja "Pagado"
  await page.getByRole('button', { name: 'Volver' }).first().click();
  await expect(page).toHaveURL(/\/comprar$/);
  await page.getByRole('tab', { name: 'Mis compras' }).click();
  await expect(page).toHaveURL(/\/comprar\/compras$/);
  await expect(page.getByTestId('purchase-row')).toHaveCount(1);
  await page.getByTestId('purchase-row').first().click();
  await expect(page).toHaveURL(new RegExp(`/p/${slug}`));
});

test('MCK-MIS-06 sin cuenta: seguimiento abierto directo (sin historial) -> Volver va a Mis compras, no a Home/login', async ({ page, request }, info) => {
  await reset(request, [{ slug: 'trk666', status: 'enviado', contract_id: 'C6', buyer: KEY, model: 'Consola', price_crc: 90000 }]);
  await page.addInitScript(([k]) => { localStorage.setItem('meteorito:guest:v1', k); }, [KEY]);
  await page.goto('/p/trk666');
  await expect(page.getByText('Consola').first()).toBeVisible();
  if (SHOTS && info.project.name === 'mock-iphone-se') await page.screenshot({ path: `${SHOTS}/seguimiento-invitado.png` });
  await page.getByRole('button', { name: 'Volver' }).first().click();
  await expect(page).toHaveURL(/\/comprar\/compras$/);
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('purchase-row')).toHaveCount(1);
});

test('MCK-MIS-07 sin cuenta: bienvenida -> Privacidad -> Volver vuelve a la bienvenida', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Privacidad', { exact: true }).first().click();
  await expect(page).toHaveURL(/\/legal\//);
  await page.getByRole('button', { name: 'Volver' }).first().click();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
});

// ---- Recibe avisos de tu compra (comprador sin cuenta): tarjeta, recuperación con link y vuelta del login de Cavos ----
// En este archivo (serial) y no en uno aparte: todos los mock-* comparten el estado del servidor simulado.
const cntOrder = { slug: 'cnt001', kind: 'single', model: 'Bici de montaña', price_crc: 150000 };
/** Capturas para revisión (solo local: E2E_SHOTS=<carpeta>). */
const shot = (page: Page, name: string, project: string) => (process.env.E2E_SHOTS && project.includes('iphone-se') ? page.screenshot({ path: `${process.env.E2E_SHOTS}/contacto-${name}.png` }).catch(() => {}) : Promise.resolve());

async function payAsGuestCnt(page: Page, slug = 'cnt001') {
  await page.goto(`/p/${slug}`);
  await page.getByText(/Pagar en custodia/).last().click();
  await expect(page.getByText('Paga por SINPE Móvil')).toBeVisible();
  await page.getByText('Ya pagué', { exact: true }).click();
  await expect(page.getByText(PAID).first()).toBeVisible();
  await page.getByText('Entendido', { exact: true }).click(); // cierra la hoja "Pagado"
}
async function noHScroll(page: Page) {
  await settle(page);
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, wide: [...document.querySelectorAll('[data-testid="contact-card"] *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).length }));
  expect(w.sw, 'scroll horizontal').toBeLessThanOrEqual(w.iw + 1);
  expect(w.wide, 'algo de la tarjeta se sale de la pantalla').toBe(0);
}
const cntCopyOk = async (page: Page) => { const t = await page.getByTestId('contact-card').innerText(); expect(t).not.toMatch(BANNED); expect(t).not.toMatch(VOSEO); expect(t).not.toMatch(/\p{Extended_Pictographic}/u); };

test('CNT-01 sin la migración 028: no hay tarjeta y el pago sigue igual', async ({ page, request }) => {
  await reset(request, [cntOrder]);
  await payAsGuestCnt(page);
  expect((await state(request)).orders.cnt001.status).toBe('fondeado');
  await expect(page.getByText(PAID).first()).toBeVisible();
  await expect(page.getByTestId('contact-card')).toHaveCount(0);
});

test('CNT-02 WhatsApp (+506) y correo se guardan sin salir de la compra; consentimiento obligatorio', async ({ page, request }, info) => {
  await reset(request, [cntOrder], false, 'inapp', true);
  await payAsGuestCnt(page);
  const card = page.getByTestId('contact-card');
  await expect(card.getByText('Recibe avisos de tu compra')).toBeVisible();
  for (const o of ['WhatsApp', 'Correo', 'Crear cuenta']) await expect(card.getByRole('radio', { name: o })).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  await shot(page, 'tarjeta', info.project.name);
  const url = page.url();
  await card.getByRole('radio', { name: 'WhatsApp' }).click();
  await expect(page.getByTestId('contact-cc')).toHaveValue('+506');
  await page.getByTestId('contact-phone').fill('8888 7777');
  await expectInputs16(page);
  await expect(page.getByTestId('contact-save')).toBeDisabled(); // sin la casilla
  await page.getByTestId('contact-consent').click();
  await expect(card.getByText('Acepto que Meteorito use este contacto solo para avisarme sobre esta compra.')).toBeVisible();
  await noHScroll(page); await cntCopyOk(page);
  await shot(page, 'whatsapp', info.project.name);
  await page.getByTestId('contact-save').click();
  await expect(page.getByTestId('contact-saved-whatsapp')).toContainText('+506 •••• 7777');
  expect(page.url()).toBe(url); // nunca navega
  await card.getByRole('radio', { name: 'Correo' }).click();
  await page.getByTestId('contact-email').fill('ana@correo.cr');
  await page.getByTestId('contact-consent').click();
  await page.getByTestId('contact-save').click();
  await expect(page.getByTestId('contact-saved-email')).toContainText('a••@correo.cr');
  expect(page.url()).toBe(url);
  const s = await state(request);
  expect(s.contacts.cnt001.map((c: any) => c.consent_version).every(Boolean)).toBe(true);
  expect(s.orders.cnt001.status).toBe('fondeado');
  await noHScroll(page);
  await card.scrollIntoViewIfNeeded();
  await shot(page, 'guardado', info.project.name);
});

test('CNT-03 "Ahora no" la oculta para esta compra (sin volver a insistir)', async ({ page, request }) => {
  await reset(request, [cntOrder], false, 'inapp', true);
  await payAsGuestCnt(page);
  await page.getByTestId('contact-card').getByLabel('Ahora no').click();
  await expect(page.getByTestId('contact-card')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(PAID).first()).toBeVisible();
  await expect(page.getByTestId('contact-card')).toHaveCount(0);
});

test('CNT-04 Crear cuenta: el login vuelve a la MISMA /p/<slug> (redirect de Google/Apple) con la compra intacta', async ({ page, request }, info) => {
  await reset(request, [cntOrder], false, 'inapp', true);
  await payAsGuestCnt(page);
  const before = await page.evaluate(() => ({ key: localStorage.getItem('meteorito:guest:v1'), pin: localStorage.getItem('meteorito:guest:pin:cnt001') }));
  expect(before.pin).toBe(MOCK_PIN);
  const card = page.getByTestId('contact-card');
  await card.getByRole('radio', { name: 'Crear cuenta' }).click();
  await page.getByTestId('contact-consent').click();
  await page.getByTestId('contact-save').click();
  await expect(page.getByTestId('contact-account-pending')).toBeVisible();
  // El redirect_uri de Cavos es location.href: tiene que ser la compra, sin tokens.
  expect(new URL(page.url()).pathname).toBe('/p/cnt001');
  expect(page.url()).not.toContain('acceso=');
  const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('meteorito:contact:link-pending') || 'null'));
  expect(pending?.slug).toBe('cnt001');
  // Vuelta del proveedor OAuth (otra carga completa de la página, como en iPhone).
  await page.goto('/p/cnt001?cavos_auth_code=e2e-code&state=e2e');
  await expect(page.getByText(PAID).first()).toBeVisible();
  await expect(page.getByTestId('contact-account-pending')).toBeVisible(); // retoma el vínculo pendiente
  const after = await page.evaluate(() => ({ key: localStorage.getItem('meteorito:guest:v1'), pin: localStorage.getItem('meteorito:guest:pin:cnt001') }));
  expect(after).toEqual(before); // misma llave y mismo código: la compra sigue en este dispositivo
  await expect(page.getByText('Tengo un problema')).toBeVisible();
  await noHScroll(page);
  await page.getByTestId('contact-card').scrollIntoViewIfNeeded();
  await shot(page, 'cuenta-vuelta', info.project.name);
  await page.getByTestId('contact-account-pending').getByText('Cancelar', { exact: true }).click();
  await expect(page.getByTestId('contact-account-pending')).toHaveCount(0);
});

test('CNT-05 link de acceso en OTRO dispositivo: recupera la compra, quita el token de la URL y genera un código nuevo', async ({ browser, request }, info) => {
  await reset(request, [cntOrder], false, 'inapp', true);
  const a = await (await browser.newContext({ ...info.project.use })).newPage();
  await payAsGuestCnt(a);
  await patch(request, 'cnt001', { status: 'enviado', shipped_tx: 's'.repeat(64) });
  const tok = await accessToken(request, 'cnt001');
  const b = await (await browser.newContext({ ...info.project.use })).newPage(); // teléfono nuevo: sin llave ni PIN
  await b.goto('/p/cnt001');
  await expect(b.getByTestId('recover-open')).toBeVisible(); // sin acceso: ofrece pedir el link
  await b.goto(`/p/cnt001?acceso=${tok}`);
  await expect(b.getByTestId('access-msg')).toContainText('Recuperaste el acceso a tu compra en este dispositivo.');
  await expect.poll(() => b.url()).not.toContain('acceso=');
  await expect(b.getByText('Recibí y está bien')).toBeVisible();
  await expect(b.getByText('Tengo un problema')).toBeVisible();
  await b.getByTestId('pin-reissue').click();
  await expect(b.getByTestId('delivery-code')).toHaveText('246802');
  await shot(b, 'acceso-recuperado', info.project.name);
  const s = await state(request);
  expect(s.calls.some((c: any) => c.action === 'buyer_pin_reissue' && c.access)).toBe(true);
  // Recarga: el permiso queda en el dispositivo.
  await b.reload();
  await expect(b.getByText('Recibí y está bien')).toBeVisible();
  // Link inválido: mensaje claro, la página sigue.
  const c = await (await browser.newContext({ ...info.project.use })).newPage();
  await c.goto('/p/cnt001?acceso=acc-falso');
  await expect(c.getByTestId('access-msg')).toContainText('Este link venció');
  await expect(c.getByTestId('recover-open')).toBeVisible();
});

test('MCK-SRCH-01 sin cuenta: la lupa abre el buscador y filtra el feed (sin barra de pestañas)', async ({ page, request }) => {
  await reset(request, [listing, { slug: 'prod02', kind: 'listing', model: 'Consola PS5', price_crc: 300000 }]);
  const urls: string[] = []; page.on('request', (r) => urls.push(r.url()));
  await page.goto('/comprar');
  await expect(page.getByRole('tab', { name: 'Vender' })).toHaveCount(0);
  await page.getByTestId('comprar-search').click();
  const input = page.getByLabel('Buscar productos', { exact: true });
  await expect(input).toBeFocused();
  await input.fill('bici de monta'); await input.press('Enter');
  await expect(page.getByTestId('search-chip')).toContainText('bici de monta');
  await expect(page.getByTestId('feed-card')).toHaveCount(1);
  await expect(page.getByTestId('feed-card').first()).toContainText('Bici de montaña');
  expect(urls.filter((u) => /[?&]q=|bici%20de|monta/i.test(u)), 'el texto buscado nunca va en una URL (logs, analítica)').toEqual([]);
});
