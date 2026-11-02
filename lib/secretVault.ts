// Bóveda de secretos del comprador en la web (llave de invitado, código de entrega, permisos de acceso).
// - Nada en texto plano en localStorage: cada valor va cifrado con AES-GCM en IndexedDB. La llave AES se crea con
//   extractable=false (WebCrypto): el navegador la guarda como CryptoKey y ningún script puede leer sus bytes.
// - Lecturas síncronas desde memoria (se llena al hidratar, una vez por carga); escrituras en memoria + IndexedDB.
// - Sin IndexedDB/WebCrypto (navegador raro, contexto inseguro): solo memoria + sessionStorage (dura lo que la pestaña).
// - Nativo (iOS): solo memoria, como antes (el flujo de invitado es de la web).
// Nunca lanza: un fallo de almacenamiento deja el valor en memoria.

const DB = 'meteorito-vault';
const STORE = 'kv';
const KEY_ID = '__aes';
const SESSION_PREFIX = 'meteorito:vault:';

type Backend = 'idb' | 'session' | 'memory';
const cache = new Map<string, string>();
const subs = new Set<() => void>();
let backend: Backend = 'memory';
let db: IDBDatabase | null = null;
let aes: CryptoKey | null = null;
let ready: Promise<void> | null = null;
let hydrated = false;
let version = 0;

// Web = hay window y document (en React Native no hay document; en el render estático de Node tampoco).
const isBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';
const notify = () => { version++; for (const f of [...subs]) { try { f(); } catch { /* */ } } };
const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const ss = (): Storage | null => { try { return window.sessionStorage; } catch { return null; } };

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('idb blocked'));
  });
}
const tx = (mode: IDBTransactionMode) => db!.transaction(STORE, mode).objectStore(STORE);

async function encrypt(v: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes!, new TextEncoder().encode(v));
  return { iv, ct };
}
async function decrypt(rec: any): Promise<string | null> {
  try {
    if (!rec || !rec.iv || !rec.ct) return null;
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, aes!, rec.ct));
  } catch { return null; }
}

async function hydrateIdb() {
  if (typeof indexedDB === 'undefined' || !globalThis.crypto?.subtle) throw new Error('sin idb/webcrypto');
  db = await openDb();
  let k = await req(tx('readonly').get(KEY_ID)) as CryptoKey | undefined;
  if (!k || typeof k !== 'object' || !('type' in k)) {
    k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await req(tx('readwrite').put(k, KEY_ID));
  }
  aes = k;
  const keys = (await req(tx('readonly').getAllKeys())).filter((x) => x !== KEY_ID).map(String);
  for (const name of keys) {
    const v = await decrypt(await req(tx('readonly').get(name)));
    if (v !== null && !cache.has(name)) cache.set(name, v);
  }
  backend = 'idb';
}
function hydrateSession() {
  const s = ss(); if (!s) return;
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i) ?? ''; if (!k.startsWith(SESSION_PREFIX)) continue;
    const name = k.slice(SESSION_PREFIX.length); const v = s.getItem(k);
    if (v !== null && !cache.has(name)) cache.set(name, v);
  }
  backend = 'session';
}

/** Carga la bóveda (una vez). Resuelve siempre. */
export function vaultReady(): Promise<void> {
  if (ready) return ready;
  if (!isBrowser()) { hydrated = true; return (ready = Promise.resolve()); }
  ready = (async () => {
    try { await hydrateIdb(); } catch { db = null; aes = null; hydrateSession(); }
    hydrated = true; notify();
  })();
  return ready;
}
export const vaultHydrated = () => hydrated;
export const vaultBackend = () => backend;
export const vaultVersion = () => version;
export function subscribeVault(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }

export function vaultGet(name: string): string | null { return cache.get(name) ?? null; }
export function vaultKeys(prefix = ''): string[] { return [...cache.keys()].filter((k) => k.startsWith(prefix)); }

/** Guarda en memoria y en el almacenamiento. Resuelve true si quedó persistido (IndexedDB o sessionStorage). */
export async function vaultSet(name: string, value: string): Promise<boolean> {
  cache.set(name, value); notify();
  await vaultReady();
  try {
    if (backend === 'idb' && db && aes) { await req(tx('readwrite').put(await encrypt(value), name)); return true; }
    if (backend === 'session') { ss()?.setItem(SESSION_PREFIX + name, value); return true; }
  } catch { /* queda en memoria */ }
  return false;
}
export async function vaultDelete(name: string): Promise<void> {
  cache.delete(name); notify();
  await vaultReady();
  try {
    if (backend === 'idb' && db) await req(tx('readwrite').delete(name));
    if (backend === 'session') ss()?.removeItem(SESSION_PREFIX + name);
  } catch { /* */ }
}
