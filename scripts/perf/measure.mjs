// Medición de carga en frío: móvil, 4G simulado (CDP), CPU x4. Uso: node scripts/perf/measure.mjs <url> [runs=3]
import { chromium, devices } from 'playwright';
const url = process.argv[2] ?? 'https://pago.meteorito.app/';
const runs = Number(process.argv[3] ?? 3);
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const results = [];
for (let i = 0; i < runs; i++) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 5'] });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  let reqs = 0, jsBytes = 0, total = 0;
  cdp.on('Network.loadingFinished', (e) => { total += e.encodedDataLength; });
  cdp.on('Network.responseReceived', (e) => { reqs++; });
  await page.addInitScript(() => {
    window.__m = { lcp: 0 };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__m.fcp = e.startTime; }).observe({ type: 'paint', buffered: true });
    window.__m.longTasks = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.longTasks += Math.max(0, e.duration - 50); }).observe({ type: 'longtask', buffered: true });
  });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  // "interactivo": hay al menos un botón/texto visible de la app (no solo splash)
  await page.waitForFunction(() => document.querySelectorAll('[role=button],button,[data-testid],input').length > 0 || document.body.innerText.trim().length > 20, null, { timeout: 60000 }).catch(() => {});
  const tInteractive = Date.now() - t0;
  await page.waitForTimeout(2500);
  const m = await page.evaluate(() => {
    const res = performance.getEntriesByType('resource');
    const js = res.filter((r) => /\.js(\?|$)/.test(r.name));
    return { ...window.__m, nav: performance.getEntriesByType('navigation')[0].toJSON(), jsKB: js.reduce((s, r) => s + (r.encodedBodySize || 0), 0) / 1024, jsRawKB: js.reduce((s, r) => s + (r.decodedBodySize || 0), 0) / 1024, jsCount: js.length, reqs: res.length + 1, fontKB: res.filter((r) => /font|\.ttf|\.woff/.test(r.name)).reduce((s, r) => s + (r.encodedBodySize || 0), 0) / 1024, imgKB: res.filter((r) => /\.(png|jpg|jpeg|webp|svg|gif)/.test(r.name)).reduce((s, r) => s + (r.encodedBodySize || 0), 0) / 1024 };
  });
  results.push({ lcp: m.lcp, fcp: m.fcp ?? 0, interactive: tInteractive, load: m.nav.loadEventEnd, dcl: m.nav.domContentLoadedEventEnd, tbt: m.longTasks, jsKB: m.jsKB, jsRawKB: m.jsRawKB, jsCount: m.jsCount, reqs: m.reqs, totalKB: total / 1024, fontKB: m.fontKB, imgKB: m.imgKB });
  await browser.close();
}
const keys = Object.keys(results[0]);
const out = Object.fromEntries(keys.map((k) => [k, Math.round(med(results.map((r) => r[k])))]));
console.log(JSON.stringify({ url, runs, medians: out }, null, 1));
