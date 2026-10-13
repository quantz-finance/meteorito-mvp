// Activa la wallet Cavos del vendedor para recibir USDC (cuenta + trustline). La platform patrocina reservas y fee;
// el vendedor solo firma con Cavos (no necesita XLM). Idempotente: si ya está lista no pide firma.
import type { MeteoritoAuth } from './types';
import { api, proof } from './api';

export async function ensureWalletReady(auth: MeteoritoAuth): Promise<void> {
  const p = await api<{ ready: boolean; unsignedXdr?: string }>(auth, '/api/wallet/activate', { step: 'prepare', proof: await proof(auth, 'wallet', 'activate') });
  if (p.ready) return;
  if (!p.unsignedXdr) throw new Error('No pudimos activar tu cuenta para recibir pagos. Intentá de nuevo.');
  let signedXdr: string;
  try { signedXdr = await auth.signXdr(p.unsignedXdr); }
  catch (e) { console.error('[wallet] signXdr', e); throw Object.assign(new Error('No se pudo firmar la activación de tu cuenta.'), { code: 'sign_failed', cause: e }); }
  const s = await api<{ ready: boolean }>(auth, '/api/wallet/activate', { step: 'submit', signedXdr, proof: await proof(auth, 'wallet', 'activate') });
  if (!s.ready) throw new Error('Tu cuenta todavía no quedó activada. Intentá de nuevo en un minuto.');
}

/** Traduce errores técnicos (TW/Horizon) a un mensaje claro en español neutro. */
export function friendlyPayError(msg: string): string {
  if (/trustline|could not be validated|TW \/|send-transaction|result_codes/i.test(msg))
    return 'El vendedor todavía no puede recibir pagos. Avisale que abra Meteorito para activar su cuenta e intentá de nuevo.';
  return msg;
}

/** Vendedores con links ya publicados (antes de la activación obligatoria): activar al abrir Inicio/Pedidos.
 *  Una vez por dirección y sesión; nunca bloquea la pantalla. Devuelve un aviso si falló. */
const tried = new Set<string>();
export async function ensureSellerWalletOnLoad(auth: MeteoritoAuth, hasOrders: boolean): Promise<string | null> {
  if (!hasOrders || !auth.address || tried.has(auth.address)) return null;
  tried.add(auth.address);
  try { await ensureWalletReady(auth); return null; }
  catch (e: any) {
    tried.delete(auth.address);
    console.error('[wallet] activación falló', e?.code, e?.message, e);
    return walletErrorNotice(e);
  }
}

/** Aviso en español neutro con el código real (para soporte/QA). */
export function walletErrorNotice(e: any): string {
  const code = e?.code ?? 'desconocido';
  const base = code === 'sign_failed' ? 'No se pudo firmar la activación de tu cuenta.'
    : code === 'config_missing' || code === 'platform_mismatch' || code === 'platform_account_missing' ? 'La activación de cuentas no está disponible en este momento.'
    : 'Tu cuenta todavía no está activada para recibir pagos.';
  return `${base} Vuelve a abrir esta pantalla para reintentar. (código: ${code})`;
}
