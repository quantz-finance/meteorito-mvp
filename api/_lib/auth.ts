// Auth server-side para escrituras:
// 1) JWT de Cavos (Authorization: Bearer) verificado por firma contra JWKS (Cavos / Google / Apple).
// 2) Prueba de dirección: wallet.signMessage() de Cavos (ed25519 del control key) sobre un mensaje
//    con acción+slug+dirección+timestamp. Así seller/buyer address no es spoofeable.
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { Keypair, Horizon } from '@stellar/stellar-sdk';
import { env } from './env';

const JWKS: Record<string, ReturnType<typeof createRemoteJWKSet>> = {};
function jwksFor(iss: string) {
  const url = iss === 'https://accounts.google.com' ? 'https://www.googleapis.com/oauth2/v3/certs'
    : iss === 'https://appleid.apple.com' ? 'https://appleid.apple.com/auth/keys'
    : env.cavosJwks();
  return (JWKS[url] ??= createRemoteJWKSet(new URL(url)));
}

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export interface CavosUser { sub: string; email?: string; iss: string }
export async function requireCavosUser(req: any): Promise<CavosUser> {
  const h: string = req.headers?.authorization ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) throw new HttpError(401, 'falta token de Cavos');
  let claims: { iss?: unknown; aud?: unknown };
  try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); } catch { throw new HttpError(401, 'token malformado'); }
  const iss = typeof claims.iss === 'string' ? claims.iss : '';
  // Issuer: allowlist exacta + jwtVerify vuelve a exigirlo sobre el payload firmado.
  if (!env.cavosIssuers().includes(iss)) {
    console.warn('[auth] issuer rechazado', JSON.stringify({ iss, aud: claims.aud }));
    throw new HttpError(401, 'issuer no permitido');
  }
  const audiences = env.cavosAudiences();
  const logOnly = env.cavosAudienceLogOnly();
  if (!audiences.length && !logOnly && env.isProduction()) {
    // Fail closed: en producción no aceptamos tokens sin audiencia configurada.
    console.error('[auth] CAVOS_JWT_AUDIENCE no configurado en producción; rechazando', JSON.stringify({ iss, aud: claims.aud }));
    throw new HttpError(503, 'autenticación no configurada');
  }
  const enforce = audiences.length > 0 && !logOnly;
  let payload: JWTPayload;
  try { ({ payload } = await jwtVerify(token, jwksFor(iss), { issuer: iss, audience: enforce ? audiences : undefined })); }
  catch (e: any) {
    // Nunca se loguea el token; solo iss/aud para confirmar el valor real.
    console.warn('[auth] token rechazado', JSON.stringify({ code: e.code ?? e.message, iss, aud: claims.aud, expected: audiences }));
    throw new HttpError(401, `token inválido: ${e.code ?? e.message}`);
  }
  if (!enforce) {
    const aud = ([] as unknown[]).concat(payload.aud ?? []);
    const match = audiences.length > 0 && aud.some((a) => audiences.includes(String(a)));
    console.warn('[auth] aud NO verificado (' + (logOnly ? 'LOG_ONLY' : 'sin CAVOS_JWT_AUDIENCE, no-prod') + ')', JSON.stringify({ iss, aud: payload.aud, expected: audiences, match }));
  }
  const sub = String(payload.sub ?? (payload as any).user_id ?? '');
  if (!sub) throw new HttpError(401, 'token sin sub');
  return { sub, email: (payload as any).email, iss };
}

export interface AddressProof { address: string; publicKey: string; signature: string /* base64 */; message: string }
export const proofMessage = (action: string, ref: string, address: string, ts: number) => `meteorito:${action}:${ref}:${address}:${ts}`;

function prefixed(msg: string): Buffer {
  const m = Buffer.from(msg, 'utf8');
  return Buffer.concat([Buffer.from('Cavos Signed Message:\n'), Buffer.from(String(m.length)), Buffer.from('\n'), m]);
}

/** Verifica que quien llama controla `address` (Cavos G… classic multisig: el control key es signer). */
export async function requireAddressProof(p: AddressProof | undefined, action: string, ref: string): Promise<string> {
  if (!p?.address || !p.publicKey || !p.signature || !p.message) throw new HttpError(401, 'falta prueba de dirección');
  const parts = p.message.split(':');
  const ts = Number(parts[4]);
  if (p.message !== proofMessage(action, ref, p.address, ts)) throw new HttpError(401, 'mensaje de prueba no coincide');
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) throw new HttpError(401, 'prueba vencida');
  const sig = Buffer.from(p.signature, 'base64');
  const kp = Keypair.fromPublicKey(p.publicKey);
  // El SDK firma los bytes del mensaje con prefijo Cavos; aceptamos también sin prefijo por si cambia.
  if (!kp.verify(prefixed(p.message), sig) && !kp.verify(Buffer.from(p.message), sig)) throw new HttpError(401, 'firma inválida');
  if (p.publicKey !== p.address) {
    const acct = await new Horizon.Server(env.horizon()).loadAccount(p.address).catch(() => null);
    const s = acct?.signers.find((x) => x.key === p.publicKey);
    if (!acct || !s || s.weight < acct.thresholds.med_threshold) throw new HttpError(401, 'el control key no es signer de la cuenta');
  }
  return p.address;
}
