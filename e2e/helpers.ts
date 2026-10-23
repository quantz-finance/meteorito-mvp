import { expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';

export const PHOTO = resolve(__dirname, '../scripts/demo/assets/producto-demo.png');
export const DEMO_PIN = '482915';
type Role = 'seller' | 'buyer';

/** Abre una ruta del demo con el rol dado (badge oculto para medir layout real). */
export async function open(page: Page, path: string, role: Role, reset = false) {
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
export async function expectNoScroll(page: Page) {
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
