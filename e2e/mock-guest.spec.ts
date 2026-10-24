// Build REAL + backend simulado (scripts/e2e/mock-server.mjs): el comprador sin cuenta tal como corre en producción.
import { test, expect, type Page } from '@playwright/test';
import { reset, state, patch, failNext, calls, MOCK_PIN } from './mock';
import { PAID } from './helpers';
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
  const pub = await (await request.get(`http://localhost:8084/sb/rest/v1/public_orders?slug=eq.${slug}`)).json();
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
  await expect(page.getByText('Tu calificación ayuda a otros compradores.')).toBeVisible();
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
  await expect(page).toHaveURL(/\/i\/nueva/);
  await page.goto('/p/prod01'); // otra carga sin UTMs
  await expect.poll(async () => (await phEvents(request, 'payment_link_opened')).length, { timeout: 20_000 }).toBeGreaterThan(0);
  const linkOpened = (await phEvents(request, 'payment_link_opened'))[0];
  expect(linkOpened.properties).toMatchObject({ utm_source: 'landing', utm_content: 'hero' });
  const screens = (await phEvents(request, 'screen_viewed')).filter((e) => e.properties.screen === '/i/nueva');
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
