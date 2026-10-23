// (34) Vendedor nuevo (correo nuevo, dispositivo nuevo) activa su cuenta sin fallas; cuenta cargando no falla con error
// genérico; correo con wallet huérfana (sin llave aquí ni passkey) -> aviso simple en tuteo + salida "otro correo". Sin red.
import type { T } from './setup';
import { DEVICE_NOT_AUTHORIZED, DEVICE_STEP, ensureWalletReady, isOrphanWallet, walletErrorNotice, WALLET_LOADING, __resetBindForTests } from '../../lib/wallet';
import type { MeteoritoAuth, WalletInfo } from '../../lib/types';

const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64({ alg: 'none' })}.${b64({ sub: 'nuevo-1', exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;
const mk = (w: Partial<WalletInfo>, calls: string[]): MeteoritoAuth => ({
  configured: true, isAuthenticated: true, isLoading: false, email: 'nuevo@ci', address: 'G' + 'A'.repeat(55), error: null,
  openLogin() {}, logout: async () => { calls.push('logout'); }, getAuthToken: () => TOKEN,
  signMessage: async () => { calls.push('signMessage'); return { publicKey: 'G' + 'A'.repeat(55), signature: 'c2ln' }; },
  signXdr: async (x: string) => { calls.push('signXdr:' + x); return 'SIGNED'; },
  wallet: { state: 'undeployed', recoveryProtected: true, hasPasskey: true, approveDevice: async () => { calls.push('approve'); }, enrollPasskey: async () => {}, ...w },
});

export async function run(t: T) {
  const realFetch = globalThis.fetch; const err = console.error; console.error = () => {};
  const steps: string[] = [];
  globalThis.fetch = (async (u: any, i: any) => {
    const url = String(u);
    if (!url.startsWith('/api')) return { ok: false, status: 404, json: async () => ({}) }; // Horizon: cuenta nueva (404)
    const b = JSON.parse(i?.body ?? '{}'); steps.push(b.step);
    const body = b.step === 'nonce' ? { nonce: 'd'.repeat(48) } : b.step === 'bind' ? { bound: true } : b.step === 'prepare' ? { ready: false, unsignedXdr: 'XDR1' } : b.step === 'submit' ? { ready: true } : {};
    return { ok: true, status: 200, json: async () => body };
  }) as any;
  try {
    __resetBindForTests();
    let calls: string[] = [];
    const e = await ensureWalletReady(mk({ state: 'undeployed' }, calls)).then(() => null, (x) => x);
    t.check('vendedor nuevo (wallet sin desplegar, cuenta 404): activa -> prepare, firma, submit', e === null && steps.includes('prepare') && steps.includes('submit') && calls.includes('signXdr:XDR1'), `${e?.message} ${steps} ${calls}`);
    steps.length = 0; calls = []; __resetBindForTests();
    const e2 = await ensureWalletReady(mk({ state: 'ready' }, calls)).then(() => null, (x) => x);
    t.check('vendedor nuevo con wallet lista en el dispositivo: activa igual', e2 === null && steps.includes('submit'), `${e2?.message} ${steps}`);
    steps.length = 0; calls = [];
    const e3 = await ensureWalletReady(mk({ state: 'loading' }, calls)).then(() => null, (x) => x);
    t.check('cuenta cargando -> código wallet_loading, sin API ni firmas', e3?.code === 'wallet_loading' && steps.length === 0 && calls.length === 0, `${e3?.code}`);
    t.check('cuenta cargando -> mensaje claro (no "No pudimos activar")', walletErrorNotice(e3) === WALLET_LOADING);
    calls = [];
    const orphan = mk({ state: 'needs-approval', hasPasskey: false, recoveryProtected: false }, calls);
    t.check('isOrphanWallet: needs-approval sin passkey', isOrphanWallet(orphan) && !isOrphanWallet(mk({ state: 'needs-approval', hasPasskey: true }, [])) && !isOrphanWallet(mk({ state: 'ready' }, [])));
    const e4 = await ensureWalletReady(orphan).then(() => null, (x) => x);
    t.check('cuenta sin llave aquí -> paso passkey (device_needs_passkey) sin firmar ni API', e4?.code === 'device_needs_passkey' && steps.length === 0 && !calls.some((c) => c.startsWith('sign')), `${e4?.code} ${calls}`);
    t.check('aviso: primero el paso passkey; huérfana corto, en tuteo, sin jerga', walletErrorNotice(e4) === DEVICE_STEP && !/billetera|passkey|llave|wallet|respaldo/i.test(DEVICE_NOT_AUTHORIZED) && /entra con otro correo/i.test(DEVICE_NOT_AUTHORIZED) && DEVICE_NOT_AUTHORIZED.length < 140);
    t.check('error del kit "no recovery set up" sin código -> aviso huérfana', walletErrorNotice(new Error('This wallet has no recovery set up for this device')) === DEVICE_NOT_AUTHORIZED);
  } finally { globalThis.fetch = realFetch; console.error = err; }
}
