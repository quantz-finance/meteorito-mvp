// Build REAL + backend simulado (scripts/e2e/mock-server.mjs): el comprador sin cuenta tal como corre en producción.
import { test, expect, type Page } from '@playwright/test';
import { reset, state, patch, failNext, calls, MOCK_PIN } from './mock';
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
  await expect(page.getByText(MOCK_PIN)).toBeVisible();
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
  await expect(page.getByText(MOCK_PIN)).toBeVisible();
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
  await expect(page.getByText(MOCK_PIN)).toBeVisible();
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
  await expect(page.getByText(MOCK_PIN)).toBeVisible();
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

// ---- Pago con tarjeta (Lendara): el widget real (@lendara/widget, iframe) abre un widget simulado del mismo origen
// (scripts/e2e/mock-server.mjs) que postea { transaction } como el de Lendara. Mismo archivo: el mock guarda estado (serie).

async function openMethods(page: Page) {
  await page.goto('/p/prod01');
  await page.getByText(/Pagar en custodia/).last().click();
  await expect(page.getByText('Elige cómo pagar')).toBeVisible();
}
async function payWithCard(page: Page, number: string) {
  await page.getByText('Pagar con tarjeta', { exact: true }).click();
  const w = page.frameLocator('iframe.lendara-frame');
  await w.locator('#n').fill(number);
  await w.getByText('Pagar', { exact: true }).click();
}

test('MCK-CARD-01 invitado paga con tarjeta aprobada: PIN y pedido en custodia', async ({ page, request }) => {
  await reset(request, [listing], true);
  await openMethods(page);
  // Sin scroll en iPhone SE: las dos opciones se ven completas
  await expect(page.getByText('Pagar con tarjeta', { exact: true })).toBeInViewport();
  await expect(page.getByText('Pagar por SINPE Móvil', { exact: true })).toBeInViewport();
  await expect(page.getByText(/modo prueba|4242/i)).toHaveCount(0); // sin etiquetas de prueba en la UI
  await payWithCard(page, '4242 4242 4242 4242');
  await expect(page.getByText(MOCK_PIN)).toBeVisible();
  await expect(page.locator('iframe.lendara-frame')).toHaveCount(0);
  const slug = page.url().match(/\/p\/(h[0-9a-f]{5})/)![1];
  expect((await state(request)).orders[slug].status).toBe('fondeado');
  expect(await calls(request, '/api/escrow/pay', 'card_session')).toHaveLength(1);
  expect(await calls(request, '/api/escrow/pay', 'card_confirm')).toHaveLength(1);
  expect(await calls(request, '/api/escrow/pay', 'confirm_sinpe')).toHaveLength(0);
});

test('MCK-CARD-02 KYC rechazado: mensaje claro y puede pagar por SINPE', async ({ page, request }) => {
  await reset(request, [listing], true);
  await openMethods(page);
  await payWithCard(page, '4000 0000 0000 0002');
  await page.frameLocator('iframe.lendara-frame').getByText('Cerrar', { exact: true }).click();
  await expect(page.getByText(/No pudimos verificar tu identidad/)).toBeVisible();
  await page.getByText('Pagar por SINPE Móvil', { exact: true }).click();
  await expect(page.getByText('Paga por SINPE Móvil')).toBeVisible();
  await page.getByText('Ya pagué', { exact: true }).click();
  await expect(page.getByText(MOCK_PIN)).toBeVisible();
});

test('MCK-CARD-03 cerrar el widget sin pagar: vuelve a las opciones, sin error ni confirmación', async ({ page, request }) => {
  await reset(request, [listing], true);
  await openMethods(page);
  await page.getByText('Pagar con tarjeta', { exact: true }).click();
  await page.frameLocator('iframe.lendara-frame').getByText('Cerrar', { exact: true }).click();
  await expect(page.getByText('Elige cómo pagar')).toBeVisible();
  await expect(page.getByText(/No pudimos|no se pudo/)).toHaveCount(0);
  expect(await calls(request, '/api/escrow/pay', 'card_confirm')).toHaveLength(0);
});

test('MCK-CARD-04 sin pago con tarjeta configurado: directo al SINPE (como antes)', async ({ page, request }) => {
  await reset(request, [listing]);
  await page.goto('/p/prod01');
  await page.getByText(/Pagar en custodia/).last().click();
  await expect(page.getByText('Paga por SINPE Móvil')).toBeVisible();
  await expect(page.getByText('Pagar con tarjeta', { exact: true })).toHaveCount(0);
});
