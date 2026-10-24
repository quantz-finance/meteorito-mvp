// Auth server-side para escrituras:
// 1) JWT de Cavos (Authorization: Bearer) verificado por firma contra JWKS (Cavos / Google / Apple).
// 2) Prueba de dirección: wallet.signMessage() de Cavos (ed25519 del control key) sobre un mensaje
//    con acción+slug+dirección+timestamp. Así seller/buyer address no es spoofeable.
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { Keypair, Horizon } from '@stellar/stellar-sdk';
import { env } from './env';

const JWKS: Record<string, ReturnType<typeof createRemoteJWKSet>> = {};
type KeyGetter = Parameters<typeof jwtVerify>[1];
let testKeys: KeyGetter | null = null;
/** Solo tests (CI): verificar contra un JWKS local en vez de Cavos/Google/Apple. Nunca se llama en runtime. */
export const __setJwksForTests = (k: KeyGetter | null) => { testKeys = k; };
const GOOGLE_ISS = ['https://accounts.google.com', 'accounts.google.com'];
const APPLE_ISS = 'https://appleid.apple.com';
function jwksFor(iss: string): any {
  if (testKeys) return testKeys;
  const url = GOOGLE_ISS.includes(iss) ? 'https://www.googleapis.com/oauth2/v3/certs'
    : iss === 'https://appleid.apple.com' ? 'https://appleid.apple.com/auth/keys'
    : env.cavosJwks();
  return (JWKS[url] ??= createRemoteJWKSet(new URL(url)));
}

export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export interface CavosUser { sub: string; email?: string; iss: string; renewed?: boolean }
// Nunca "vuelve a cargar la página": recargar no renueva el token de Cavos (era el 59 % de los error_shown).
export const SESSION_EXPIRED = 'Tu sesión venció. Vuelve a entrar con la misma cuenta para continuar.';
export const SESSION_OTHER_WALLET = 'Tu sesión pertenece a otra cuenta o billetera. Vuelve a iniciar sesión para continuar.';
export const SESSION_RELOGIN = 'Tu sesión venció. Vuelve a iniciar sesión con la misma cuenta para continuar. Tu billetera se mantiene en este dispositivo.';
export const AUTH_INVALID = 'No pudimos verificar tu sesión. Vuelve a entrar con la misma cuenta para continuar.';
const coded = (status: number, code: string, msg: string) => Object.assign(new HttpError(status, msg), { code });
/** auth_invalid con motivo (issuer/aud/signature/...) e issuer (host) para diagnosticar sin token ni sub. */
const invalid = (reason: string, iss = '') => Object.assign(coded(401, 'auth_invalid', AUTH_INVALID), { reason, issHost: issHost(iss) });
const issHost = (iss: string) => { try { return new URL(/^https?:/.test(iss) ? iss : `https://${iss}`).host.slice(0, 60); } catch { return ''; } };
const joseReason = (e: any) => { const c = String(e?.code ?? ''); return c === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' || c === 'ERR_JWKS_NO_MATCHING_KEY' ? 'signature' : c === 'ERR_JWT_CLAIM_VALIDATION_FAILED' ? (/^[a-z]{2,10}$/.test(String(e?.claim)) ? String(e.claim) : 'claim') : 'token'; };
/** ref de la prueba de sesión (sin ':' para no romper el formato del mensaje). Igual en cliente (lib/api.ts). */
export const sessionRef = (sub: string) => sub.replace(/[^A-Za-z0-9_-]/g, '_');
const graceS = () => { const d = Number(process.env.SESSION_GRACE_DAYS ?? '7'); return (Number.isFinite(d) && d >= 0 && d <= 30 ? d : 7) * 86400; };
/** Mensaje firmado para renovar sesión: no reutilizable (nonce de un uso) y atado a método + ruta. */
export const sessionMessage = (sub: string, nonce: string, method: string, path: string) => `meteorito:session:${sessionRef(sub)}:${nonce}:${method.toUpperCase()}:${path}`;

/** Persistencia de sesión (la instala db.ts; tests la reemplazan). */
export interface SessionStore {
  boundWallet(sub: string): Promise<string | null>;
  bind(sub: string, address: string): Promise<void>;
  /** Reemplaza el binding (solo usado por bindWalletIfFresh cuando la wallet anterior nunca existió on-chain). */
  rebind(sub: string, address: string): Promise<void>;
  issueNonce(sub: string): Promise<string>;
  /** true si existía, era de este sub, no usado y no vencido; lo marca usado (atómico). */
  consumeNonce(sub: string, nonce: string): Promise<boolean>;
}
let store: SessionStore | null = null;
export const __setSessionStore = (s: SessionStore) => { store = s; };
const sessionStore = () => { if (!store) throw new Error('session store no instalado'); return store; };

export const bindMessage = (sub: string, nonce: string) => `meteorito:bind:${sessionRef(sub)}:${nonce}`;

/** Prueba de bind: {address, publicKey, signature, nonce} firmada sobre bindMessage(sub, nonce); consume el nonce (1 uso, 5 min, del sub). */
export async function requireBindProof(user: CavosUser, p: any): Promise<string> {
  return consumeSignedNonce(user, p, bindMessage(user.sub, String(p?.nonce ?? '')), 'bind');
}
/** Prueba {address, publicKey, signature, nonce} sobre `message`; consume el nonce (1 uso, 5 min, del sub). */
export async function consumeSignedNonce(user: CavosUser, p: any, message: string, kind: string): Promise<string> {
  const bad = (why: string) => { console.warn(`[auth] ${kind} rechazado`, why); return Object.assign(new HttpError(401, AUTH_INVALID), { code: `${kind}_invalid` }); };
  if (!p?.address || !p.publicKey || !p.signature || typeof p.nonce !== 'string' || !/^[a-f0-9]{32,128}$/.test(p.nonce)) throw bad('prueba incompleta');
  try { await verifySignedBy(p.address, p.publicKey, message, p.signature); } catch { throw bad('firma inválida'); }
  if (!(await sessionStore().consumeNonce(user.sub, p.nonce))) throw bad('nonce inválido, vencido, ajeno o ya usado');
  return p.address;
}
export const boundWalletOf = (sub: string) => sessionStore().boundWallet(sub);
export const rebindWallet = (sub: string, address: string) => sessionStore().rebind(sub, address);

/** Liga sub -> wallet SOLO con token fresco (no renovado). Primera vez gana; no se sobrescribe. */
export async function bindWalletIfFresh(user: CavosUser, address: string): Promise<'bound' | 'same' | 'other_wallet' | 'skipped'> {
  if (user.renewed) return 'skipped';
  const bound = await sessionStore().boundWallet(user.sub);
  if (!bound) { await sessionStore().bind(user.sub, address); return 'bound'; }
  if (bound === address) return 'same';
  // Nunca se reemplaza aquí: solo con step 'relink' explícito (api/_lib/relink.ts).
  console.warn('[auth] bind: sub ya ligado a otra wallet; requiere relink', JSON.stringify({ bound: bound.slice(0, 6), got: address.slice(0, 6) }));
  return 'other_wallet';
}

/** Verifica firma/iss/aud. Si solo está vencido (≤ SESSION_GRACE_DAYS) devuelve expired:true. */
async function verifyToken(token: string): Promise<{ payload: JWTPayload; iss: string; expired: boolean; exp: number }> {
  let claims: { iss?: unknown; aud?: unknown; exp?: unknown };
  try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); } catch { throw invalid('malformed'); }
  const iss = typeof claims.iss === 'string' ? claims.iss : '';
  const allowed = env.cavosIssuers();
  const isGoogle = GOOGLE_ISS.includes(iss) && allowed.some((a) => GOOGLE_ISS.includes(a)); // Google emite con y sin https
  if (!allowed.includes(iss) && !isGoogle) {
    console.warn('[auth] issuer rechazado', JSON.stringify({ iss, aud: claims.aud }));
    throw invalid('issuer', iss);
  }
  // aud por issuer: app id de Cavos (CAVOS_JWT_AUDIENCE) + el cliente OAuth de Cavos SOLO para tokens de Google/Apple.
  // Sin esto, entrar con Google/Apple (p. ej. cuenta existente en un dispositivo nuevo) fallaba con auth_invalid.
  const base = env.cavosAudiences();
  const audiences = !base.length ? base : isGoogle ? [...base, ...env.googleAudiences()] : iss === APPLE_ISS ? [...base, ...env.appleAudiences()] : base;
  const logOnly = env.cavosAudienceLogOnly();
  if (!audiences.length && !logOnly && env.isProduction()) {
    console.error('[auth] CAVOS_JWT_AUDIENCE no configurado en producción; rechazando', JSON.stringify({ iss, aud: claims.aud }));
    throw new HttpError(503, 'autenticación no configurada');
  }
  const enforce = audiences.length > 0 && !logOnly;
  const opts = { issuer: iss, audience: enforce ? audiences : undefined };
  const exp = Number(claims.exp);
  let payload: JWTPayload; let expired = false;
  try { ({ payload } = await jwtVerify(token, jwksFor(iss), opts)); }
  catch (e: any) {
    console.warn('[auth] token rechazado', JSON.stringify({ code: e.code ?? e.message, iss, aud: claims.aud, expected: audiences }));
    if (e.code !== 'ERR_JWT_EXPIRED') throw invalid(joseReason(e), iss);
    if (!exp || Date.now() / 1000 - exp > graceS()) throw coded(401, 'session_expired', SESSION_EXPIRED);
    try { ({ payload } = await jwtVerify(token, jwksFor(iss), { ...opts, currentDate: new Date((exp - 5) * 1000) })); }
    catch (e2: any) { throw invalid(joseReason(e2), iss); }
    expired = true;
  }
  if (!enforce) {
    const aud = ([] as unknown[]).concat(payload.aud ?? []);
    const match = audiences.length > 0 && aud.some((a) => audiences.includes(String(a)));
    console.warn('[auth] aud NO verificado (' + (logOnly ? 'LOG_ONLY' : 'sin CAVOS_JWT_AUDIENCE, no-prod') + ')', JSON.stringify({ iss, aud: payload.aud, expected: audiences, match }));
  }
  return { payload, iss, expired, exp };
}
const bearer = (req: any) => { const h: string = req.headers?.authorization ?? ''; return h.startsWith('Bearer ') ? h.slice(7) : ''; };
const subOf = (p: JWTPayload) => String(p.sub ?? (p as any).user_id ?? '');

/** Nonce de un uso (5 min) para renovar sesión. Acepta token vencido dentro de la ventana (aún no hay prueba). */
export async function issueSessionNonce(req: any): Promise<string> {
  const token = bearer(req);
  if (!token) throw coded(401, 'auth_missing', 'Inicia sesión para continuar.');
  const v = await verifyToken(token);
  const sub = subOf(v.payload);
  if (!sub) throw invalid('no_sub', v.iss);
  if (v.expired) await requireBoundForExpired(sub);
  return sessionStore().issueNonce(sub);
}

/** Token vencido (firma/iss/aud ya válidos) y SIN fila en user_wallets: renovar nunca va a funcionar -> re-login de Cavos
 *  (sin logout). Código propio, el cliente no reintenta. Solo aplica a ERR_JWT_EXPIRED; firma/iss/aud malos siguen auth_invalid. */
async function requireBoundForExpired(sub: string): Promise<string> {
  const bound = await sessionStore().boundWallet(sub);
  if (!bound) { console.warn('[auth] renovación rechazada sin wallet ligada: requiere re-login'); throw coded(401, 'session_relogin_required', SESSION_RELOGIN); }
  return bound;
}

/** Header X-Meteorito-Proof: base64(JSON {address, publicKey, signature, nonce}). Firma sobre sessionMessage(sub, nonce, METHOD, path). */
async function renewExpired(req: any, sub: string, exp: number): Promise<void> {
  const fail = (why: string) => { console.warn('[auth] renovación rechazada', why); return coded(401, 'session_expired', SESSION_EXPIRED); };
  const bound = await requireBoundForExpired(sub);
  const raw: string = req.headers?.['x-meteorito-proof'] ?? '';
  if (!raw) throw fail('sin prueba');
  let p: { address?: string; publicKey?: string; signature?: string; nonce?: string };
  try { p = JSON.parse(Buffer.from(raw, 'base64').toString()); } catch { throw fail('prueba malformada'); }
  if (!p.address || !p.publicKey || !p.signature || !p.nonce || !/^[a-f0-9]{32,128}$/.test(p.nonce)) throw fail('prueba incompleta');
  // Wallet distinta a la ligada: renovar NUNCA va a funcionar con esta prueba -> código propio (el cliente no reintenta).
  const relogin = (why: string) => { console.warn('[auth] renovación rechazada', why); return coded(401, 'session_wallet_mismatch', SESSION_OTHER_WALLET); };
  if (p.address !== bound) throw relogin(`wallet distinta a la ligada (${p.address.slice(0, 6)} vs ${bound.slice(0, 6)})`);
  const path = String(req.url ?? '').split('?')[0];
  const msg = sessionMessage(sub, p.nonce, String(req.method ?? ''), path);
  try { await verifySignedBy(p.address, p.publicKey, msg, p.signature); } catch { throw fail('firma inválida o método/ruta distintos'); }
  if (!(await sessionStore().consumeNonce(sub, p.nonce))) throw fail('nonce inválido, vencido o ya usado');
  console.log('[auth] sesión renovada con prueba de wallet', JSON.stringify({ expiredFor: Math.round(Date.now() / 1000 - exp) }));
}
export async function requireCavosUser(req: any): Promise<CavosUser> {
  const token = bearer(req);
  if (!token) throw coded(401, 'auth_missing', 'Inicia sesión para continuar.');
  const v = await verifyToken(token);
  // Solo NOMBRES de claims (nunca valores ni token), 1 vez por request.
  console.log('[auth] claims', JSON.stringify(Object.keys(v.payload).sort()));
  const sub = subOf(v.payload);
  if (!sub) throw invalid('no_sub', v.iss);
  // El kit Cavos 0.3.0 NO renueva el id_token (~1 h) y su modal no permite re-login sin logout (que borra la llave).
  if (v.expired) await renewExpired(req, sub, v.exp);
  return { sub, email: (v.payload as any).email, iss: v.iss, renewed: v.expired };
}

export interface AddressProof { address: string; publicKey: string; signature: string /* base64 */; message: string }
export const proofMessage = (action: string, ref: string, address: string, ts: number) => `meteorito:${action}:${ref}:${address}:${ts}`;

function prefixed(msg: string): Buffer {
  const m = Buffer.from(msg, 'utf8');
  return Buffer.concat([Buffer.from('Cavos Signed Message:\n'), Buffer.from(String(m.length)), Buffer.from('\n'), m]);
}

/** Verifica que quien llama controla `address` (Cavos G… classic multisig: el control key es signer). */
export async function requireAddressProof(p: AddressProof | undefined, action: string, ref: string): Promise<string> {
  if (!p?.address || !p.publicKey || !p.signature || !p.message) throw Object.assign(new HttpError(401, 'falta prueba de dirección'), { code: 'proof_missing' });
  const parts = p.message.split(':');
  const ts = Number(parts[4]);
  if (p.message !== proofMessage(action, ref, p.address, ts)) throw Object.assign(new HttpError(401, 'mensaje de prueba no coincide'), { code: 'proof_mismatch' });
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) throw Object.assign(new HttpError(401, 'prueba vencida'), { code: 'proof_expired' });
  await verifySignedBy(p.address, p.publicKey, p.message, p.signature);
  return p.address;
}

/** Firma ed25519 (prefijo Cavos) de `publicKey`, y `publicKey` = address o signer con peso med de la cuenta. */
async function verifySignedBy(address: string, publicKey: string, message: string, signature: string) {
  const sig = Buffer.from(signature, 'base64');
  let kp: Keypair;
  try { kp = Keypair.fromPublicKey(publicKey); } catch { throw Object.assign(new HttpError(401, 'firma inválida'), { code: 'proof_bad_key' }); }
  // El SDK firma los bytes del mensaje con prefijo Cavos; aceptamos también sin prefijo por si cambia.
  if (!kp.verify(prefixed(message), sig) && !kp.verify(Buffer.from(message), sig)) throw Object.assign(new HttpError(401, 'firma inválida'), { code: 'proof_bad_signature' });
  if (publicKey !== address) {
    const acct = await new Horizon.Server(env.horizon()).loadAccount(address).catch(() => null);
    const s = acct?.signers.find((x) => x.key === publicKey);
    if (!acct || !s || s.weight < acct.thresholds.med_threshold) throw Object.assign(new HttpError(401, 'el control key no es signer de la cuenta'), { code: 'proof_not_signer' });
  }
}
