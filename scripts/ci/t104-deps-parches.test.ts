// (104) Parches de vulnerabilidades high en dependencias de producción (npm audit --omit=dev). Sin red: lee package-lock.json.
//  - axios >= 1.20 (vía @stellar/stellar-sdk 15.1 y @cavos/kit), follow-redirects >= 1.16.2 (vía axios),
//    node-forge >= 1.4.2 (vía @expo/cli), toml >= 5.0.1 (vía stellar-sdk 15.1, solo stellartoml): con `overrides`.
//  - @stellar/stellar-sdk se queda en 15.1.x A PROPÓSITO: 16.x y 17.x publican un build CJS que hace require() de paquetes
//    solo-ESM (uint8array-extras, @noble/*), y el runtime Node de Vercel (/opt/rust/nodejs.js) no soporta require(esm):
//    con 17.4.0 el preview respondió 500 FUNCTION_INVOCATION_FAILED con ERR_REQUIRE_ESM en /api/health (nov 2026).
//    check:cjs (require(esm) deshabilitado) es la guardia de esto. Para subir: empaquetar el API o esperar soporte en Vercel.
import type { T } from './setup';
import { readFileSync } from 'node:fs';

const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const cmp = (a: string, b: string) => { const x = a.split(/[.-]/).map(Number), y = b.split(/[.-]/).map(Number); for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0); return 0; };
const versions = (name: string) => Object.entries<any>(lock.packages ?? {}).filter(([k]) => k === `node_modules/${name}` || k.endsWith(`/node_modules/${name}`)).map(([k, v]) => `${k}@${v.version}`);

export async function run(t: T) {
  for (const [name, min] of [['axios', '1.20.0'], ['follow-redirects', '1.16.2'], ['node-forge', '1.4.2'], ['toml', '5.0.1']] as const) {
    const vs = versions(name);
    const bad = vs.filter((v) => cmp(v.split('@').pop()!, min) < 0);
    t.check(`${name} >= ${min} en todo el árbol (${vs.length} copias)`, bad.length === 0, bad.join(', '));
    t.check(`${name}: override en package.json`, typeof pkg.overrides?.[name] === 'string');
  }
  t.check('@stellar/stellar-sdk directo sigue en 15.x (16/17 rompen el runtime CJS de Vercel)', /^15\./.test(lock.packages['node_modules/@stellar/stellar-sdk']?.version ?? ''), lock.packages['node_modules/@stellar/stellar-sdk']?.version);
}
