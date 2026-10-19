// Chunk perezoso (web): proveedor Cavos + puente hacia authStore. Aquí viven @cavos/kit, starknet, solana, iconos, etc.
import '@/lib/polyfills'; // antes de @cavos/kit
import { CavosProvider, useCavos } from '@cavos/kit/react';
import { useEffect, useRef } from 'react';
import { track } from './analytics';
import { CAVOS_SECURE_STEP, CAVOS_SOCIAL_RECOVERY, APP_SALT, CAVOS_APP_ID } from './config';
import { authStore, useAuthFlag } from './authStore';
import { walletInfo, type MeteoritoAuth } from './types';
import { Brand } from '@/constants/Colors';
import { clearCavosToken, currentCavosToken, friendlyCavosError, persistCavosToken, rehydrateCavosToken, RELOGIN_MESSAGE, sessionExpiredOnOpen, hadSessionOnOpen, markSessionSettled, userMessage } from './cavosSession';

// Se ejecuta al cargar este chunk, ANTES de que CavosProvider lea sessionStorage (PWA iOS: ver lib/cavosSession.ts).
const rehydrated = typeof window !== 'undefined' ? rehydrateCavosToken() : 'none';
if (rehydrated !== 'none' && rehydrated !== 'present') console.info('[cavos] token', rehydrated);
const hadSessionOnOpenAtStart = typeof window !== 'undefined' && hadSessionOnOpen();

function b64(u: Uint8Array) { let s = ''; u.forEach((b) => (s += String.fromCharCode(b))); return btoa(s); }
function stellarWallet(c: any): any {
  const w = c.session?.wallet ? c.session.wallet('stellar') : c.session;
  if (!w) throw new Error('Wallet Cavos no lista');
  return w;
}

/** Errores del SDK al firmar: mensaje traducido, el original queda en `cause` (y en consola) para diagnóstico. */
function cavosErr(e: unknown): Error {
  const raw = e instanceof Error ? e.message : String(e);
  console.error('[cavos]', raw, e);
  return Object.assign(new Error(userMessage(raw)), { cause: e, code: (e as any)?.code, raw });
}

function Bridge() {
  const c = useCavos();
  const wantLogin = useAuthFlag('wantLogin');
  const auth: MeteoritoAuth = {
    configured: !!CAVOS_APP_ID,
    isAuthenticated: c.isAuthenticated,
    isLoading: c.isLoading,
    email: c.user?.email ?? null,
    address: c.address,
    // Nunca el error crudo del SDK (registry/backup/lookup/passkey-wraps 401...): siempre un mensaje propio en español.
    // Sesión guardada que venció o que el SDK no pudo reconectar (falló en silencio): "Entrar de nuevo", no una pantalla muda.
    error: friendlyCavosError(c.authError) ?? (!c.isAuthenticated && !c.isLoading && (sessionExpiredOnOpen() || hadSessionOnOpen()) ? RELOGIN_MESSAGE : null),
    openLogin: () => { c.clearAuthError(); c.openModal(); },
    logout: async () => { markSessionSettled(); clearCavosToken(); try { await c.logout(); } finally { clearCavosToken(); } },
    getAuthToken: () => currentCavosToken(),
    signMessage: async (m) => { try { const r = await stellarWallet(c).signMessage(m); return { publicKey: r.publicKey, signature: b64(r.signature) }; } catch (e) { throw cavosErr(e); } },
    signXdr: async (x) => { try { return await stellarWallet(c).signXdr(x); } catch (e) { throw cavosErr(e); } },
    wallet: walletInfo(c),
  };
  // Publicar a la app en cada render del SDK (los suscriptores no re-renderizan a Bridge: sin bucle).
  useEffect(() => { authStore.setBridged(auth); });
  // Tras cada login/re-login el SDK deja un token nuevo en sessionStorage: guardarlo para la próxima apertura.
  useEffect(() => { if (c.isAuthenticated) { persistCavosToken(); markSessionSettled(); } }, [c.isAuthenticated, c.address, c.user?.email]);
  useEffect(() => () => authStore.setBridged(null), []);
  // Diagnóstico (sin datos personales): ¿la sesión guardada se restauró sola al abrir? Para medir el fix en iPhone (PWA).
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current || c.isLoading || !hadSessionOnOpenAtStart) return;
    reported.current = true;
    const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true);
    const dbs: Promise<string[]> = (indexedDB as any)?.databases ? (indexedDB as any).databases().then((l: any[]) => l.map((d) => d.name)).catch(() => []) : Promise.resolve([]);
    dbs.then((names) => track('cavos_session_restore', {
      rehydrated, standalone, ok: c.isAuthenticated, device_key: names.includes('cavos-kit-stellar-control'),
      error: c.authError ? String(c.authError).slice(0, 60) : null,
    }));
  }, [c.isLoading, c.isAuthenticated]);
  // El usuario tocó "Entrar" antes de que el SDK cargara: abrir el modal ahora.
  useEffect(() => {
    if (!wantLogin || c.isLoading) return;
    authStore.consumeLogin();
    if (!c.isAuthenticated) { c.clearAuthError(); c.openModal(); }
  }, [wantLogin, c.isLoading, c.isAuthenticated]);
  return null;
}

export default function CavosBridge() {
  return (
    <CavosProvider
      config={{ appId: CAVOS_APP_ID, chain: 'stellar', network: 'testnet', appSalt: APP_SALT, persistSession: true, socialRecovery: CAVOS_SOCIAL_RECOVERY }}
      modal={{ appName: 'Meteorito', providers: ['google', 'apple', 'email'], emailMode: 'otp', primaryColor: Brand.purple, secureStep: CAVOS_SECURE_STEP }}>
      <Bridge />
    </CavosProvider>
  );
}
