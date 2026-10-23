// Compila api/ como CommonJS (como Vercel) y carga cada función con require(esm) DESHABILITADO.
// Evita que vuelva el crash ERR_REQUIRE_ESM (jose 6 / uint8array-extras). Uso: npm run check:cjs
import { execSync, spawnSync } from 'node:child_process';
import { readdirSync, rmSync, statSync, symlinkSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const out = join(root, '.ci-cjs');
rmSync(out, { recursive: true, force: true });
try { execSync(`npx tsc -p ${join(root, 'scripts/ci/tsconfig.cjs.json')}`, { cwd: root, stdio: 'pipe' }); }
catch (e) { if (!existsSync(join(out, 'api'))) { console.error(String(e.stdout ?? e)); process.exit(1); } }
if (!existsSync(join(out, 'node_modules'))) symlinkSync(join(root, 'node_modules'), join(out, 'node_modules'), 'dir');

// import() de un archivo relativo: Vercel no lo empaqueta y en runtime falla con ERR_MODULE_NOT_FOUND (bug de "comprar
// sin cuenta": /api/escrow/pay -> 500 "Cannot find module api/_lib/push"). Solo se permiten import() de paquetes.
import { readFileSync } from 'node:fs';
const relDyn = [];
const scan = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) scan(p); else if (/\.ts$/.test(f)) { const src = readFileSync(p, 'utf8'); for (const m of src.matchAll(/(?<!\/\/.*)\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) relDyn.push(`${p.slice(root.length + 1)}: import('${m[1]}')`); } } };
scan(join(root, 'api'));
if (relDyn.length) { console.log('FAIL  import() relativo en api/ (Vercel no lo empaqueta):\n' + relDyn.join('\n')); process.exit(1); }

const entries = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== '_lib') walk(p); } else if (f.endsWith('.js')) entries.push(p); } };
walk(join(out, 'api'));
let failed = 0;
for (const f of entries.sort()) {
  const r = spawnSync(process.execPath, ['--no-experimental-require-module', '-e',
    `const m=require(${JSON.stringify(f)}); if (typeof m.default !== 'function') { console.error('sin default export'); process.exit(2) }`], { cwd: out, encoding: 'utf8' });
  const rel = f.slice(out.length + 1);
  if (r.status === 0) console.log(`OK    ${rel}`);
  else { failed++; console.log(`FAIL  ${rel}\n${(r.stderr || '').split('\n').filter((l) => /Error|ERR_/.test(l)).slice(0, 3).join('\n')}`); }
}
rmSync(out, { recursive: true, force: true });
console.log(failed ? `\n${failed} funciones no cargan sin require(esm)` : `\n${entries.length} funciones cargan como CJS sin require(esm)`);
process.exit(failed ? 1 : 0);
