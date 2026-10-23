// Genera public/splash/startup-<w>x<h>.png (apple-touch-startup-image de la PWA en iOS) a partir del splash real
// del HTML exportado, sin el JS de la app. Uso: node scripts/perf/serve.mjs dist 8099 & node scripts/build/startup-images.mjs 8099
// (luego: python3 -c PIL quantize, ver abajo). Las medidas deben coincidir con STARTUP en app/+html.tsx.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const port = process.argv[2] ?? '8099';
const SIZES = [[750, 1334, 2], [1125, 2436, 3], [1170, 2532, 3], [1179, 2556, 3], [1284, 2778, 3], [1290, 2796, 3], [828, 1792, 2]];
mkdirSync('public/splash', { recursive: true });
const b = await chromium.launch();
for (const [w, h, r] of SIZES) {
  const ctx = await b.newContext({ viewport: { width: w / r, height: h / r }, deviceScaleFactor: r, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await p.route(/\.js$/, (x) => x.abort());
  await p.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `public/splash/startup-${w}x${h}.png` });
  await ctx.close();
}
await b.close();
console.log('ok', SIZES.length);
