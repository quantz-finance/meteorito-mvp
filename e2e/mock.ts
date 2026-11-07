// Helpers del backend simulado (scripts/e2e/mock-server.mjs).
import { expect, type APIRequestContext, type Page, type BrowserContext } from '@playwright/test';
export const MOCK = `http://localhost:${process.env.E2E_MOCK_PORT ?? 8084}`; // mismo puerto que playwright.config.ts
export const MOCK_PIN = '135790';
export async function reset(request: APIRequestContext, orders: any[], card = false, cardMode: 'inapp' | 'widget' = 'inapp', contacts = false) { await request.post(`${MOCK}/__mock/reset`, { data: { orders, card, cardMode, contacts } }); }
/** Link de acceso como el que llega por correo (api/_lib/buyerContact.ts accessLinkFor). */
export async function accessToken(request: APIRequestContext, slug: string): Promise<string> { return (await (await request.post(`${MOCK}/__mock/access`, { data: { slug } })).json()).token; }
export async function state(request: APIRequestContext): Promise<any> { return (await request.get(`${MOCK}/__mock/state`)).json(); }
export async function patch(request: APIRequestContext, slug: string, set: any) { await request.post(`${MOCK}/__mock/patch`, { data: { slug, set } }); }
export async function failNext(request: APIRequestContext, f: { path: string; step?: string; times?: number; status?: number; error?: string; code?: string; delayMs?: number }) {
  await request.post(`${MOCK}/__mock/fail`, { data: { times: 1, ...f } });
}
export const calls = async (request: APIRequestContext, path: string, step?: string) =>
  ((await state(request)).calls as any[]).filter((c) => c.path === path && (step == null || c.step === step));
export async function waitApp(page: Page) { await expect(page.locator('#root')).not.toBeEmpty(); }

/** Lee la bóveda cifrada del comprador (lib/secretVault.ts) desde la página: IndexedDB + la CryptoKey no extraíble.
 *  Solo para tests; devuelve { nombre: valor }. */
export async function readVault(page: Page): Promise<Record<string, string>> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('meteorito-vault', 1); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const get = (k: IDBValidKey) => new Promise<any>((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const keys: IDBValidKey[] = await new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').getAllKeys(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    let aes = await get('__aes'); const out: Record<string, string> = {};
    if (!aes) { const raw = await get('__aes_raw'); if (raw) aes = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']); }
    for (const k of keys) { if (k === '__aes' || k === '__aes_raw') continue; const rec = await get(k); try { out[String(k)] = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, aes, rec.ct)); } catch { out[String(k)] = '<no descifra>'; } }
    db.close(); return out;
  });
}
/** Claves de localStorage con secretos del comprador en texto plano (deberían ser 0 tras migrar). */
export const plainGuestSecrets = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter((k) => /^meteorito:guest:(v1|pin:|access:)/.test(k)));

/** Proveedor externo simulado, Gate real: cada contexto representa una cuenta distinta. */
export async function mockBuyer(context: BrowserContext) {
  await context.addInitScript(() => {
    if (!localStorage.getItem('cavos:e2e:session')) localStorage.setItem('cavos:e2e:session', crypto.randomUUID());
  });
  await context.route('https://horizon-testnet.stellar.org/accounts/**', async (route) => {
    await route.fulfill({ json: { balances: [{ asset_type: 'native', balance: '10' },
      { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', balance: '10' }] } });
  });
}
