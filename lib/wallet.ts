// Activa la wallet Cavos del vendedor para recibir USDC (cuenta + trustline). La platform patrocina reservas y fee;
// el vendedor solo firma con Cavos (no necesita XLM). Idempotente: si ya está lista no pide firma.
import type { MeteoritoAuth } from './types';
import { userMessage } from './cavosSession';
import { fetchBalances } from './horizon';
import { DEMO_ENABLED } from './demo';
import { authStore } from './authStore';
import { api, proof, ensureBound, __resetBindForTests as resetApiBind } from './api';
export { relinkMessage, bindMessage } from './api';

const coded = (code: string, msg: string) => Object.assign(new Error(msg), { code });

/** La versión más reciente del puente Cavos (web): tras restaurar, el `auth` del handler queda viejo (su sesión no tiene llave). */
export function freshAuth(auth: MeteoritoAuth): MeteoritoAuth { return authStore.get().bridged ?? auth; }
const canSign = (a: MeteoritoAuth) => a.wallet?.state === 'ready' || a.wallet?.state === 'undeployed';

/** Antes de pedir firmas a Cavos: la llave debe estar en este dispositivo. En un segundo dispositivo (needs-approval) NO se
 *  intenta nada aquí: la passkey (WebAuthn) necesita un toque directo del usuario en iPhone, así que la UI muestra el paso
 *  "Confirma que eres tú" (components/OrphanWallet.tsx → restoreDevice). */
export async function assertDeviceCanSign(auth: MeteoritoAuth): Promise<void> {
  const w = auth.wallet;
  if (!w || w.state === 'ready' || w.state === 'undeployed') return;
  if (w.state === 'loading') throw coded('wallet_loading', 'wallet Cavos cargando');
  throw coded('device_needs_passkey', 'este dispositivo todavía no tiene la llave: confirmar con passkey');
}

/** Segundo (o N-ésimo) dispositivo: la cuenta Cavos (Stellar, DEK nativa) se abre aquí con la passkey del usuario; la
 *  dirección es la misma en todos los dispositivos (se deriva de la misma DEK). Llamar desde un toque del usuario.
 *  Devuelve el `auth` fresco ya listo para firmar. */
export async function restoreDevice(auth: MeteoritoAuth, opts: { fresh?: (a: MeteoritoAuth) => MeteoritoAuth; timeoutMs?: number } = {}): Promise<MeteoritoAuth> {
  const fresh = opts.fresh ?? freshAuth;
  const w = auth.wallet;
  if (!w || canSign(auth)) return auth;
  try {
    await w.approveDevice(); // Stellar DEK nativa: reconecta con { passkey: true } → el vault pide la passkey y descifra la DEK
  } catch (e: any) {
    const m = String(e?.name ?? '') + ' ' + String(e?.message ?? '');
    const code = /NotAllowed|cancel|abort|timed? ?out/i.test(m) ? 'device_restore_cancelled' : 'device_restore_failed';
    console.error('[wallet] restoreDevice', code, e?.name, e?.message);
    throw Object.assign(coded(code, 'no se pudo abrir la cuenta en este dispositivo'), { cause: e });
  }
  const until = Date.now() + (opts.timeoutMs ?? 15000);
  for (;;) {
    const a = fresh(auth);
    if (canSign(a)) return a;
    if (Date.now() > until) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  // La passkey respondió pero la cuenta sigue sin llave aquí: no existe respaldo con passkey para este correo.
  if (w.authorize) {
    try { await w.authorize(); const a = fresh(auth); if (canSign(a)) return a; } catch (e: any) { console.error('[wallet] authorizeDevice', e?.message); }
  }
  throw coded('device_restore_no_backup', 'la cuenta no tiene passkey de respaldo para abrirla aquí');
}

export async function ensureWalletReady(auth: MeteoritoAuth): Promise<void> {
  if (DEMO_ENABLED) return; // demo: wallet simulada, lista
  // Primero la llave en ESTE dispositivo: aunque la cuenta ya esté activa on-chain (activada desde el dispositivo 1), aquí
  // después hay que firmar (prueba de create). Antes se saltaba y el create fallaba en el dispositivo 2.
  await assertDeviceCanSign(auth);
  // Ya lista on-chain (cuenta + trustline USDC): nada que hacer, sin llamar al API ni pedir firmas.
  if (auth.address) { const b = await fetchBalances(auth.address).catch(() => null); if (b?.funded && b.usdc !== null) return; }
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
  if (auth.wallet?.state === 'needs-approval') return null; // segundo dispositivo: lo resuelve la tarjeta "Confirma que eres tú"
  tried.add(auth.address);
  try { await ensureWalletReady(auth); return null; }
  catch (e: any) {
    tried.delete(auth.address);
    console.error('[wallet] activación falló', e?.code, e?.message, e);
    return walletErrorNotice(e);
  }
}

/** La cuenta (correo) ya tiene una billetera cuya llave no está en este navegador/dispositivo y no tiene respaldo. */
/** Segundo dispositivo: paso guiado (tuteo, sin jerga). */
export const DEVICE_STEP_TITLE = 'Confirma que eres tú';
export const DEVICE_STEP = 'Entraste desde otro teléfono o navegador. Usa tu passkey (Face ID, Touch ID o el PIN de tu teléfono) para vender aquí también.';
export const DEVICE_STEP_HELP = 'En iPhone tu passkey está en el Llavero de iCloud. Si la creaste en otro teléfono, elige "Otro dispositivo" y escanea el QR con ese teléfono.';
export const DEVICE_STEP_CANCELLED = 'No se completó. Toca "Usar mi passkey" otra vez.';
/** Necesita el paso de passkey (código propio o error del kit "not an authorized signer"). */
export const needsDeviceStep = (e: any) => e?.code === 'device_needs_passkey' || (!e?.code && /not an? (authorized )?signer|needs? device approval/i.test(String(e?.message ?? '')));
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
  if (needsDeviceStep(e)) return DEVICE_STEP;
  if (e?.code === 'device_restore_cancelled') return DEVICE_STEP_CANCELLED;
  if (e?.code === 'device_not_authorized' || e?.code === 'device_restore_no_backup' || e?.code === 'device_restore_failed' || ORPHAN_RE.test(String(e?.message ?? '')) || ORPHAN_RE.test(String(e?.cause?.message ?? ''))) return DEVICE_NOT_AUTHORIZED;
  if (e?.code === 'wallet_loading') return WALLET_LOADING;
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
