// Activa la wallet Cavos del vendedor para recibir USDC (cuenta + trustline). La platform patrocina reservas y fee;
// el vendedor solo firma con Cavos (no necesita XLM). Idempotente: si ya está lista no pide firma.
import type { MeteoritoAuth } from './types';
import { userMessage } from './cavosSession';
import { fetchBalances } from './horizon';
import { DEMO_ENABLED } from './demo';
import { api, proof, ensureBound, __resetBindForTests as resetApiBind } from './api';
export { relinkMessage, bindMessage } from './api';

const coded = (code: string, msg: string) => Object.assign(new Error(msg), { code });

/** Antes de pedir firmas a Cavos: la llave debe estar en este dispositivo. */
export async function assertDeviceCanSign(auth: MeteoritoAuth): Promise<void> {
  const w = auth.wallet;
  if (!w || w.state === 'ready' || w.state === 'undeployed') return;
  if (w.state === 'loading') throw coded('wallet_loading', 'wallet Cavos cargando');
  // needs-approval: la llave de esta wallet no está aquí (logout borra la llave del vault Cavos).
  if (w.hasPasskey) { await w.approveDevice(); throw coded('device_approved_retry', 'dispositivo aprobado con passkey; reintentar'); }
  // Sin passkey: probar la vía de Cavos (recuperación social/enclave, si la cuenta la tiene). Si no hay respaldo, Cavos lanza
  // "This wallet has no recovery set up..." y esa es la causa real: la llave solo vive en el navegador/dispositivo original.
  if (w.authorize) {
    try { await w.authorize(); if (auth.wallet?.state === 'ready') return; }
    catch (e: any) { console.error('[wallet] authorizeDevice falló (causa real):', e?.message, e); throw Object.assign(coded('device_not_authorized', `Cavos: ${e?.message ?? 'dispositivo no autorizado'}`), { cause: e }); }
  }
  throw coded('device_not_authorized', 'kit/stellar: este dispositivo no es firmante de la wallet y no hay passkey/recuperación');
}

export async function ensureWalletReady(auth: MeteoritoAuth): Promise<void> {
  if (DEMO_ENABLED) return; // demo: wallet simulada, lista
  // Ya lista on-chain (cuenta + trustline USDC): nada que hacer, sin llamar al API ni pedir firmas.
  if (auth.address) { const b = await fetchBalances(auth.address).catch(() => null); if (b?.funded && b.usdc !== null) return; }
  await assertDeviceCanSign(auth);
  const p = await api<{ ready: boolean; unsignedXdr?: string }>(auth, '/api/wallet/activate', { step: 'prepare', proof: await proof(auth, 'wallet', 'activate') });
  if (p.ready) return;
  if (!p.unsignedXdr) throw new Error('No pudimos activar tu cuenta para recibir pagos. Intenta de nuevo.');
  let signedXdr: string;
  try { signedXdr = await auth.signXdr(p.unsignedXdr); }
  catch (e) { console.error('[wallet] signXdr', e); throw Object.assign(new Error('No se pudo firmar la activación de tu cuenta.'), { code: 'sign_failed', cause: e }); }
  const s = await api<{ ready: boolean }>(auth, '/api/wallet/activate', { step: 'submit', signedXdr, proof: await proof(auth, 'wallet', 'activate') });
  if (!s.ready) throw new Error('Tu cuenta todavía no quedó activada. Intenta de nuevo en un minuto.');
}

/** Traduce errores técnicos (TW/Horizon) a un mensaje claro en español neutro. */
export function friendlyPayError(msg: string): string {
  if (/trustline|could not be validated|TW \/|send-transaction|result_codes/i.test(msg))
    return 'El vendedor todavía no puede recibir pagos. Avísale que abra Meteorito para activar su cuenta e intenta de nuevo.';
  return userMessage(msg); // errores técnicos de Cavos -> español
}

/** Vendedores con links ya publicados (antes de la activación obligatoria): activar al abrir Inicio/Pedidos.
 *  Una vez por dirección y sesión; nunca bloquea la pantalla. Devuelve un aviso si falló. */
const tried = new Set<string>();
export async function ensureSellerWalletOnLoad(auth: MeteoritoAuth, hasOrders: boolean): Promise<string | null> {
  if (!hasOrders || !auth.address || tried.has(auth.address)) return null;
  if (auth.wallet?.state === 'loading') return null; // reintenta cuando Cavos termine de cargar
  tried.add(auth.address);
  try { await ensureWalletReady(auth); return null; }
  catch (e: any) {
    tried.delete(auth.address);
    console.error('[wallet] activación falló', e?.code, e?.message, e);
    return walletErrorNotice(e);
  }
}

/** La cuenta (correo) ya tiene una billetera cuya llave no está en este navegador/dispositivo y no tiene respaldo. */
export const DEVICE_NOT_AUTHORIZED = 'Este correo se usó antes en otro teléfono o navegador y aquí no lo podemos abrir. Para vender, entra con otro correo.';
export const WALLET_LOADING = 'Tu cuenta todavía se está preparando. Espera unos segundos e intenta de nuevo.';
/** Cuenta Cavos cuya llave no está en este dispositivo y sin passkey para restaurarla (p. ej. wallet vieja creada en
 *  otro navegador; en iPhone la PWA de la pantalla de inicio NO comparte almacenamiento con Safari). */
export const isOrphanWallet = (auth: Pick<MeteoritoAuth, 'wallet'>) => auth.wallet?.state === 'needs-approval' && !auth.wallet.hasPasskey;
const ORPHAN_RE = /no recovery|not an? (authorized )?signer|needs? device approval|device (is )?not authori[sz]ed|no passkey/i;

/** Aviso genérico para el usuario (sin detalles técnicos). El código real va solo a console/logs. */
export function walletErrorNotice(e: any): string {
  console.error('[wallet] error', e?.code ?? 'desconocido', e?.message, e?.cause?.message ?? '', e);
  if (e?.code === 'session_relogin_required') return e?.message || 'Tu sesión venció. Vuelve a iniciar sesión con la misma cuenta para continuar. Tu billetera se mantiene en este dispositivo.';
  if (e?.code === 'session_wallet_mismatch' || e?.code === 'session_expired') return e?.message || 'Tu sesión venció. Vuelve a iniciar sesión para continuar.';
  if (e?.code === 'device_not_authorized' || ORPHAN_RE.test(String(e?.message ?? '')) || ORPHAN_RE.test(String(e?.cause?.message ?? ''))) return DEVICE_NOT_AUTHORIZED;
  if (e?.code === 'wallet_loading') return WALLET_LOADING;
  if (e?.code === 'device_approved_retry') return 'Listo, confirmamos este dispositivo. Toca el botón de nuevo para continuar.';
  return 'No pudimos preparar tu cuenta para recibir pagos. Intenta de nuevo en un momento.';
}

/** Mensaje (español neutro) cuando no se puede cerrar sesión porque la billetera no tiene respaldo. */
export const LOGOUT_BLOCKED = 'Todavía no puedes cerrar sesión: tu billetera no tiene respaldo. Al cerrar sesión se borra la llave de este dispositivo y perderías el acceso a tu dinero. Crea una passkey de respaldo (o espera a que se active la recuperación de cuenta) y vuelve a intentar.';

/** Cerrar sesión con Cavos (logout) BORRA la llave del vault (vault.forget). Sin respaldo (social/passkey) eso es
 *  perder la billetera: NUNCA llamamos auth.logout() en ese caso. Intentamos registrar una passkey; si no se puede,
 *  bloqueamos y explicamos. Devuelve null si cerró sesión, o el mensaje a mostrar. */
export async function logoutSafely(auth: MeteoritoAuth): Promise<string | null> {
  const w = auth.wallet;
  if (w && w.state === 'loading') return 'Espera un momento a que cargue tu billetera y vuelve a intentar.';
  const backedUp = !w || w.recoveryProtected || w.state === 'needs-approval'; // needs-approval: la llave ya no está aquí
  if (!backedUp) {
    try { await w!.enrollPasskey(); }
    catch (e) { console.error('[wallet] logout bloqueado: sin respaldo', e); return LOGOUT_BLOCKED; }
  }
  await auth.logout();
  return null;
}

/** Primer login y cada re-login (token FRESCO nuevo): liga sub -> wallet en el servidor (idempotente, sin on-chain).
 *  Token vencido o wallet sin llave en este dispositivo: se omite en silencio. Una vez por token. */
export async function bindWalletOnLogin(auth: MeteoritoAuth): Promise<boolean> {
  return ensureBound(auth);
}
export const __resetBindForTests = () => { resetApiBind(); };
