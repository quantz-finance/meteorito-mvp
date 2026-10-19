// Post-export: precarga las imágenes que el navegador marca como LCP (mascota + llama).
// Sin esto, su descarga empieza recién cuando el bundle JS terminó (~4.7 s en 4G lenta); con preload
// se bajan en paralelo con el JS. Los nombres llevan hash de contenido, por eso se buscan en dist/.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
const dist = process.argv[2] ?? 'dist';
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(dist);
const want = [/\/space\/mascot\.[0-9a-f]+\.webp$/, /\/space\/trail-f1\.[0-9a-f]+\.png$/];
const assets = want.map((re) => files.find((f) => re.test(f))).filter(Boolean).map((f) => '/' + relative(dist, f).split('\\').join('/'));
if (assets.length !== want.length) { console.error('[preload] no encontré todas las imágenes LCP:', assets); process.exit(1); }
const tags = assets.map((a) => `<link rel="preload" as="image" href="${a}" fetchpriority="high">`).join('');
let n = 0;
for (const f of files.filter((f) => f.endsWith('.html'))) {
  const h = readFileSync(f, 'utf8');
  if (h.includes('rel="preload" as="image"')) continue;
  writeFileSync(f, h.replace('</head>', tags + '</head>')); n++;
}
console.log(`[preload] ${assets.join(', ')} -> ${n} html`);
