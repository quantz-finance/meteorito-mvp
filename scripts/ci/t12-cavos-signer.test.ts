// (12) Wallet Cavos sin llave en este dispositivo (logout borra la llave del vault; cuenta no está on-chain):
// no se llama a signMessage/API; aviso genérico; logout protegido si la wallet no tiene respaldo.
import type { T } from './setup';
import { ensureWalletReady, ensureSellerWalletOnLoad, logoutSafely, walletErrorNotice, LOGOUT_BLOCKED } from '../../lib/wallet';
import { cavosRecoveryConfig } from '../../lib/config';
import type { MeteoritoAuth, WalletInfo } from '../../lib/types';

const mk = (w: Partial<WalletInfo>, calls: string[]): MeteoritoAuth => ({
  configured: true, isAuthenticated: true, isLoading: false, email: 's@ci', address: 'GSELLER', error: null,
  openLogin() {}, logout: async () => { calls.push('logout'); }, getAuthToken: () => 'tok',
  signMessage: async () => { calls.push('signMessage'); throw new Error('kit/stellar: this device is not an authorized signer of the wallet'); },
  signXdr: async () => { calls.push('signXdr'); return ''; },
  wallet: { state: 'ready', recoveryProtected: false, hasPasskey: false, approveDevice: async () => { calls.push('approve'); }, enrollPasskey: async () => { calls.push('enroll'); }, ...w },
});

export async function run(t: T) {
  const realFetch = globalThis.fetch; let fetched = 0;
  globalThis.fetch = (async (u: any) => { if (String(u).startsWith('/api')) fetched++; throw new Error('no debe llamar a la API'); }) as any; // Horizon (lectura) permitido
  const err = console.error; console.error = () => {};
  try {
    let calls: string[] = [];
    const e1 = await ensureWalletReady(mk({ state: 'needs-approval' }, calls)).then(() => null, (e) => e);
    t.check('needs-approval sin passkey -> device_not_authorized, sin firmar ni API', e1?.code === 'device_not_authorized' && calls.length === 0 && fetched === 0, `${e1?.code} ${calls}`);
    const n = walletErrorNotice(e1);
    t.check('aviso genérico (sin texto del kit ni código)', !/kit|signer|código|device/i.test(n), n);
    calls = [];
    const e2 = await ensureWalletReady(mk({ state: 'needs-approval', hasPasskey: true }, calls)).then(() => null, (e) => e);
    t.check('needs-approval con passkey -> aprueba dispositivo y pide reintento', e2?.code === 'device_approved_retry' && calls.join() === 'approve', `${e2?.code} ${calls}`);
    calls = [];
    t.check('wallet cargando -> no intenta ni avisa', (await ensureSellerWalletOnLoad(mk({ state: 'loading' }, calls), true)) === null && calls.length === 0);
    // Logout: la kit logout() hace vault.forget (borra la llave). Sin respaldo NUNCA se llama.
    calls = [];
    t.check('logout con respaldo -> llama logout', (await logoutSafely(mk({ recoveryProtected: true }, calls))) === null && calls.join() === 'logout', String(calls));
    calls = [];
    t.check('logout sin respaldo -> registra passkey y luego logout', (await logoutSafely(mk({}, calls))) === null && calls.join() === 'enroll,logout', String(calls));
    calls = [];
    const m = await logoutSafely(mk({ enrollPasskey: async () => { calls.push('enroll'); throw new Error('cancelado'); } }, calls));
    t.check('logout sin respaldo y sin passkey -> BLOQUEADO, nunca llama logout/forget', m === LOGOUT_BLOCKED && !calls.includes('logout'), String(calls));
    t.check('mensaje de bloqueo en español neutro (sin voseo) explica por qué', /no puedes cerrar sesión/.test(m!) && /respaldo/.test(m!) && !/(podés|tenés|cerrá|creá|volvé)/.test(m!));
    calls = [];
    t.check('wallet cargando -> no cierra sesión', (await logoutSafely(mk({ state: 'loading' }, calls))) !== null && !calls.includes('logout'));
    // Config: social recovery detrás de env (default off) y passkey opcional cuando está on.
    const off = cavosRecoveryConfig(undefined), on = cavosRecoveryConfig('true'), junk = cavosRecoveryConfig('no');
    t.check('EXPO_PUBLIC_CAVOS_SOCIAL_RECOVERY default off -> passkey required', !off.social && off.secureStep === 'required' && !junk.social);
    t.check('EXPO_PUBLIC_CAVOS_SOCIAL_RECOVERY=true -> social on, passkey optional', on.social && on.secureStep === 'optional');
  } finally { globalThis.fetch = realFetch; console.error = err; }
}
