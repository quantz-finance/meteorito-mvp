// (7) JWT: aud incorrecto -> 401; iss/expirado/firma mala -> 401 incluso con LOG_ONLY; prod sin aud -> 503.
import type { T } from './setup';
import { AUD, installTestJwks, token } from './jwt';
import { requireCavosUser } from '../../api/_lib/auth';

export async function run(t: T) {
  await installTestJwks();
  const call = async (tok: string) => { try { await requireCavosUser({ headers: { authorization: `Bearer ${tok}` } }); return 200; } catch (e: any) { return e.status ?? 500; } };
  const set = (aud: string, logOnly: boolean) => { process.env.CAVOS_JWT_AUDIENCE = aud; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = logOnly ? '1' : ''; };
  const now = Math.floor(Date.now() / 1000);

  set(AUD, false);
  t.check('token válido (aud correcto) -> aceptado', (await call(await token({ sub: 'u1' }))) === 200);
  t.check('aud incorrecto -> 401', (await call(await token({ sub: 'u1', aud: 'otra-app' }))) === 401);
  t.check('iss no permitido -> 401', (await call(await token({ sub: 'u1', iss: 'https://evil.example' }))) === 401);
  t.check('expirado -> 401', (await call(await token({ sub: 'u1', exp: now - 120 }))) === 401);
  t.check('firma inválida -> 401', (await call(await token({ sub: 'u1', badKey: true }))) === 401);
  t.check('sin token -> 401', await (async () => { try { await requireCavosUser({ headers: {} }); return false; } catch (e: any) { return e.status === 401; } })());

  set(AUD, true); // LOG_ONLY: solo el aud deja de rechazar; todo lo demás sigue estricto
  t.check('LOG_ONLY: aud incorrecto se registra pero pasa (comportamiento esperado)', (await call(await token({ sub: 'u1', aud: 'otra-app' }))) === 200);
  t.check('LOG_ONLY: iss no permitido -> 401', (await call(await token({ sub: 'u1', iss: 'https://evil.example' }))) === 401);
  t.check('LOG_ONLY: expirado -> 401', (await call(await token({ sub: 'u1', exp: now - 120 }))) === 401);
  t.check('LOG_ONLY: firma inválida -> 401', (await call(await token({ sub: 'u1', badKey: true }))) === 401);

  // Token real de Cavos: aud compartido 'cavos-starknet'.
  set('cavos-starknet', false);
  t.check('aud=cavos-starknet aceptado con CAVOS_JWT_AUDIENCE=cavos-starknet (sin LOG_ONLY)', (await call(await token({ sub: 'u1', aud: 'cavos-starknet' }))) === 200);
  t.check('aud distinto con CAVOS_JWT_AUDIENCE=cavos-starknet -> 401', (await call(await token({ sub: 'u1', aud: 'cavos-otra' }))) === 401);
  // Log de claims: solo nombres, nunca valores.
  const logs: string[] = []; const orig = console.log; console.log = (...a: any[]) => { logs.push(a.join(' ')); };
  try { await call(await token({ sub: 'secret-sub-xyz', aud: 'cavos-starknet' })); } finally { console.log = orig; }
  const cl = logs.filter((l) => l.startsWith('[auth] claims'));
  t.check("'[auth] claims' 1 vez, solo nombres ordenados, sin valores", cl.length === 1 && cl[0] === '[auth] claims ["aud","email","exp","iat","iss","sub"]' && !logs.join().includes('secret-sub-xyz'), cl.join('|'));

  set('', false); // producción sin audiencia configurada
  t.check('producción sin CAVOS_JWT_AUDIENCE -> 503 (fail closed)', (await call(await token({ sub: 'u1' }))) === 503);
  set(AUD, false);
}
