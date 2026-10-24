// Tokens de prueba firmados con un JWKS local (nunca se llama a Cavos).
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { __setJwksForTests } from '../../api/_lib/auth';

export const ISS = 'https://cavos.app/firebase';
export const AUD = 'cav_ci_test_app';
let keys: { priv: any; other: any } | null = null;

export async function installTestJwks() {
  const a = await generateKeyPair('RS256'); const b = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(a.publicKey)), kid: 'ci', alg: 'RS256', use: 'sig' };
  __setJwksForTests(createLocalJWKSet({ keys: [jwk] }));
  keys = { priv: a.privateKey, other: b.privateKey };
}
export async function token(o: { sub: string; aud?: string; iss?: string; exp?: number; badKey?: boolean; email?: string; emailVerified?: boolean }) {
  if (!keys) throw new Error('installTestJwks() primero');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: o.email ?? `${o.sub}@ci.test`, ...(o.emailVerified === undefined ? {} : { email_verified: o.emailVerified }) }).setProtectedHeader({ alg: 'RS256', kid: 'ci' })
    .setSubject(o.sub).setIssuer(o.iss ?? ISS).setAudience(o.aud ?? AUD).setIssuedAt(now - 10).setExpirationTime(o.exp ?? now + 600)
    .sign(o.badKey ? keys.other : keys.priv);
}
export const req = (tok: string | null, body: unknown = {}, method = 'POST') => ({ method, headers: tok ? { authorization: `Bearer ${tok}` } : {}, body, query: {} });
export function res() {
  const r: any = { code: 0, body: null as any };
  r.status = (c: number) => { r.code = c; return r; }; r.setHeader = () => r; r.send = (b: string) => { r.body = JSON.parse(b); return r; };
  return r;
}
