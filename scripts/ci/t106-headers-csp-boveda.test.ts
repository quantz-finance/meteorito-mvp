// (106) Encabezados de seguridad + CSP en vercel.json y secretos del comprador fuera de localStorage.
//  - vercel.json: HSTS, nosniff, Referrer-Policy, Permissions-Policy (cámara solo propia), X-Frame-Options DENY y una CSP
//    sin 'unsafe-inline'/'unsafe-eval' en script-src, con frame-ancestors 'none' y los orígenes reales de la app.
//  - Cada <script> inline del build (dist/, tras preload.mjs en una copia) está permitido por su hash.
//  - lib/guest.ts: la llave de invitado, el PIN y los permisos ya no se escriben en localStorage; migración que no
//    borra nada si la bóveda no persiste (sin IndexedDB: nadie pierde el acceso).
import type { T } from './setup';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
// @ts-ignore módulo .mjs sin tipos
import { cspPolicies, cspScriptHashes, inlineScriptHashes, securityHeaders } from '../build/csp.mjs';

const root = new URL('../../', import.meta.url).pathname;
const read = (f: string) => readFileSync(join(root, f), 'utf8');

export async function run(t: T) {
  const v = JSON.parse(read('vercel.json'));
  const h = securityHeaders(v) as Record<string, string>;
  t.check('HSTS 2 años con subdominios', /max-age=63072000/.test(h['Strict-Transport-Security'] ?? '') && /includeSubDomains/.test(h['Strict-Transport-Security'] ?? ''));
  t.check('nosniff', h['X-Content-Type-Options'] === 'nosniff');
  t.check('Referrer-Policy strict-origin-when-cross-origin', h['Referrer-Policy'] === 'strict-origin-when-cross-origin');
  const pp = h['Permissions-Policy'] ?? '';
  t.check('Permissions-Policy: cámara solo propia; micrófono, ubicación y pago apagados', /camera=\(self\)/.test(pp) && /microphone=\(\)/.test(pp) && /geolocation=\(\)/.test(pp) && /payment=\(\)/.test(pp));
  t.check('X-Frame-Options DENY', h['X-Frame-Options'] === 'DENY');
  const pols = cspPolicies(v) as { key: string; value: string }[];
  const csp = pols.find((p) => p.key === 'Content-Security-Policy')?.value ?? '';
  t.check('CSP aplicada (no solo report-only)', !!csp, pols.map((p) => p.key).join(','));
  const dir = (n: string) => (csp.split(';').map((s) => s.trim()).find((s) => s.startsWith(n + ' ')) ?? '');
  t.check("script-src sin 'unsafe-inline' ni 'unsafe-eval'", !!dir('script-src') && !/'unsafe-(inline|eval)'/.test(dir('script-src')), dir('script-src'));
  t.check("frame-ancestors 'none', object-src 'none', base-uri 'self'", dir('frame-ancestors') === "frame-ancestors 'none'" && dir('object-src') === "object-src 'none'" && dir('base-uri') === "base-uri 'self'");
  const conn = dir('connect-src');
  t.check('connect-src: Supabase, Cavos, PostHog y Horizon/RPC testnet', ['https://ejvsvvqqcetgwxrenmdy.supabase.co', 'wss://ejvsvvqqcetgwxrenmdy.supabase.co', 'https://nqukipgxnnsmqtcivpzr.supabase.co', 'wss://nqukipgxnnsmqtcivpzr.supabase.co', 'https://*.cavos.xyz', 'https://us.i.posthog.com', 'https://horizon-testnet.stellar.org', 'https://soroban-testnet.stellar.org'].every((o) => conn.includes(o)), conn);
  t.check('frame-src: login de Cavos (vault)', dir('frame-src').includes('https://*.cavos.xyz'));
  t.check('servidores locales (demo y e2e) aplican los mismos encabezados', /securityHeaders/.test(read('scripts/demo/serve.mjs')) && /securityHeaders/.test(read('scripts/e2e/mock-server.mjs')));
  t.check('el build falla si un script inline no está en la CSP', /inlineScriptHashes/.test(read('scripts/build/preload.mjs')) && /fail\('script inline sin hash/.test(read('scripts/build/preload.mjs')));

  // Hashes de los scripts inline del build real (CI corre `expo export` antes de los tests).
  const allowed = cspScriptHashes(v) as Set<string>;
  if (existsSync(join(root, 'dist/index.html'))) {
    const tmp = mkdtempSync(join(tmpdir(), 'csp-'));
    try {
      cpSync(join(root, 'dist'), tmp, { recursive: true });
      const r = spawnSync('node', [join(root, 'scripts/build/preload.mjs'), tmp], { encoding: 'utf8' });
      t.check('preload.mjs sobre el build: pasa la verificación de CSP', r.status === 0, (r.stderr || r.stdout).slice(-300));
      const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
      const html = walk(tmp).filter((f) => f.endsWith('.html'));
      const miss = html.flatMap((f) => [...inlineScriptHashes(readFileSync(f, 'utf8'))].filter((x: string) => !allowed.has(x)).map((x) => `${f.slice(tmp.length)} ${x}`));
      t.check(`todos los scripts inline de ${html.length} páginas tienen hash en la CSP`, html.length > 5 && miss.length === 0, miss.slice(0, 3).join(' | '));
      t.check('el cargador de __common es constante (nombres en un bloque JSON)', html.some((f) => readFileSync(f, 'utf8').includes('id="mt-chunks"')));
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  } else t.check('(sin dist/: se omite la verificación del build)', true);

  // Bóveda del comprador
  const g = read('lib/guest.ts');
  t.check('lib/guest.ts no escribe la llave, el PIN ni permisos en localStorage', !/localStorage\.setItem\((KEY|PIN|GRANT|LEGACY_KEY|LEGACY_PIN|LEGACY_GRANT)/.test(g) && !/setItem\((LEGACY_KEY|LEGACY_PIN_PREFIX|LEGACY_GRANT_PREFIX|V_)/.test(g));
  const sv = read('lib/secretVault.ts');
  t.check('bóveda: AES-GCM con llave no extraíble en IndexedDB', /generateKey\(\{ name: 'AES-GCM', length: 256 \}, false,/.test(sv) && /indexedDB\.open/.test(sv));
  const { migrateLegacy, loadPin, hasGuestKey, guestKey } = await import('../../lib/guest');
  const m = new Map<string, string>([['meteorito:guest:v1', 'a'.repeat(64)], ['meteorito:guest:pin:abc123', '135790'], ['otra', 'x']]);
  const fake: any = { get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, x: string) => { m.set(k, x); }, removeItem: (k: string) => { m.delete(k); } };
  const moved = await migrateLegacy(fake);
  t.check('sin IndexedDB (memoria): la migración no borra nada de localStorage', moved === 0 && m.get('meteorito:guest:v1') === 'a'.repeat(64) && m.get('meteorito:guest:pin:abc123') === '135790');
  t.check('...pero el PIN migrado se lee de la bóveda en memoria', loadPin('abc123') === '135790');
  t.check('llave: la de la bóveda (o la heredada), nunca se pierde', hasGuestKey() && /^[a-f0-9]{64}$/.test(await guestKey()));
  const pb = read('components/PayBox.tsx'); const pg = read('app/p/[slug].tsx');
  t.check('pago y seguimiento re-renderizan al cargar la bóveda', /useGuestVault\(\)/.test(pb) && /useGuestVault\(\)/.test(pg));
}
