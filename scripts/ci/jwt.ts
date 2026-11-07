// Tokens de prueba firmados con un JWKS local (nunca se llama a Cavos).
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { __setJwksForTests } from '../../api/_lib/auth';

export const ISS = 'https://cavos.app/firebase';
export const AUD = 'cav_ci_test_app';
let keys: { priv: any; other: any; ec: any } | null = null;

export async function installTestJwks() {
  const a = await generateKeyPair('RS256'); const b = await generateKeyPair('RS256');
  const ec = await generateKeyPair('ES256');
  const ecJwk = { ...(await exportJWK(ec.publicKey)), kid: 'ci-email', alg: 'ES256', use: 'sig' };
  const jwk = { ...(await exportJWK(a.publicKey)), kid: 'ci', alg: 'RS256', use: 'sig' };
  __setJwksForTests(createLocalJWKSet({ keys: [jwk, ecJwk] }));
  keys = { priv: a.privateKey, other: b.privateKey, ec: ec.privateKey };
}
export async function token(o: { sub: string; aud?: string; iss?: string; exp?: number; badKey?: boolean; email?: string; emailVerified?: boolean; alg?: 'RS256' | 'ES256' }) {
  if (!keys) throw new Error('installTestJwks() primero');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: o.email ?? `${o.sub}@ci.test`, ...(o.emailVerified === undefined ? {} : { email_verified: o.emailVerified }) }).setProtectedHeader({ alg: o.alg ?? 'RS256', kid: o.alg === 'ES256' ? 'ci-email' : 'ci' })
    .setSubject(o.sub).setIssuer(o.iss ?? ISS).setAudience(o.aud ?? AUD).setIssuedAt(now - 10).setExpirationTime(o.exp ?? now + 600)
    .sign(o.badKey ? keys.other : o.alg === 'ES256' ? keys.ec : keys.priv);
}
export const req = (tok: string | null, body: unknown = {}, method = 'POST') => ({ method, headers: tok ? { authorization: `Bearer ${tok}` } : {}, body, query: {} });
export function res() {
  const r: any = { code: 0, body: null as any };
  r.status = (c: number) => { r.code = c; return r; }; r.setHeader = () => r; r.send = (b: string) => { r.body = JSON.parse(b); return r; };
  return r;
}
