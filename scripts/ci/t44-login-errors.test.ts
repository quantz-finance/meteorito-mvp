// (44) Login: Google/Apple con cuenta existente (aud OAuth compartido de Cavos) + código por correo (errores, autofill) + sesión inválida mostrada una vez.
import type { T } from './setup';
import { readFileSync } from 'node:fs';
import { AUD, installTestJwks, token } from './jwt';
import { requireCavosUser } from '../../api/_lib/auth';
import { apiErrorProps } from '../../api/_lib/analytics';
import { __setDbForTests } from '../../api/_lib/db';
import { fakeDb } from './fakedb';
import { authErrorText, otpFill, isSessionError, sellerPushVisible, OTP_INVALID, OTP_STALE, OTP_RATE } from '../../lib/authUx';
import { patchKitSource, PATCH_MARK } from '../patch-cavos-kit.mjs';

const GOOGLE_AUD = '1074035053584-s7i7gv8mbki1gnlgnnhibt6lfknqm3nb.apps.googleusercontent.com';
const APPLE_AUD = 'com.cavosx.auth';

export async function run(t: T) {
  await installTestJwks();
  const db = fakeDb(); db.tables.user_wallets = []; __setDbForTests(db as any);
  process.env.CAVOS_JWT_AUDIENCE = AUD; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = ''; delete process.env.CAVOS_JWT_ISSUERS;
  const codeOf = async (tok: string) => { try { await requireCavosUser({ headers: { authorization: `Bearer ${tok}` } }); return 'ok'; } catch (e: any) { return `${e.status}:${e.code}:${e.reason ?? ''}`; } };

  // --- Bug 2: Google en un dispositivo nuevo -> "No pudimos verificar tu sesión" (srv_api_error activate auth_invalid, step nonce)
  t.check('Google (iss https://accounts.google.com, aud = cliente OAuth de Cavos) -> aceptado', (await codeOf(await token({ sub: '104857600000000000001', iss: 'https://accounts.google.com', aud: GOOGLE_AUD }))) === 'ok');
  t.check('Google (iss accounts.google.com sin https) -> aceptado', (await codeOf(await token({ sub: '104857600000000000001', iss: 'accounts.google.com', aud: GOOGLE_AUD }))) === 'ok');
  t.check('Apple (aud = service id de Cavos) -> aceptado', (await codeOf(await token({ sub: '001234.abc.0001', iss: 'https://appleid.apple.com', aud: APPLE_AUD }))) === 'ok');
  t.check('Google con aud de OTRA app -> 401 auth_invalid, reason aud', (await codeOf(await token({ sub: 'g1', iss: 'https://accounts.google.com', aud: 'otra.apps.googleusercontent.com' }))) === '401:auth_invalid:aud');
  t.check('token Cavos/Firebase con aud de Google (cruce de issuer) -> 401', (await codeOf(await token({ sub: 'u1', aud: GOOGLE_AUD }))).startsWith('401:auth_invalid'));
  t.check('issuer desconocido -> reason issuer', (await codeOf(await token({ sub: 'u1', iss: 'https://evil.example' }))) === '401:auth_invalid:issuer');
  t.check('firma inválida -> reason signature', (await codeOf(await token({ sub: 'u1', badKey: true }))) === '401:auth_invalid:signature');
  t.check('token Cavos normal sigue aceptado', (await codeOf(await token({ sub: 'u1' }))) === 'ok');
  const props = apiErrorProps(Object.assign(new Error('x'), { status: 401, code: 'auth_invalid', reason: 'aud', issHost: 'accounts.google.com' }));
  t.check('srv_api_error lleva reason + iss (host), sin token ni sub', props.reason === 'aud' && props.iss === 'accounts.google.com' && !('sub' in props));
  t.check('reason/iss raros no se envían', !('reason' in apiErrorProps({ code: 'auth_invalid', reason: 'x y <z>' })) && !('iss' in apiErrorProps({ code: 'auth_invalid', issHost: 'a b' })));

  // --- Bug 1: código por correo
  const raw = 'kit/auth: /api/oauth/firebase/otp/verify -> 401 {"error":"invalid_code"}';
  t.check('invalid_code -> mensaje amable (tuteo), sin texto técnico', authErrorText(raw) === OTP_INVALID && !/kit\/auth|401|invalid_code/.test(OTP_INVALID));
  t.check('mensaje dice que pida uno nuevo y que solo sirve el último', /Pide uno nuevo/.test(OTP_INVALID) && /último/.test(OTP_INVALID));
  t.check('invalid_nonce (la app se recargó o pediste otro) -> pide uno nuevo', authErrorText('kit/auth: /api/oauth/firebase/otp/verify -> 401 {"error":"invalid_nonce"}') === OTP_STALE);
  t.check('código vencido -> mismo mensaje', authErrorText('kit/auth: /api/oauth/firebase/otp/verify -> 401 {"error":"code_expired"}') === OTP_INVALID);
  t.check('429 al pedir código -> espera', authErrorText('kit/auth: /api/oauth/firebase/otp/request -> 429 {"error":"too_many_requests"}') === OTP_RATE);
  t.check('cualquier kit/auth crudo -> nunca se muestra crudo', !/kit\/auth/.test(authErrorText('kit/auth: /api/oauth/firebase/otp/request -> 500 {"error":"boom"}')));
  t.check('mensaje propio en español pasa igual', authErrorText('Tu sesión venció. Vuelve a iniciar sesión.') === 'Tu sesión venció. Vuelve a iniciar sesión.');
  t.check('sin palabras prohibidas', ![OTP_INVALID, OTP_STALE, OTP_RATE].some((m) => /seguro|protegido|garant|pronto|regulado/i.test(m)));
  t.check('autofill iOS (código completo en la 1.ª casilla) -> se reparte, conserva ceros', JSON.stringify(otpFill('', 0, '012345')) === JSON.stringify({ code: '012345', focus: 5 }));
  t.check('pegar con espacios/guion -> solo dígitos', otpFill('', 0, ' 01 2-345 ')?.code === '012345');
  t.check('una tecla (o reemplazo de 2) -> comportamiento normal del kit', otpFill('1', 1, '2') === null && otpFill('12', 1, '23') === null);
  t.check('autofill desde la casilla 2 -> desde ahí', otpFill('9', 1, '12345')?.code === '912345');

  const kit = readFileSync('node_modules/@cavos/kit/dist/react/index.mjs', 'utf8');
  t.check('kit instalado parchado (postinstall)', kit.includes(PATCH_MARK));
  const fresh = kit.includes(PATCH_MARK) ? null : kit;
  const sample = 'const [error, setError] = useState("");\n    const digit = raw.replace(/\\D/g, "").slice(-1);\n maxLength: 1,\n children: "Enter your code" "We sent a 6-digit code to " `Resend in ${resendCountdown}s` "Resend code" "Use a different email"';
  const p = patchKitSource(fresh ?? sample);
  t.check('parche: errores traducidos + autofill + 1.ª casilla acepta 6 + copy en español', p.out.includes('__meteoritoAuthError') && p.out.includes('__meteoritoOtpFill') && p.out.includes('maxLength: i === 0 ? 6 : 1') && p.out.includes('Reenviar código') && p.out.includes('último código'));
  t.check('parche idempotente', patchKitSource(p.out).out === p.out);
  let threw = false; try { patchKitSource('nada que parchar'); } catch { threw = true; }
  t.check('parche falla fuerte si el kit cambió', threw);
  const bridge = readFileSync('lib/cavosBridge.tsx', 'utf8');
  t.check('puente registra traductor y autofill', /__meteoritoAuthError\s*=/.test(bridge) && /__meteoritoOtpFill\s*=/.test(bridge));
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  t.check('postinstall aplica el parche', /patch-cavos-kit/.test(pkg.scripts?.postinstall ?? ''));

  // --- Sesión inválida: una sola vez, sin la tarjeta de notificaciones
  const authInvalid = Object.assign(new Error('No pudimos verificar tu sesión. Vuelve a cargar la página.'), { status: 401, code: 'auth_invalid' });
  t.check('auth_invalid / session_* son errores de sesión', isSessionError(authInvalid) && isSessionError({ code: 'session_relogin_required' }) && !isSessionError({ code: 'http_500' }));
  t.check('tarjeta push oculta con error de sesión o sin token', !sellerPushVisible({ authed: true, hasToken: true, sessionError: true }) && !sellerPushVisible({ authed: true, hasToken: false, sessionError: false }) && !sellerPushVisible({ authed: false, hasToken: true, sessionError: false }) && sellerPushVisible({ authed: true, hasToken: true, sessionError: false }));
  const ped = readFileSync('app/(tabs)/pedidos.tsx', 'utf8'); const card = readFileSync('components/PushCard.tsx', 'utf8');
  t.check('pedidos oculta PushCard con error de sesión y le pasa onSessionError', /sessionError/.test(ped) && /onSessionError=/.test(ped));
  t.check('PushCard no repite el error de sesión (lo sube a la pantalla)', /isSessionError\(/.test(card) && /onSessionError/.test(card) && /sellerPushVisible\(/.test(card));
}
