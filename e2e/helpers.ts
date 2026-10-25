import { expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

import { BETA_NOTICE, CUSTODY_NOTICE } from '../lib/rules';
/** Regla "sin etiquetas de modo prueba / testnet en la UI": la ÚNICA excepción es el aviso de beta aprobado (BETA_NOTICE,
 *  texto exacto en lib/rules.ts) y el pie del producto (CUSTODY_NOTICE, aprobado por Neo). Se quitan SOLO esas constantes del texto antes de revisar; cualquier otra mención falla. */
export const withoutBetaNotice = (text: string) => text.split(CUSTODY_NOTICE).join('').split(BETA_NOTICE).join('');
export const PHOTO = resolve(__dirname, '../scripts/demo/assets/producto-demo.png');
export const DEMO_PIN = '482915';
/** Fotos "solo cámara": abre la cámara de la app (simulada en el demo), dispara y usa la foto. Nunca hay selector de archivos. */
export async function takePhoto(page: Page, label: string | RegExp = 'Tomar foto') {
  await page.getByLabel(label, { exact: typeof label === 'string' }).last().click();
  await expect(page.getByTestId('camera-capture')).toBeVisible();
  await expect(page.getByTestId('camera-shutter')).toBeEnabled();
  await page.getByTestId('camera-shutter').click();
  await expect(page.getByTestId('camera-shot')).toBeVisible();
  await page.getByText('Usar foto', { exact: true }).click();
  await expect(page.getByTestId('camera-capture')).toHaveCount(0);
}
/** Tras pagar: el código de entrega NO se muestra hasta que el vendedor toca "Ya lo envié". */
export const PAID = /Pagado\. Esperando que el vendedor lo envíe/;
type Role = 'seller' | 'buyer';

const quietPages = new WeakSet<Page>();
/** Abre una ruta del demo con el rol dado (badge oculto para medir layout real).
 *  La invitación a mostrar la última conexión (hoja después del primer link) se da por vista, salvo seenInvite: true
 *  (solo activity.spec la prueba; así no tapa la pantalla de "link listo" en los demás tests). */
export async function open(page: Page, path: string, role: Role, reset = false, o: { seenInvite?: boolean } = {}) {
  if (!o.seenInvite && !quietPages.has(page)) {
    quietPages.add(page);
    await page.addInitScript(() => {
      const get = Storage.prototype.getItem;
      Storage.prototype.getItem = function (k: string) { return k.startsWith('meteorito:last-seen-invite:') ? '1' : get.call(this, k); };
    });
  }
  const sep = path.includes('?') ? '&' : '?';
  await page.goto(`${path}${sep}role=${role}&badge=0${reset ? '&demo_reset=1' : ''}`);
  await page.waitForFunction(() => !!(window as any).__meteoritoDemo);
}
/** Crea un pedido de ejemplo hasta el estado pedido (usa el mismo API simulado que la UI). */
export async function seed(page: Page, upTo: 'creado' | 'fondeado' | 'enviado', title = 'Bici de montaña'): Promise<string> {
  return page.evaluate(([u, t]) => (window as any).__meteoritoDemo.seed(u, { title: t, price_crc: 150000 }), [upTo, title] as const);
}
export async function orderStatus(page: Page, slug: string): Promise<string> {
  return page.evaluate((s) => JSON.parse(sessionStorage.getItem('meteorito:demo:v1') || '{}').orders?.[s]?.status, slug);
}
/** La página no tiene scroll vertical a nivel de documento. */
/** Espera a que terminen las animaciones de entrada (finitas): mide el layout final, no un cuadro a mitad del deslizamiento.
 *  Ignora las infinitas (universo de fondo, mascota). */
export async function settle(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => {
    const it = (a.effect as KeyframeEffect | null)?.getTiming().iterations;
    return it === Infinity || a.playState !== 'running';
  }), undefined, { timeout: 5000 }).catch(() => {});
}
export async function expectNoScroll(page: Page) {
  await settle(page);
  const m = await page.evaluate(() => ({ sh: document.scrollingElement!.scrollHeight, ih: window.innerHeight }));
  expect(m.sh, `scrollHeight ${m.sh} > innerHeight ${m.ih}`).toBeLessThanOrEqual(m.ih + 1);
}
/** Todos los inputs visibles con letra >= 16 px (si no, iOS hace zoom al enfocar). */
export async function expectInputs16(page: Page) {
  const small = await page.evaluate(() => [...document.querySelectorAll('input, textarea')]
    .filter((i) => (i as HTMLElement).offsetParent !== null && parseFloat(getComputedStyle(i).fontSize) < 16)
    .map((i) => `${(i as HTMLInputElement).placeholder}:${getComputedStyle(i).fontSize}`));
  expect(small, 'inputs con letra < 16 px').toEqual([]);
}
/** El título de la pantalla arranca en x=16, y=16 (respecto del área de contenido). */
export async function expectTitleAt16(page: Page, title: string) {
  const box = await page.getByText(title, { exact: true }).first().boundingBox();
  expect(box, `no encontré el título "${title}"`).not.toBeNull();
  expect(Math.round(box!.x)).toBe(16);
  expect(Math.abs(box!.y - 16)).toBeLessThanOrEqual(6); // línea de texto: tolerancia por interlineado
}
const word = (alts: string) => new RegExp(`(?<![\p{L}])(${alts})(?![\p{L}])`, 'iu');
export const BANNED = word('seguro|segura|protegido|protegida|garantía|garantia|garantizado|pronto|regulado');
export const VOSEO = word('tenés|podés|querés|sabés|pagás|confirmá|tocá|escribí|recordá|mirá|fijate');
/** Abre la fila del vendedor con ese estado y espera a que la hoja muestre `ready` (reintenta si la lista se reordenó al cargar). */
export async function openSellerRow(page: Page, statusText: string | RegExp, ready: string | RegExp) {
  await expect(async () => {
    await open(page, '/pedidos', 'seller');
    // Home: filas de "Tus ventas" con una pastilla corta (Envíalo/Entrégalo cuando te toca, Enviado, En disputa…).
    // Si la venta no cabe en la pantalla, está en "Ver todas · N" (hoja con la lista completa).
    const sel = () => page.locator('[data-testid^="home-sale-row"]').filter({ hasText: statusText }).first();
    await expect(page.locator('[data-testid^="home-sale-row"]').first()).toBeVisible({ timeout: 5000 });
    if (!(await sel().isVisible())) { const more = page.getByRole('button', { name: /\(ventas\)$/ }); if (await more.count()) await more.click(); }
    const row = sel();
    await expect(row).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(250);
    await row.click({ timeout: 5000 });
    await expect(typeof ready === 'string' ? page.getByPlaceholder(ready) : page.getByText(ready).last()).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 35000 });
}

/** Buscador de Comprar (modalcito): toca la lupa, escribe y Enter (cierra la hoja y aplica la búsqueda). */
export async function searchFeed(page: Page, text: string) {
  await page.getByTestId('comprar-search').click();
  const input = page.getByLabel('Buscar productos', { exact: true });
  await expect(input).toBeFocused();
  await input.fill(text);
  await input.press('Enter');
  await expect(input).toHaveCount(0);
}

/** Neo (legal): ningún aviso legal (data-legal: aviso de beta, "Ver reglas", "Cómo funciona") ni ningún contenedor suyo
 *  tiene una animación de entrada con opacidad: su estado inicial ya es el final, aunque la animación falle, se pause o
 *  vaya lenta. Devuelve por aviso: opacidad efectiva (producto con sus ancestros) y las animaciones de entrada que lo tocan. */
export async function legalNotices(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-legal]')].map((el) => {
    let o = 1; const anims: string[] = [];
    for (let e: Element | null = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e); o *= parseFloat(cs.opacity);
      for (const n of cs.animationName.split(',').map((x) => x.trim())) if (/^m-(enter|fade|pop|swap|toast|msg|ap-)/.test(n)) anims.push(n);
    }
    // Además: aunque una animación corriendo se congelara en su primer cuadro, el aviso sigue a opacidad 1.
    const frozen = el.getAnimations({ subtree: false }).length + anims.length;
    return { id: (el as HTMLElement).dataset.testid ?? el.textContent?.slice(0, 30), opacity: o, anims, frozen };
  }));
}
export async function expectLegalVisible(page: Page, ids: string[]) {
  for (const id of ids) await expect(page.getByTestId(id).first()).toBeVisible();
  const list = await legalNotices(page);
  for (const id of ids) expect(list.some((l) => l.id === id), `aviso ${id} marcado data-legal`).toBe(true);
  for (const l of list) expect(l, `aviso ${l.id} fuera de animaciones de entrada`).toMatchObject({ opacity: 1, anims: [], frozen: 0 });
}
/** Vender: orden importar, nombre, precio, "Entrega y plazo", fotos, "Generar link" (en su propio espacio, sin encimarse con
 *  nada), "El pago se libera… Ver reglas" y beta (completos, debajo del círculo y arriba de las pestañas); todo sin scroll. */
export async function expectVenderLayout(page: Page, o: { minCore?: number } = {}) {
  await settle(page);
  const get = async (l: ReturnType<Page['locator']>, name: string) => { const b = await l.first().boundingBox(); expect(b, `no encontré ${name}`).not.toBeNull(); return b!; };
  const btn = await get(page.getByTestId('launch-button'), 'el círculo');
  const space = await get(page.getByTestId('launch-space'), 'el espacio del círculo');
  const agree = await get(page.getByRole('button', { name: 'Entrega y plazo' }), 'Entrega y plazo');
  const photos = await get(page.getByTestId('sell-photos'), 'las fotos');
  await expect(page.getByText('De 1 a 4 fotos con la cámara, en este momento.')).toHaveCount(0); // Rolando: sin ese texto
  const lock = await get(page.getByTestId('rules-hint'), 'el aviso de liberación');
  const beta = await get(page.getByTestId('beta-notice'), 'el aviso de beta');
  const tabs = await get(page.getByRole('tablist'), 'las pestañas');
  const vp = page.viewportSize()!;
  type B = { x: number; y: number; width: number; height: number };
  const hit = (a: B, b: B) => a.x < b.x + b.width - 0.5 && a.x + a.width > b.x + 0.5 && a.y < b.y + b.height - 0.5 && a.y + a.height > b.y + 0.5;
  expect(btn.width, 'círculo grande').toBeGreaterThanOrEqual(o.minCore ?? 96);
  expect(Math.abs(btn.width - btn.height)).toBeLessThanOrEqual(1);
  // el círculo vive dentro de su espacio, que va entre las fotos y los avisos
  expect(btn.y).toBeGreaterThanOrEqual(space.y - 0.5); expect(btn.y + btn.height).toBeLessThanOrEqual(space.y + space.height + 0.5);
  expect(space.y).toBeGreaterThanOrEqual(photos.y + photos.height - 0.5);
  for (const [n, b] of [['Entrega y plazo', agree], ['fotos', photos], ['aviso de liberación', lock], ['aviso de beta', beta], ['pestañas', tabs]] as const)
    expect(hit(btn, b), `"Generar link" ${JSON.stringify(btn)} se encima con ${n} ${JSON.stringify(b)}`).toBe(false);
  // orden: Entrega y plazo -> fotos -> círculo -> liberación -> beta -> pestañas
  expect(agree.y + agree.height).toBeLessThanOrEqual(photos.y + 0.5);
  expect(photos.y + photos.height).toBeLessThanOrEqual(btn.y);
  expect(btn.y + btn.height).toBeLessThanOrEqual(lock.y);
  expect(lock.y + lock.height).toBeLessThanOrEqual(beta.y + 0.5);
  expect(beta.y + beta.height).toBeLessThanOrEqual(tabs.y);
  for (const b of [btn, photos, lock, beta]) { expect(b.y).toBeGreaterThanOrEqual(0); expect(b.y + b.height).toBeLessThanOrEqual(vp.height); }
  // nada encima de los avisos: el punto medio de cada línea es del propio aviso
  const covered = await page.evaluate(() => ['rules-hint', 'beta-notice'].flatMap((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`)!; const r = el.getBoundingClientRect();
    return [0.25, 0.75].map((f) => { const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height * f); return t && el.contains(t) ? null : `${id}@${f}: ${t?.outerHTML.slice(0, 80)}`; }).filter(Boolean);
  }));
  expect(covered, 'avisos tapados').toEqual([]);
  // sin scroll: ni la página ni el contenedor de la pantalla
  const sc = await page.getByTestId('beta-notice').evaluate((el) => { for (let e = el.parentElement; e; e = e.parentElement) { const cs = getComputedStyle(e); if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1) return e.scrollHeight - e.clientHeight; } return 0; });
  expect(sc, 'Vender hace scroll').toBe(0);
  await expectNoScroll(page);
}
