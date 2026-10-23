// (37) Misma cuenta en N dispositivos (Cavos Stellar, DEK nativa: misma dirección en todos). Dispositivo 1 crea la cuenta,
// la activa y publica. Dispositivo 2 entra: NO firma ni llama a la API hasta confirmar con la passkey (toque del usuario);
// luego restaura, liga la sesión a la MISMA dirección y crea un link con prueba firmada que el servidor real acepta.
// Antes: la cuenta ya activa on-chain hacía saltar el chequeo del dispositivo y el create fallaba ("not an authorized signer").
import type { T } from './setup';
import { baseEnv } from './setup';
import { Keypair } from '@stellar/stellar-sdk';
import { DEVICE_NOT_AUTHORIZED, DEVICE_STEP, DEVICE_STEP_CANCELLED, DEVICE_STEP_HELP, ensureWalletReady, needsDeviceStep, restoreDevice, walletErrorNotice, __resetBindForTests } from '../../lib/wallet';
import { api as callApi, proof } from '../../lib/api';
// Igual que lib/orders.ts createOrder (que no carga en node por react-native).
const createOrder = async (a: MeteoritoAuth, o: any) => (await callApi<{ slug: string }>(a, '/api/orders/create', { ...o, proof: await proof(a, 'create', 'new') })).slug;
import type { MeteoritoAuth, WalletInfo } from '../../lib/types';

const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (iat: number) => `${b64({ alg: 'none' })}.${b64({ sub: 'multi-1', iat, exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;
const kp = Keypair.random(); // la llave que se deriva de la DEK: idéntica en todos los dispositivos ya restaurados
const ADDR = kp.publicKey();

function device(name: string, w: Partial<WalletInfo>, calls: string[], iat: number): MeteoritoAuth {
  return {
    configured: true, isAuthenticated: true, isLoading: false, email: 'multi@ci', address: ADDR, error: null,
    openLogin() {}, logout: async () => {}, getAuthToken: () => token(iat),
    signMessage: async (m: string) => {
      calls.push(`${name}:sign`);
      if (w.state === 'needs-approval') throw new Error('kit/stellar: this device is not an authorized signer of the wallet');
      return { publicKey: ADDR, signature: kp.sign(Buffer.from(m)).toString('base64') };
    },
    signXdr: async () => { calls.push(`${name}:signXdr`); return 'SIGNED'; },
    wallet: { state: 'ready', recoveryProtected: true, hasPasskey: true, approveDevice: async () => {}, enrollPasskey: async () => {}, ...w },
  };
}

export async function run(t: T) {
  baseEnv();
  const { requireAddressProof } = await import('../../api/_lib/auth');
  const realFetch = globalThis.fetch; const err = console.error; console.error = () => {};
  let funded = false; const api: string[] = []; const bound = new Map<string, string>(); const created: string[] = [];
  globalThis.fetch = (async (u: any, i: any) => {
    const url = String(u);
    if (!url.startsWith('/api')) { // Horizon: cuenta activa con trustline USDC solo después de que el dispositivo 1 la activa
      if (!funded) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ balances: [{ asset_type: 'native', balance: '1' }, { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', balance: '0' }] }) };
    }
    const b = JSON.parse(i?.body ?? '{}');
    api.push(url.replace('/api/', '') + (b.step ? ':' + b.step : ''));
    const ok = (body: any) => ({ ok: true, status: 200, json: async () => body });
    try {
      if (url.startsWith('/api/wallet/activate')) {
        if (b.step === 'nonce') return ok({ nonce: 'd'.repeat(48) });
        if (b.step === 'bind') { const prev = bound.get('multi-1'); if (!prev) bound.set('multi-1', b.proof.address); return ok({ bound: true, relinkRequired: !!prev && prev !== b.proof.address }); }
        if (b.step === 'prepare') { await requireAddressProof(b.proof, 'wallet', 'activate'); return ok({ ready: false, unsignedXdr: 'XDR' }); }
        if (b.step === 'submit') { funded = true; return ok({ ready: true }); }
      }
      if (url.startsWith('/api/orders/create')) {
        const seller = await requireAddressProof(b.proof, 'create', 'new'); // verificación real (ed25519 sobre la dirección)
        if (bound.get('multi-1') && bound.get('multi-1') !== seller) return { ok: false, status: 409, json: async () => ({ error: 'otra wallet', code: 'wallet_other_bound' }) };
        if (!funded) return { ok: false, status: 409, json: async () => ({ error: 'no activa', code: 'wallet_not_ready' }) };
        const slug = 'abc' + String(created.length + 1).padStart(3, '0'); created.push(slug); return ok({ slug });
      }
      return ok({});
    } catch (e: any) { return { ok: false, status: e?.status ?? 500, json: async () => ({ error: e?.message, code: e?.code }) }; }
  }) as any;
  const order = { title: 'Bicicleta de montaña', price_crc: 120000, photos: ['https://x/p.jpg'] };
  try {
    __resetBindForTests();
    // Dispositivo 1: crea la cuenta, activa y publica.
    const calls: string[] = [];
    const d1 = device('d1', { state: 'undeployed' }, calls, 1);
    const e1 = await ensureWalletReady(d1).then(() => null, (e) => e);
    const s1 = e1 ? null : await createOrder(d1, order).catch((e) => e);
    t.check('dispositivo 1: activa (prepare/submit) y crea su link', e1 === null && s1 === 'abc001' && funded && bound.get('multi-1') === ADDR, `${e1?.message} ${String(s1)} ${api}`);

    // Dispositivo 2: misma cuenta, la llave aún no está aquí. La cuenta YA está activa on-chain (regresión).
    api.length = 0; calls.length = 0;
    let latest: MeteoritoAuth | null = null; let approvals = 0;
    const d2 = device('d2', { state: 'needs-approval', hasPasskey: true, approveDevice: async () => { approvals++; latest = device('d2', { state: 'ready' }, calls, 2); } }, calls, 2);
    const fresh = (a: MeteoritoAuth) => latest ?? a;
    const e2 = await ensureWalletReady(d2).then(() => null, (e) => e);
    t.check('dispositivo 2 (cuenta ya activa): pide el paso passkey ANTES de firmar o llamar a la API', e2?.code === 'device_needs_passkey' && calls.length === 0 && api.length === 0, `${e2?.code} ${calls} ${api}`);
    const e2b = await createOrder(d2, order).then(() => null, (e) => e);
    t.check('dispositivo 2: create sin restaurar -> código device_needs_passkey (nunca "not an authorized signer")', e2b?.code === 'device_needs_passkey' && needsDeviceStep(e2b) && calls.length === 0, `${e2b?.code}`);
    t.check('aviso: paso guiado en tuteo, sin jerga técnica', walletErrorNotice(e2) === DEVICE_STEP && !/(podés|tenés|usá|entrá|wallet|billetera|\bllave\b|DEK|firm)/i.test(DEVICE_STEP + DEVICE_STEP_HELP) && /iCloud/.test(DEVICE_STEP_HELP));
    t.check('error crudo del kit también lleva al paso passkey', walletErrorNotice(new Error('kit/stellar: this device is not an authorized signer of the wallet')) === DEVICE_STEP);

    const r = await restoreDevice(d2, { fresh });
    t.check('dispositivo 2: restaura con UNA passkey y devuelve el auth fresco listo', approvals === 1 && r.wallet?.state === 'ready' && r.address === ADDR);
    const e3 = await ensureWalletReady(r).then(() => null, (e) => e);
    const s2 = await createOrder(r, order).catch((e) => e);
    t.check('dispositivo 2: sin reactivar (ya activa), liga la sesión a la MISMA dirección y crea el link', e3 === null && s2 === 'abc002' && !api.includes('wallet/activate:prepare') && api.includes('wallet/activate:bind') && bound.get('multi-1') === ADDR, `${e3?.message} ${String(s2?.message ?? s2)} ${api}`);

    // Dispositivo 3 (N): igual.
    latest = null; __resetBindForTests();
    const d3 = device('d3', { state: 'needs-approval', hasPasskey: false, approveDevice: async () => { latest = device('d3', { state: 'ready' }, calls, 3); } }, calls, 3);
    const r3 = await restoreDevice(d3, { fresh });
    t.check('dispositivo 3: también restaura (aunque el SDK no supiera aún si había passkey) y publica', (await createOrder(r3, order)) === 'abc003');

    // Passkey cancelada / cuenta sin passkey.
    const cancel = device('dx', { state: 'needs-approval', approveDevice: async () => { throw Object.assign(new Error('The operation either timed out or was not allowed'), { name: 'NotAllowedError' }); } }, calls, 4);
    const ec = await restoreDevice(cancel, { fresh: (a) => a }).then(() => null, (e) => e);
    t.check('passkey cancelada -> device_restore_cancelled + "inténtalo otra vez"', ec?.code === 'device_restore_cancelled' && walletErrorNotice(ec) === DEVICE_STEP_CANCELLED);
    const none = device('dy', { state: 'needs-approval', hasPasskey: false }, calls, 5);
    const en = await restoreDevice(none, { fresh: (a) => a, timeoutMs: 300 }).then(() => null, (e) => e);
    t.check('cuenta sin passkey de respaldo -> device_restore_no_backup -> salida "otro correo"', en?.code === 'device_restore_no_backup' && walletErrorNotice(en) === DEVICE_NOT_AUTHORIZED);
  } finally { globalThis.fetch = realFetch; console.error = err; }
}
