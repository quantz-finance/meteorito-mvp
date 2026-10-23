// Post-export (vercel buildCommand). Nombres con hash de contenido, por eso se buscan en dist/.
// 1) Fuentes woff2 con <link rel=preload> (font-display: swap; se bajan en paralelo con el JS). Expo ya precarga
//    las de useFonts (Nunito); aquí se agrega la de iconos (se registra en código, Expo no la ve).
// 2) __common diferido: Metro junta ahí los módulos compartidos por los chunks async (SDK Cavos, noble, bignumber…).
//    Ninguna pantalla los usa al arrancar, así que se saca del HTML y se carga justo antes del primer chunk async
//    que los necesita (bienvenida y /p/ ya no bajan ni parsean el SDK de login).
// 3) Service worker con la lista de archivos estáticos (cache-first para /_expo y /assets, que son inmutables).
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
const dist = process.argv[2] ?? 'dist';
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(dist);
const url = (f) => '/' + relative(dist, f).split('\\').join('/');
const fail = (m) => { console.error('[postbuild]', m); process.exit(1); };

// 1) Fuentes
const fontRe = [/\/fonts\/nunito-400\.[0-9a-f]+\.woff2$/, /\/fonts\/nunito-900\.[0-9a-f]+\.woff2$/, /\/fonts\/nunito-700\.[0-9a-f]+\.woff2$/, /\/fonts\/ionicons-app\.[0-9a-f]+\.woff2$/];
const fonts = fontRe.map((re) => files.find((f) => re.test(f))).filter(Boolean).map(url);
if (fonts.length !== fontRe.length) fail('no encontré todas las fuentes woff2: ' + fonts.join(', '));
const fontTagsFor = (h) => fonts.filter((a) => !h.includes(a)).map((a) => `<link rel="preload" as="font" type="font/woff2" href="${a}" crossorigin>`).join('');

// 2) __common bajo demanda
const jsDir = join(dist, '_expo/static/js/web');
const js = readdirSync(jsDir).filter((f) => f.endsWith('.js'));
const commonFile = js.find((f) => f.startsWith('__common-'));
let deferTag = '';
if (commonFile) {
  const ids = (src) => new Set([...src.matchAll(/\},(\d+),(?:\[|\{)/g)].map((m) => +m[1]));
  const deps = (src) => { const out = new Set(); for (const m of src.matchAll(/\},\d+,(\[[\d,]*\]|\{[^{}]*?(?:"paths":\{[^}]*\})?\})\);/g)) {
    const v = JSON.parse(m[1]); for (const [k, x] of Object.entries(Array.isArray(v) ? Object.assign({}, v) : v)) if (k !== 'paths' && typeof x === 'number') out.add(x); } return out; };
  const common = ids(readFileSync(join(jsDir, commonFile), 'utf8'));
  const entrySrc = js.filter((f) => f.startsWith('entry-') || f.startsWith('__expo-metro-runtime-')).map((f) => readFileSync(join(jsDir, f), 'utf8')).join('\n');
  // Seguridad: si el bundle inicial requiere algo de __common, no se difiere (el HTML queda como lo dejó Expo).
  const eager = [...deps(entrySrc)].filter((d) => common.has(d) && !ids(entrySrc).has(d));
  const needs = js.filter((f) => !/^(entry|__common|__expo-metro-runtime)-/.test(f))
    .filter((f) => [...deps(readFileSync(join(jsDir, f), 'utf8'))].some((d) => common.has(d))).map((f) => `/_expo/static/js/web/${f}`);
  if (eager.length) console.warn(`[postbuild] __common NO diferido: el bundle inicial usa ${eager.length} módulos de ahí`);
  else {
    const commonUrl = `/_expo/static/js/web/${commonFile}`;
    // Envuelve el cargador async de Metro (globalThis.__loadBundleAsync, lo asigna expo al arrancar el entry).
    const loader = `(function(){var C=${JSON.stringify(commonUrl)},N=${JSON.stringify(needs)},p=null,o;function c(){return p||(p=new Promise(function(r,j){var s=document.createElement('script');s.src=C;s.async=true;s.onload=r;s.onerror=function(e){p=null;j(e)};document.head.appendChild(s)}))}Object.defineProperty(globalThis,'__loadBundleAsync',{configurable:true,get:function(){return o&&function(u){return N.indexOf(u)<0?o(u):c().then(function(){return o(u)})}},set:function(f){o=f}})})();`;
    deferTag = `<script>${loader}</script>`;
    console.log(`[postbuild] __common diferido; lo esperan ${needs.length} chunks async`);
  }
}

let n = 0;
for (const f of files.filter((f) => f.endsWith('.html'))) {
  let h = readFileSync(f, 'utf8');
  if (h.includes('data-postbuild')) continue;
  if (deferTag) {
    const re = new RegExp(`<script src="/_expo/static/js/web/${commonFile.replace(/[.]/g, '\\.')}"[^>]*></script>`);
    if (!re.test(h)) fail('no encontré el <script> de __common en ' + url(f));
    h = h.replace(re, '');
    h = h.replace('<script src="/_expo/static/js/web/__expo-metro-runtime-', deferTag + '<script src="/_expo/static/js/web/__expo-metro-runtime-');
  }
  h = h.replace('</head>', `${fontTagsFor(h)}<meta name="postbuild" data-postbuild="1"></head>`);
  // El registro del SW y las actualizaciones automáticas los hace la app (lib/updater.ts) al ver esta <meta>.
  writeFileSync(f, h); n++;
}

// 3) Service worker: precache del shell (JS inicial + imágenes del splash + fuentes) y cache-first de estáticos inmutables.
const swTpl = readFileSync(join(dist, 'sw.js'), 'utf8');
const pre = files.map(url).filter((u) => /^\/_expo\/static\/js\/web\/(entry|__expo-metro-runtime)-/.test(u) || /\/space\/(mascot|trail-f\d|nebula|stars-(far|near))\.[0-9a-f]+\.webp$/.test(u) || fonts.includes(u));
const version = createHash('sha1').update(pre.join()).digest('hex').slice(0, 10);
writeFileSync(join(dist, 'sw.js'), swTpl.replace('__SW_VERSION__', version).replace('[/*__PRECACHE__*/]', JSON.stringify(pre)));
console.log(`[postbuild] ${fonts.length} fuentes precargadas, ${pre.length} archivos en el precache del SW (v${version}) -> ${n} html`);
