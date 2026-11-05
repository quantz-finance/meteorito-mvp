// "Descargar app" (PWA) en la bienvenida, build REAL (proyectos mock-iphone-se = Safari de iPhone, mock-chromium = Pixel 7).
// - Se ve en la web cuando no está instalada; ya instalada (display-mode: standalone) no aparece.
// - ?instalar=1 (botón del landing) abre la hoja sola: iPhone -> guía Compartir / Agregar a pantalla de inicio;
//   Chromium -> botón grande "Instalar" que llama a prompt() del beforeinstallprompt guardado.
import { expect, test, type Page } from '@playwright/test';
import { BANNED, VOSEO } from './helpers';
import { reset } from './mock';

test.describe.configure({ mode: 'serial' });
const isIos = (name: string) => name.includes('iphone');

/** beforeinstallprompt simulado (Chromium headless no lo manda): guarda en window.__bip las llamadas a prompt(). */
async function fakeInstallPrompt(page: Page, outcome: 'accepted' | 'dismissed' = 'accepted') {
  await page.evaluate((o) => {
    const w = window as any; w.__bip = { prompted: 0 };
    const e: any = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => { w.__bip.prompted++; return Promise.resolve(); };
    e.userChoice = Promise.resolve({ outcome: o, platform: 'web' });
    window.dispatchEvent(e);
    w.__bip.prevented = e.defaultPrevented;
  }, outcome);
}

test('MCK-INS-01 bienvenida: "Descargar app" visible en la web (sin instalar)', async ({ page, request }, info) => {
  await reset(request, []);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  const btn = page.getByTestId('install-app-button');
  await expect(btn).toBeVisible();
  await expect(btn).toContainText('Descargar app');
  // No tapa la mascota ni el título
  const b = (await btn.boundingBox())!; const title = (await page.getByText('Meteorito', { exact: true }).first().boundingBox())!;
  expect(b.y + b.height).toBeLessThanOrEqual(title.y);
  await expect(page.getByTestId('install-sheet')).toHaveCount(0); // sin ?instalar=1 no abre nada solo
  await btn.click();
  if (isIos(info.project.name)) {
    await expect(page.getByTestId('install-sheet')).toBeVisible();
    await expect(page.getByText('Toca el botón Compartir')).toBeVisible();
  } else {
    // Chromium sin aviso del navegador: instrucciones del menú
    await expect(page.getByTestId('install-sheet')).toBeVisible();
    await expect(page.getByText('Abre el menú del navegador')).toBeVisible();
  }
});

test('MCK-INS-02 ?instalar=1 abre la hoja sola (iPhone: guía de 2 pasos; Chromium: "Instalar" -> prompt())', async ({ page, request }, info) => {
  await reset(request, []);
  await page.goto('/?instalar=1');
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  const sheet = page.getByTestId('install-sheet');
  if (isIos(info.project.name)) {
    await expect(sheet).toBeVisible();
    await expect(page.getByText('Agrega Meteorito a tu inicio')).toBeVisible();
    await expect(sheet).toContainText('Toca el botón Compartir');
    await expect(sheet).toContainText('Agregar a pantalla de inicio');
  } else {
    await fakeInstallPrompt(page);
    expect(await page.evaluate(() => (window as any).__bip.prevented)).toBe(true); // sin la mini barra del navegador
    await expect(sheet).toBeVisible();
    await page.getByTestId('install-sheet-confirm').click();
    await expect.poll(() => page.evaluate(() => (window as any).__bip.prompted)).toBe(1);
    await expect(sheet).toHaveCount(0); // aceptado: se cierra y el botón se va
    await expect(page.getByTestId('install-app-button')).toHaveCount(0);
  }
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(BANNED);
  expect(text).not.toMatch(VOSEO);
});

test('MCK-INS-03 Chromium: un toque en "Descargar app" abre el aviso del navegador', async ({ page, request }, info) => {
  test.skip(isIos(info.project.name), 'iOS no permite instalar por código');
  await reset(request, []);
  await page.goto('/');
  await expect(page.getByTestId('install-app-button')).toBeVisible();
  await fakeInstallPrompt(page, 'dismissed');
  await page.getByTestId('install-app-button').click();
  await expect.poll(() => page.evaluate(() => (window as any).__bip.prompted)).toBe(1);
  await expect(page.getByTestId('install-sheet')).toHaveCount(0); // directo, sin hoja
  await expect(page.getByTestId('install-app-button')).toBeVisible(); // lo cerró: el botón sigue
});

test('MCK-INS-04 ya instalada (standalone) o in-app: sin botón / "Abre este link en Safari"', async ({ browser, request }, info) => {
  await reset(request, []);
  const ctx = await browser.newContext({ ...(info.project.use as any) });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q: string) => (q.includes('display-mode: standalone') ? ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} } as any) : mm(q));
  });
  await page.goto('/?instalar=1');
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  await expect(page.getByTestId('install-app-button')).toHaveCount(0);
  await expect(page.getByTestId('install-sheet')).toHaveCount(0);
  await ctx.close();
  if (!isIos(info.project.name)) return;
  const ig = await browser.newContext({ ...(info.project.use as any), userAgent: `${(info.project.use as any).userAgent} Instagram 389.0.0.29.84` });
  const p2 = await ig.newPage();
  await p2.goto('/?instalar=1');
  await expect(p2.getByTestId('install-sheet')).toBeVisible();
  await expect(p2.getByText('Abre este link en Safari para instalar')).toBeVisible();
  await expect(p2.getByTestId('install-copy-link')).toBeVisible();
  await ig.close();
});
