// Guion de ejemplo (Playwright) para grabar el video del flujo completo en MODO DEMO. Viewport 1280x720.
// Requisitos: build con EXPO_PUBLIC_DEMO_MODE=1 servido (ver docs/demo.md) y `npx playwright install chromium`.
//
//   DEMO_URL=http://localhost:8081 npx tsx scripts/demo/record.ts
//
// Variables opcionales:
//   DEMO_URL        base de la app (default http://localhost:8081)
//   DEMO_BADGE=0    oculta el distintivo "Modo demo · testnet"
//   DEMO_PACE=1.5   multiplica todas las pausas (1 = normal; 2 = el doble de lento)
//   DEMO_VIDEO_DIR  si se define, graba video (.webm) de la sesión en esa carpeta
//   DEMO_SHOTS_DIR  si se define, guarda una captura PNG por paso
//   DEMO_HEADED=1   muestra el navegador
import { chromium, type Page } from 'playwright';
import { join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const BASE = (process.env.DEMO_URL ?? 'http://localhost:8081').replace(/\/$/, '');
const PACE = Number(process.env.DEMO_PACE ?? 1);
const SHOTS = process.env.DEMO_SHOTS_DIR ? resolve(process.env.DEMO_SHOTS_DIR) : null;
const VIDEO = process.env.DEMO_VIDEO_DIR ? resolve(process.env.DEMO_VIDEO_DIR) : null;
const PHOTO = resolve(__dirname, 'assets/producto-demo.png');
const badge = process.env.DEMO_BADGE === '0' ? '&badge=0' : '&badge=1';

/** Pausa legible para video (los textos tienen que poder leerse). */
const beat = (page: Page, ms = 1800) => page.waitForTimeout(ms * PACE);
async function shot(page: Page, name: string) { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) }); }
const tap = async (page: Page, text: string | RegExp, pause = 1200) => { await page.getByText(text, { exact: typeof text === 'string' }).last().click(); await beat(page, pause); };
const role = (page: Page, r: 'seller' | 'buyer') => page.evaluate((x) => (window as any).__meteoritoDemo.setRole(x), r);

(async () => {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  if (VIDEO) mkdirSync(VIDEO, { recursive: true });
  const browser = await chromium.launch({ headless: process.env.DEMO_HEADED !== '1' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, locale: 'es-CR', ...(VIDEO ? { recordVideo: { dir: VIDEO, size: { width: 1280, height: 720 } } } : {}) });
  const page = await ctx.newPage();
  page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/')) throw new Error(`El demo llamó al backend: ${r.url()}`); });

  // Arranque limpio como vendedor
  await page.goto(`${BASE}/?demo_reset=1&role=seller${badge}`);
  await page.getByText('Vender').first().waitFor();
  await beat(page, 2500); await shot(page, '00-inicio-vendedor');

  // (1) Vendedor crea el link de pago
  await tap(page, 'Vender', 1500);              // acción "Vender" de Inicio
  await tap(page, 'Continuar', 1200);           // categoría: Celular (por defecto)
  await page.getByText('Agregar (0/4)').click().catch(() => {});
  // El selector de fotos abre un file chooser
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('Agregar (0/4)').click().catch(() => {});
  await (await chooser.catch(() => null))?.setFiles(PHOTO);
  await beat(page, 1500); await shot(page, '01a-fotos');
  await tap(page, 'Continuar', 1000);
  await page.getByPlaceholder('Ej. Apple, Sony, Lenovo').pressSequentially('Apple', { delay: 90 });
  await page.getByPlaceholder('Ej. iPhone 13 128 GB').pressSequentially('iPhone 13 128 GB', { delay: 70 });
  await beat(page, 800); await tap(page, 'Continuar', 1000);   // estado (por defecto)
  await tap(page, 'Continuar', 800);
  await page.getByPlaceholder('15 dígitos').pressSequentially('356938035643809', { delay: 60 });
  await beat(page, 600); await tap(page, 'Continuar', 1000);   // IMEI
  for (const sw of await page.getByRole('switch').all()) await sw.click();   // revisión
  await beat(page, 800); await tap(page, 'Continuar', 1000);
  await page.getByPlaceholder('Batería al 89 %, incluye cargador…').pressSequentially('Batería al 91 %, incluye cargador original y funda.', { delay: 40 });
  await beat(page, 600); await tap(page, 'Continuar', 1000);
  await page.getByLabel('Precio en colones').pressSequentially('255000', { delay: 120 });
  await beat(page, 1000); await tap(page, 'Continuar', 1500);
  await shot(page, '01b-revisar'); await beat(page, 1500);
  await tap(page, 'Crear link de venta', 2500);
  await page.getByText('¡Tu link está listo!').waitFor();
  await shot(page, '01-link-creado'); await beat(page, 2500);

  // (2) Comprador abre /p/[slug] y paga
  await tap(page, 'Ver como comprador', 2500);
  await page.getByText('Pagar en custodia').first().waitFor();
  await shot(page, '02a-comprador-link'); await beat(page, 2500);
  await tap(page, /Pagar en custodia ₡/, 2000);
  await page.getByText('Ya pagué', { exact: true }).waitFor();
  await shot(page, '02b-sinpe'); await beat(page, 2500);
  await tap(page, 'Ya pagué', 2500);
  await page.getByText('¡Fondos en custodia!').waitFor();
  await page.getByText('Tu PIN de entrega').waitFor();
  await shot(page, '02c-pin-visible'); await beat(page, 4000);   // PIN visible UNA vez
  await tap(page, 'Listo, lo guardé', 2000);
  await shot(page, '02d-fondeado'); await beat(page, 2000);

  // (3) Vendedor marca "Enviado"
  await role(page, 'seller'); await page.goto(`${BASE}/pedidos?${badge.slice(1)}`);
  await tap(page, /iPhone 13/, 1800);
  await page.getByPlaceholder('Encuentro, envío, número de guía…').pressSequentially('Entrega en persona, Escazú', { delay: 60 });
  await beat(page, 800); await shot(page, '03a-marcar-enviado');
  await tap(page, 'Marcar como enviado', 2500);
  await page.getByText('Marcado como enviado').waitFor();
  await shot(page, '03-enviado'); await beat(page, 2000);

  // (4) Vendedor ingresa el PIN y cobra
  await page.goto(`${BASE}/pedidos?${badge.slice(1)}`);
  await tap(page, /iPhone 13/, 1800);
  await page.getByPlaceholder('••••••').pressSequentially(await page.evaluate(() => (window as any).__meteoritoDemo.DEMO_PIN), { delay: 220 });
  await beat(page, 1200); await shot(page, '04a-pin');
  await tap(page, 'Confirmar PIN y cobrar', 2500);
  await page.getByText(/¡Cobrado!/).waitFor();
  await shot(page, '04-cobrado'); await beat(page, 3000);

  // (5) Disputa abierta (segundo pedido ya enviado, el comprador reporta un problema)
  const slug2 = await page.evaluate(() => (window as any).__meteoritoDemo.seed('enviado'));
  await role(page, 'buyer'); await page.goto(`${BASE}/p/${slug2}?${badge.slice(1)}`);
  await page.getByText('Tengo un problema').first().waitFor();
  await beat(page, 2000); await shot(page, '05a-comprador-enviado');
  await tap(page, 'Tengo un problema', 1800);
  await tap(page, 'No llegó', 1200);
  await shot(page, '05b-motivo');
  await tap(page, 'Reportar problema', 2500);
  await page.getByText(/En disputa/).first().waitFor();
  await shot(page, '05-disputa'); await beat(page, 3500);

  await ctx.close(); await browser.close();
  console.log('Demo grabado: 5 pasos OK' + (VIDEO ? ` · video en ${VIDEO}` : '') + (SHOTS ? ` · capturas en ${SHOTS}` : ''));
})().catch((e) => { console.error(e); process.exit(1); });
