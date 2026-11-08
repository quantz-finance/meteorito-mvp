// (113) Login sin cuelgues: cada paso de Cavos con tope (promesa colgada -> mensaje + "Reintentar", botón habilitado),
// cancelar passkey/ventana libera al instante, SDK que no baja -> Reintentar, la app nunca se abre sin sesión completa,
// y el tour nunca se dibuja encima del modal de Cavos (cuenta nueva: "Set up a passkey" primero, tour después).
import type { T } from './setup';
import { readFileSync, readdirSync } from 'node:fs';
import {
  LOGIN_TIMEOUTS, LoginTimeoutError, withTimeout, guard, timeoutStep, timeoutMessage, isUserCancel, loginErrorCode,
  welcomeView, busyStep, setLoginTracker, webAuthnSignal, armOAuthReturn, installKitGuard, type LoginStep,
} from '../../lib/loginGuard';
import { authErrorText } from '../../lib/authUx';
import { authStore } from '../../lib/authStore';
import { tourMayStart, authSettled } from '../../lib/tour';
import { patchKitGuards, patchWebAuthn, GUARD_MARK } from '../patch-cavos-kit.mjs';

/** Reloj falso: setTimeout/clearTimeout controlados, avanzar con tick(ms). */
function fakeClock() {
  let now = 0; let seq = 0; const q = new Map<number, { at: number; f: () => void }>();
  return {
    setTimeout: (f: () => void, ms: number) => { const id = ++seq; q.set(id, { at: now + ms, f }); return id; },
    clearTimeout: (id: any) => { q.delete(id); },
    async tick(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = [...q.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        q.delete(next[0]); now = next[1].at; next[1].f(); await new Promise((r) => setImmediate(r));
      }
      now = end; await new Promise((r) => setImmediate(r));
    },
  };
}
const hung = <V = void>() => new Promise<V>(() => {}); // Cavos que nunca responde
const BANNED = /\bseguro|garant[ií]a|verificad|proteg|empresa|fintech|\bbanco|billetera|antiestafa|100\s*%/i;

/** Extrae un handler REAL del modal parchado del kit (const name = async (...) => {...};) para ejecutarlo con dobles. */
function handlerFrom(src: string, name: string): string {
  const i = src.indexOf(`const ${name} = async`);
  if (i < 0) throw new Error(`sin ${name}`);
  let depth = 0; let j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1); } }
  throw new Error('handler sin cerrar');
}

export async function run(t: T) {
  const events: [string, any][] = [];
  setLoginTracker((e, p) => events.push([e, p]));

  // --- withTimeout / guard con promesa colgada
  {
    const c = fakeClock(); let aborted = false; let err: any = null;
    const p = withTimeout(hung(), 'otp_send', { timers: c, onTimeout: () => { aborted = true; } }).catch((e) => { err = e; });
    await c.tick(LOGIN_TIMEOUTS.otp_send - 1);
    t.check('promesa colgada: antes del tope sigue esperando', err === null);
    await c.tick(1); await p;
    t.check('promesa colgada: al tope rechaza con LoginTimeoutError(step)', err instanceof LoginTimeoutError && timeoutStep(err) === 'otp_send' && aborted);
    const c2 = fakeClock(); const ok = await withTimeout(Promise.resolve(7), 'oauth', { timers: c2 });
    t.check('promesa que responde: pasa el valor, sin evento', ok === 7);
  }
  t.check('topes: sesión 8 s, pasos 15–20 s, passkey 60 s', LOGIN_TIMEOUTS.session_restore === 8000 && LOGIN_TIMEOUTS.passkey === 60000
    && (['oauth', 'oauth_return', 'otp_send', 'otp_verify', 'sdk_load'] as LoginStep[]).every((s) => LOGIN_TIMEOUTS[s] >= 15000 && LOGIN_TIMEOUTS[s] <= 20000));
  {
    events.length = 0; const c = fakeClock(); let err: any;
    const sig = webAuthnSignal();
    const p = guard(hung(), 'passkey', c).catch((e) => { err = e; });
    await c.tick(LOGIN_TIMEOUTS.passkey); await p;
    t.check('passkey colgada 60 s: login_timeout {step:passkey} y el prompt se aborta', timeoutStep(err) === 'passkey' && events.some(([e, pp]) => e === 'login_timeout' && pp.step === 'passkey') && !!sig?.aborted);
    events.length = 0;
    await guard(Promise.reject(Object.assign(new Error('The operation either timed out or was not allowed.'), { name: 'NotAllowedError' })), 'passkey', fakeClock()).catch(() => {});
    t.check('passkey cancelada: login_error con código "cancel" (sin mensaje crudo)', events.length === 1 && events[0][0] === 'login_error' && events[0][1].code === 'cancel' && Object.keys(events[0][1]).sort().join() === 'code,step');
  }
  t.check('cancelar prompt/ventana se reconoce', isUserCancel(Object.assign(new Error('x'), { name: 'NotAllowedError' })) && isUserCancel(new Error('popup closed by user')) && !isUserCancel(new Error('500')));
  t.check('códigos de error sin PII', loginErrorCode(new Error('kit/auth: /otp/verify -> 401 {"error":"invalid_code"} ana@x.com')) === 'otp_invalid' && loginErrorCode(new Error('Failed to fetch')) === 'network');

  // --- Mensajes (tuteo, alternativa por correo, sin palabras prohibidas)
  const steps = Object.keys(LOGIN_TIMEOUTS) as LoginStep[];
  // passkey (#166): en vez de reintentar o pasar al correo, se indica tocar «Skip for now» y seguir con la cuenta.
  t.check('cada tope tiene mensaje con "Reintentar"/"Vuelve a intentar" o "Entrar"', steps.filter((s) => s !== 'passkey').every((s) => /Reintentar|Vuelve a intentar|Entrar/.test(timeoutMessage(s))));
  t.check('pasos de login ofrecen el código por correo', steps.filter((s) => s !== 'session_restore' && s !== 'passkey').every((s) => /correo/.test(timeoutMessage(s))));
  t.check('passkey: indica «Skip for now» para seguir con la cuenta', /Skip for now/.test(timeoutMessage('passkey')) && /sigues con tu cuenta/.test(timeoutMessage('passkey')));
  t.check('copy sin palabras prohibidas', steps.every((s) => !BANNED.test(timeoutMessage(s))));
  t.check('modal del kit: "meteorito_timeout:otp_verify" -> mensaje propio (nunca el código técnico)', authErrorText('meteorito_timeout:otp_verify') === timeoutMessage('otp_verify'));

  // --- Pantalla de entrar: botón ocupado -> tope -> sin spinner, habilitado, Reintentar + mensaje
  const busyV = welcomeView({ busy: true, configured: true, relogin: false, stalled: null });
  t.check('cargando: spinner (botón ocupado)', busyV.loading && busyV.message === null);
  const st = busyStep({ busy: true, wantLogin: true, hint: false, isAuthenticated: false, loadFailed: false });
  const v = welcomeView({ busy: true, configured: true, relogin: false, stalled: st });
  t.check('tope vencido: se ve el mensaje, sin spinner y el botón vuelve a estar habilitado ("Reintentar")', st === 'sdk_load' && !v.loading && !v.disabled && v.title === 'Reintentar' && !!v.message);
  t.check('sesión guardada que no reconecta en 8 s -> pantalla de entrar con "Entrar"', busyStep({ busy: true, wantLogin: false, hint: true, isAuthenticated: false, loadFailed: false }) === 'session_restore'
    && welcomeView({ busy: true, configured: true, relogin: false, stalled: 'session_restore' }).title === 'Entrar');
  const welcome = readFileSync('components/Welcome.tsx', 'utf8');
  t.check('Welcome usa el tope por paso y la vista (loading/disabled/title) en el botón', /LOGIN_TIMEOUTS\[step\]/.test(welcome) && /loading=\{view\.loading\}/.test(welcome) && /disabled=\{view\.disabled\}/.test(welcome) && /title=\{view\.title\}/.test(welcome) && /login-stalled/.test(welcome));
  t.check('Welcome emite login_start y Reintentar vuelve a contar el tope', /track\('login_start'/.test(welcome) && /setTries/.test(welcome));

  // --- Handlers REALES del modal parchado con Cavos colgado
  const kit = readFileSync('node_modules/@cavos/kit/dist/react/index.mjs', 'utf8');
  t.check('kit instalado con el parche v2 (topes)', kit.includes(GUARD_MARK));
  installKitGuard((e, p) => events.push([e, p]));
  {
    const c = fakeClock(); const g = globalThis as any; const realGuard = g.__meteoritoGuard;
    g.__meteoritoGuard = (p: Promise<any>, s: LoginStep) => guard(p, s, c);
    const __mg = (p: any, s: any) => g.__meteoritoGuard(p, s);
    const run = (name: string, deps: Record<string, any>) => new Function(...Object.keys(deps), '__mg', `${handlerFrom(kit, name)}; return ${name};`)(...Object.values(deps), __mg);
    // Pedir código por correo: sendOtp nunca responde
    let busy = false as boolean; let error = ''; let screen = 'email';
    const h = run('handleOtpRequestSubmit', { email: 'a@b.c', setError: (m: string) => { error = m; }, setBusy: (b: boolean) => { busy = b; }, sendOtp: () => hung(), setOtpCode: () => {}, setScreen: (s: string) => { screen = s; }, setResendCountdown: () => {} });
    const p = h({ preventDefault() {} });
    await c.tick(1000);
    t.check('código por correo colgado: botón ocupado mientras espera', busy === true);
    await c.tick(LOGIN_TIMEOUTS.otp_send); await p;
    t.check('código por correo colgado: al tope el botón se libera y aparece el error de tope', busy === false && timeoutStep(error) === 'otp_send' && screen === 'email');
    // Validar código colgado
    busy = false; error = '';
    const hv = run('handleOtpVerifySubmit', { email: 'a@b.c', otpCode: 'a1b2c3d4e', EMAIL_CODE_LENGTH: 9, setError: (m: string) => { error = m; }, setBusy: (b: boolean) => { busy = b; }, verifyOtp: () => __mg(hung(), 'otp_verify'), setScreen: () => {}, setDeployState: () => {} });
    const pv = hv({ preventDefault() {} }); await c.tick(LOGIN_TIMEOUTS.otp_verify); await pv;
    t.check('validar código colgado: botón liberado + error de tope', busy === false && timeoutStep(error) === 'otp_verify');
    // Passkey colgada y cancelada
    let pkBusy = false as boolean; let pkError = '';
    const hp = run('handlePasskeyApprove', { setPkBusy: (b: boolean) => { pkBusy = b; }, setPkError: (m: string) => { pkError = m; }, approveDeviceWithPasskey: () => hung() });
    const pp = hp(); await c.tick(LOGIN_TIMEOUTS.passkey - 1); const mid = pkBusy; await c.tick(1); await pp;
    t.check('passkey colgada: ocupada hasta 60 s, luego se libera con error', mid === true && pkBusy === false && timeoutStep(pkError) === 'passkey');
    const hc = run('handlePasskeyApprove', { setPkBusy: (b: boolean) => { pkBusy = b; }, setPkError: (m: string) => { pkError = m; }, approveDeviceWithPasskey: () => Promise.reject(Object.assign(new Error('cancelled'), { name: 'NotAllowedError' })) });
    await hc();
    t.check('passkey cancelada: se libera al instante (sin esperar el tope)', pkBusy === false && !!pkError);
    // Google/Apple: login() asigna location.href y resuelve; la página NO se va (PWA iPhone) -> se libera
    const doc = new EventTarget() as any; doc.visibilityState = 'visible'; const win = new EventTarget() as any;
    g.__meteoritoOAuthArm = (reset: any) => armOAuthReturn(reset, { doc, win, timers: c });
    busy = false; error = '';
    const ho = run('handleOAuth', { setError: (m: string) => { error = m; }, setBusy: (b: boolean) => { busy = b; }, login: () => Promise.resolve() });
    await ho('google'); const stuck: boolean = busy as boolean;
    doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange'));
    doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange'));
    t.check('Google en PWA iPhone: vuelves sin terminar -> botón liberado + mensaje', stuck === true && (busy as boolean) === false && timeoutStep(error) === 'oauth_redirect');
    busy = false; error = '';
    const ho2 = run('handleOAuth', { setError: (m: string) => { error = m; }, setBusy: (b: boolean) => { busy = b; }, login: () => Promise.resolve() });
    await ho2('apple'); await c.tick(LOGIN_TIMEOUTS.oauth_redirect);
    t.check('Apple: la página no salió en 20 s -> botón liberado + mensaje', busy === false && timeoutStep(error) === 'oauth_redirect');
    busy = false; error = '';
    const ho3 = run('handleOAuth', { setError: (m: string) => { error = m; }, setBusy: (b: boolean) => { busy = b; }, login: () => hung() });
    const p3 = ho3('google'); await c.tick(LOGIN_TIMEOUTS.oauth); await p3;
    t.check('Google: pedir el link colgado -> tope, botón liberado', busy === false && timeoutStep(error) === 'oauth');
    g.__meteoritoGuard = realGuard;
  }
  t.check('kit: modal se resetea al abrir (cierre a medias) y avisa si está abierto', /if \(open\) setExiting\(false\)/.test(kit) && /__meteoritoModalChange\?\.\(modalOpen\)/.test(kit));
  t.check('kit: vuelta de Google/Apple con tope', /__mg\(auth\.handleCallback\(authData, redirectUri\), "oauth_return"\)/.test(kit));
  // Chunk WebAuthn: el hash del nombre cambia entre versiones del kit; se busca por contenido (igual que el postinstall).
  const webAuthnChunk = readdirSync('node_modules/@cavos/kit/dist').find((f) => /^chunk-.*\.mjs$/.test(f) && readFileSync(`node_modules/@cavos/kit/dist/${f}`, 'utf8').includes('navigator.credentials.'));
  t.check('kit: hay chunk con WebAuthn', !!webAuthnChunk, String(webAuthnChunk));
  const chunks = readFileSync(`node_modules/@cavos/kit/dist/${webAuthnChunk}`, 'utf8');
  t.check('kit: WebAuthn con AbortSignal (un solo prompt vivo)', /navigator\.credentials\.get\(\{ signal: globalThis\.__meteoritoWebAuthnSignal/.test(chunks));
  const sample = 'const [pkError, setPkError] = useState("");const [exiting, setExiting] = useState(false);const [modalOpen, setModalOpen] = useState(false);await login(provider);await sendOtp(email);const id = await auth.verifyOtp(email, code);const id = await auth.handleCallback(authData, redirectUri);await approveDeviceWithPasskey();await enrollPasskeyDefault(); navigator.credentials.get({ a: 1 })';
  const pg = patchKitGuards(sample);
  t.check('parche v2 idempotente', patchKitGuards(pg.out).out === pg.out && (pg.applied as string[]).includes('webauthn-signal'));
  let threw = false; try { patchKitGuards('nada'); } catch { threw = true; }
  let threw2 = false; try { patchWebAuthn('nada'); } catch { threw2 = true; }
  t.check('parche v2 falla fuerte si el kit cambió', threw && threw2);

  // --- SDK que no baja: Reintentar = intento nuevo (nunca spinner ni pantalla de error)
  authStore.setLoadFailed();
  t.check('SDK no cargó: estado loadFailed, sin login pendiente', authStore.get().loadFailed && !authStore.get().wantLogin);
  const a0 = authStore.get().attempt; authStore.requestLogin();
  t.check('SDK no cargó: tocar Entrar/Reintentar vuelve a bajarlo (attempt+1) y abre el login al cargar', authStore.get().attempt === a0 + 1 && !authStore.get().loadFailed && authStore.get().wantLogin);
  const web = readFileSync('lib/cavos.web.tsx', 'utf8');
  t.check('chunk del SDK con catch (no cae en ErrorBoundary) y lazy por intento', /importer\(\)\.catch/.test(web) && /setLoadFailed\(\)/.test(web) && /\[attempt\]/.test(web));

  // --- Nunca adentro sin sesión completa
  const layout = readFileSync('app/_layout.tsx', 'utf8');
  t.check('Gate: sin sesión Cavos completa (cuenta + dirección) -> pantalla de entrar', /if \(!isPublic && \(!auth\.isAuthenticated \|\| !auth\.address\)\) return <Welcome \/>/.test(layout));
  t.check('splash de sesión guardada con tope de 8 s', /LOGIN_TIMEOUTS\.session_restore/.test(layout));
  const bridge = readFileSync('lib/cavosBridge.tsx', 'utf8');
  t.check('el puente no inventa sesión: isAuthenticated/address solo de Cavos', /isAuthenticated: c\.isAuthenticated,/.test(bridge) && /address: c\.address,/.test(bridge));
  t.check('eventos login_success / login_timeout / login_error en el puente', /track\('login_success'/.test(bridge) && /trackLoginTimeout\('session_restore'\)/.test(bridge) && /trackLoginError\(/.test(bridge));

  // --- Orden: modal de Cavos (passkey / frase de respaldo) primero, tour después
  const base = { route: true, allowed: true, open: false };
  const newAccount = authSettled({ isLoading: false, isAuthenticated: true, address: 'GABC' });
  t.check('tour NO arranca con el modal de Cavos abierto (cuenta nueva: "Set up a passkey")', newAccount && !tourMayStart({ ...base, settled: newAccount, cavosModal: true }));
  t.check('tour NO arranca mientras el login carga o la sesión está a medias (sin dirección)', !authSettled({ isLoading: true, isAuthenticated: false, address: null }) && !authSettled({ isLoading: false, isAuthenticated: true, address: null }));
  t.check('tour arranca al cerrar el modal con la sesión completa', tourMayStart({ ...base, settled: newAccount, cavosModal: false }));
  t.check('comprador invitado en Comprar (sin login) sigue viendo el tour', tourMayStart({ ...base, settled: authSettled({ isLoading: false, isAuthenticated: false, address: null }), cavosModal: false }));
  authStore.setCavosModal(true);
  const g = globalThis as any; installKitGuard();
  t.check('aviso del kit -> authStore.cavosModal', authStore.get().cavosModal === true);
  authStore.setCavosModal(false);
  const tour = readFileSync('components/Tour.tsx', 'utf8');
  t.check('TourAuto espera a tourMayStart (cavosModal + authed) y TourHost se oculta con el modal de Cavos', /tourMayStart\(\{[^}]*cavosModal/.test(tour) && /\[auto, settled, cavosModal\]/.test(tour) && /if \(!tour\.open \|\| cavosModal\) return null;/.test(tour) && /cavosModalInDom\(\)/.test(tour));
  t.check('puente registra el aviso del modal', /__meteoritoModalChange = \(open: boolean\) => authStore\.setCavosModal/.test(bridge) && typeof g.__meteoritoGuard === 'function');
}
