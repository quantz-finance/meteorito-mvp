// Genera una llave maestra de PII (32 bytes CSPRNG) y, solo con --apply, la carga en Vercel como Sensitive.
//
// NO EJECUTAR --apply CONTRA VERCEL HASTA QUE ROLANDO LO AUTORICE.
// Por defecto es dry-run: no genera llave, no llama a la API, no escribe disco, no imprime material.
// Cada corrida genera una llave NUEVA. No acepta material por argumentos.
// Production y Preview tienen bases distintas: cada target recibe su propia llave. Nunca copies una en el otro.
// --apply escribe primero una copia 0600 en /home/box/secrets (para Rolando, fuera de línea) y después carga
// PII_ENC_KEYS y luego PII_ENC_ACTIVE_KID. No imprime la llave. Después hay que redesplegar.
//
//   npx tsx scripts/ops/pii-enc-keys.ts
//   npx tsx scripts/ops/pii-enc-keys.ts --self-test
//   npx tsx scripts/ops/pii-enc-keys.ts --apply --target production
//   npx tsx scripts/ops/pii-enc-keys.ts --apply --target preview
//
// --apply lee VERCEL_TOKEN y VERCEL_PROJECT_ID (VERCEL_ORG_ID si el proyecto es de un team). No los imprime.
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const NAMES = ['PII_ENC_KEYS', 'PII_ENC_ACTIVE_KID'] as const;
type Target = 'production' | 'preview';
export const BACKUP_DIR = '/home/box/secrets';

export interface KeyBackup { dir: string; name: string; body: string; mode: number }
export interface KeysIo {
  log: (line: string) => void;
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  writeBackup?: (file: KeyBackup) => void;
}

/** Copia offline. mode 0600, sin reescribir un archivo que ya existe. No registra el contenido. */
export function writeKeyBackup(file: KeyBackup): void {
  if (file.mode !== 0o600) throw new Error('mode');
  if (!/^pii-(production|preview)-k[0-9a-f]+\.txt$/.test(file.name)) throw new Error('name');
  mkdirSync(file.dir, { recursive: true, mode: 0o700 });
  try { chmodSync(file.dir, 0o700); } catch { /* el directorio puede ser de otro dueño; el archivo igual sale 0600 */ }
  const dest = path.join(file.dir, file.name);
  writeFileSync(dest, file.body, { mode: 0o600, flag: 'wx' });
  chmodSync(dest, 0o600);
}

export function redact(line: string, secrets: readonly string[]): string {
  let out = line;
  for (const s of secrets) if (s.length >= 16) out = out.split(s).join('[redacted]');
  return out;
}

function logger(io: KeysIo, secrets: string[]): (line: string) => void {
  return (line) => io.log(redact(line, secrets));
}

function looksLikeKeyMaterial(argv: string[]): boolean {
  return argv.some((a) => !a.startsWith('--') && /^[A-Za-z0-9+/=_-]{40,}$/.test(a));
}

export function parseKeysArgs(argv: string[]): { apply: boolean; selfTest: boolean; target: Target | null; bad: string | null } {
  let apply = false; let selfTest = false; let target: Target | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (a === '--self-test') selfTest = true;
    else if (a === '--dry-run') apply = false;
    else if (a === '--target') {
      const v = argv[++i];
      if (v !== 'production' && v !== 'preview') return { apply, selfTest, target: null, bad: 'target debe ser production o preview' };
      target = v;
    } else return { apply, selfTest, target, bad: 'argumento no reconocido' };
  }
  return { apply, selfTest, target, bad: null };
}

function projectUrl(projectId: string, teamId: string | undefined, suffix: string): string {
  const u = new URL(`https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}${suffix}`);
  if (teamId) u.searchParams.set('teamId', teamId);
  u.searchParams.set('decrypt', 'false');
  return u.toString();
}

async function listNames(io: KeysIo, token: string, projectId: string, teamId: string | undefined, target: Target, log: (s: string) => void): Promise<Set<string> | null> {
  let res: Response;
  try {
    res = await io.fetch(projectUrl(projectId, teamId, '/env'), { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    log('vercel list env -> red');
    return null;
  }
  if (!res.ok) {
    await res.arrayBuffer().catch(() => undefined);
    log(`vercel list env -> HTTP ${res.status}`);
    return null;
  }
  const data = await res.json().catch(() => null) as { envs?: { key?: string; target?: string[] }[] } | null;
  const names = new Set<string>();
  for (const e of data?.envs ?? []) {
    if (typeof e.key === 'string' && (e.target ?? []).includes(target)) names.add(e.key);
  }
  return names;
}

async function putSensitive(io: KeysIo, token: string, projectId: string, teamId: string | undefined, target: Target, name: string, value: string, log: (s: string) => void): Promise<boolean> {
  let body: string;
  try { body = JSON.stringify({ key: name, value, type: 'sensitive', target: [target] }); }
  catch { log(`vercel put ${name} -> no se armó la petición`); return false; }
  try {
    const res = await io.fetch(projectUrl(projectId, teamId, '/env'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body,
    });
    await res.arrayBuffer().catch(() => undefined);
    if (!res.ok) { log(`vercel put ${name} -> HTTP ${res.status}`); return false; }
    return true;
  } catch {
    log(`vercel put ${name} -> red`);
    return false;
  } finally {
    body = '';
  }
}

export async function runKeys(argv: string[], io: KeysIo): Promise<number> {
  const secrets: string[] = [];
  const token = io.env.VERCEL_TOKEN ?? '';
  if (token.length >= 16) secrets.push(token);
  const log = logger(io, secrets);
  if (looksLikeKeyMaterial(argv)) {
    log('no se acepta material de llave por argumentos');
    return 1;
  }
  const args = parseKeysArgs(argv);
  if (args.bad) { log(args.bad); return 1; }
  if (args.selfTest) {
    const key = randomBytes(32);
    const kid = 'k' + randomBytes(4).toString('hex');
    const value = `${kid}:${key.toString('base64')}`;
    secrets.push(value, key.toString('base64'));
    const ok = key.length === 32 && value.startsWith(`${kid}:`) && Buffer.from(value.slice(kid.length + 1), 'base64').length === 32;
    key.fill(0);
    log(ok ? `self-test ok bytes=32 kid=${kid}` : 'self-test fail');
    return ok ? 0 : 1;
  }
  if (!args.apply) {
    log('dry-run: no se generó ninguna llave, no se escribió respaldo y no se llamó a Vercel.');
    log('Production y Preview llevan llaves distintas. Cada corrida genera una llave nueva.');
    log('Con --apply el respaldo queda en /home/box/secrets modo 0600. Pásaselo a Rolando y bórralo después.');
    log('Después de cargar las variables hay que redesplegar para que las funciones las tomen.');
    log('NO ejecutar --apply contra Vercel hasta que Rolando lo autorice.');
    log('Para cargar: npx tsx scripts/ops/pii-enc-keys.ts --apply --target production|preview');
    return 0;
  }
  if (!args.target) { log('falta --target production|preview'); return 1; }
  const projectId = io.env.VERCEL_PROJECT_ID ?? '';
  const teamId = io.env.VERCEL_ORG_ID || undefined;
  if (!token || !projectId) { log('faltan VERCEL_TOKEN o VERCEL_PROJECT_ID'); return 1; }
  const names = await listNames(io, token, projectId, teamId, args.target, log);
  if (!names) return 1;
  for (const name of NAMES) {
    if (names.has(name)) { log(`${name} ya existe en ${args.target}; no se reemplaza`); return 1; }
  }
  const key = randomBytes(32);
  const kid = 'k' + randomBytes(4).toString('hex');
  const b64 = key.toString('base64');
  const value = `${kid}:${b64}`;
  secrets.push(value, b64);
  const backup: KeyBackup = {
    dir: BACKUP_DIR,
    name: `pii-${args.target}-${kid}.txt`,
    mode: 0o600,
    body: `PII_ENC_ACTIVE_KID=${kid}\nPII_ENC_KEYS=${value}\n`,
  };
  try { (io.writeBackup ?? writeKeyBackup)(backup); }
  catch { log('no se pudo escribir el respaldo; no se cargó nada'); key.fill(0); return 1; }
  log(`respaldo escrito en ${backup.dir}/${backup.name} modo=0600 (el valor no se muestra). Pásaselo a Rolando y bórralo después.`);
  const keysOk = await putSensitive(io, token, projectId, teamId, args.target, 'PII_ENC_KEYS', value, log);
  const kidOk = keysOk && await putSensitive(io, token, projectId, teamId, args.target, 'PII_ENC_ACTIVE_KID', kid, log);
  key.fill(0);
  if (!kidOk) { log('la carga no terminó; el respaldo sigue en disco. No generes otra llave hasta revisarlo con Rolando.'); return 1; }
  log(`listo target=${args.target} kid=${kid} (el valor no se muestra). Redespliega para que las funciones tomen las variables.`);
  return 0;
}

function invokedDirectly(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return import.meta.url === pathToFileURL(path.resolve(argv1)).href;
}

if (invokedDirectly()) {
  runKeys(process.argv.slice(2), { log: (l) => console.log(l), fetch: globalThis.fetch, env: process.env })
    .then((code) => process.exit(code));
}
