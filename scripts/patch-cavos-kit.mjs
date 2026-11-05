// Parche mínimo del modal de @cavos/kit 0.3.0 (se aplica en postinstall; falla fuerte si el kit cambió):
//  1) Todo error del modal pasa por globalThis.__meteoritoAuthError (lib/authUx.ts): nunca "kit/auth: ... 401 {...}" crudo.
//  2) Código por correo: el autofill de iOS / pegado entrega el código entero en una casilla; el kit guardaba solo el
//     ÚLTIMO dígito (slice(-1)) -> código equivocado -> invalid_code. Ahora se reparte (globalThis.__meteoritoOtpFill).
//     La 1.ª casilla acepta 6 caracteres para que el autofill no se recorte.
//  3) Copy de la pantalla del código en español: "solo sirve el último código" + "Reenviar código".
// Parche v2 (login sin cuelgues, lib/loginGuard.ts; marca propia para que un node_modules con v1 en caché se actualice):
//  4) Cada paso con red o prompt tiene tope (globalThis.__meteoritoGuard): Google/Apple, pedir/validar código, volver de
//     Google/Apple y passkey. Al vencer: mensaje claro, el botón se libera; nunca un spinner eterno.
//  5) Google/Apple en la PWA de iPhone: si la página sigue aquí (no salió o la persona volvió), se libera el botón.
//  6) Errores de passkey/frase también traducidos (setPkError); cancelar el prompt libera el botón al instante.
//  7) Al abrir el modal se limpia un cierre a medias (exiting) que lo dejaba invisible y "Entrar" no hacía nada.
//  8) El proveedor avisa si su modal está abierto (globalThis.__meteoritoModalChange): el tour no se abre encima.
//  9) navigator.credentials.get/create con AbortSignal (un solo prompt vivo; iOS rechaza uno nuevo si otro quedó colgado).
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PATCH_MARK = '/* meteorito-patch:cavos-kit v1 */';

const RULES = [
  { name: 'errores', re: /const \[error, setError\] = ((?:react\.)?useState)\(""\);/g,
    to: (_m, us) => `const [error, __setErrorRaw] = ${us}(""); const setError = (m) => __setErrorRaw(typeof m === "string" && m && globalThis.__meteoritoAuthError ? globalThis.__meteoritoAuthError(m) : m);` },
  { name: 'autofill', re: /const digit = raw\.replace\(\/\\D\/g, ""\)\.slice\(-1\);/g,
    to: () => `const __fill = globalThis.__meteoritoOtpFill ? globalThis.__meteoritoOtpFill(otpCode, i, raw) : null; if (__fill) { setOtpCode(__fill.code); otpBoxRefs.current[__fill.focus]?.focus(); return; } const digit = raw.replace(/\\D/g, "").slice(-1);` },
  { name: 'maxlength', re: /maxLength: 1,/g, to: () => 'maxLength: i === 0 ? 6 : 1,' },
  { name: 'titulo', re: /"Enter your code"/g, to: () => '"Ingresa tu código"' },
  { name: 'enviado', re: /"We sent a 6-digit code to "/g, to: () => '"Solo sirve el último código que pediste. Lo enviamos a "' },
  { name: 'reenviar-en', re: /`Resend in \$\{resendCountdown\}s`/g, to: () => '`Reenviar en ${resendCountdown} s`' },
  { name: 'reenviar', re: /"Resend code"/g, to: () => '"Reenviar código"' },
  { name: 'otro-correo', re: /"Use a different email"/g, to: () => '"Usar otro correo"' },
];

/** Devuelve el fuente parchado. Idempotente; lanza si falta alguno de los puntos (kit distinto al esperado). */
export function patchKitSource(src) {
  if (src.includes(PATCH_MARK)) return { out: src, applied: [] };
  let out = src; const applied = [];
  for (const r of RULES) {
    if (!r.re.test(out)) throw new Error(`patch-cavos-kit: no encontré "${r.name}" (¿cambió @cavos/kit?)`);
    r.re.lastIndex = 0; out = out.replace(r.re, r.to); applied.push(r.name);
  }
  return { out: `${PATCH_MARK}\n${out}`, applied };
}

export const GUARD_MARK = '/* meteorito-patch:cavos-kit-guard v2 */';
const UI = (us) => (us ?? '').replace(/useState$/, ''); // "react." en el build CJS, "" en ESM
const GUARD_RULES = [
  { name: 'tope-google-apple', re: /await login\(provider\);/g,
    to: () => 'await __mg(login(provider), "oauth"); globalThis.__meteoritoOAuthArm?.((m) => { setBusy(false); setError(m); });' },
  { name: 'tope-pedir-codigo', re: /await sendOtp\(email\);/g, to: () => 'await __mg(sendOtp(email), "otp_send");' },
  { name: 'tope-validar-codigo', re: /const id = await auth\.verifyOtp\(email, code\);/g, to: () => 'const id = await __mg(auth.verifyOtp(email, code), "otp_verify");' },
  { name: 'tope-vuelta-oauth', re: /const id = await auth\.handleCallback\(authData, redirectUri\);/g, to: () => 'const id = await __mg(auth.handleCallback(authData, redirectUri), "oauth_return");' },
  { name: 'tope-passkey-aprobar', re: /await approveDeviceWithPasskey\(\);/g, to: () => 'await __mg(approveDeviceWithPasskey(), "passkey");' },
  { name: 'tope-passkey-crear', re: /await enrollPasskeyDefault\(\);/g, to: () => 'await __mg(enrollPasskeyDefault(), "passkey");' },
  { name: 'errores-passkey', re: /const \[pkError, setPkError\] = ((?:react\.)?useState)\(""\);/g,
    to: (_m, us) => `const [pkError, __setPkRaw] = ${us}(""); const setPkError = (m) => __setPkRaw(typeof m === "string" && m && globalThis.__meteoritoAuthError ? globalThis.__meteoritoAuthError(m) : m);` },
  { name: 'cierre-a-medias', re: /const \[exiting, setExiting\] = ((?:react\.)?useState)\(false\);/g,
    to: (_m, us) => `const [exiting, setExiting] = ${us}(false); ${UI(us)}useEffect(() => { if (open) setExiting(false); }, [open]);` },
  { name: 'modal-abierto', re: /const \[modalOpen, setModalOpen\] = ((?:react\.)?useState)\(false\);/g,
    to: (_m, us) => `const [modalOpen, setModalOpen] = ${us}(false); ${UI(us)}useEffect(() => { globalThis.__meteoritoModalChange?.(modalOpen); }, [modalOpen]);` },
];
const WEBAUTHN_RE = /navigator\.credentials\.(get|create)\(\{/g;
const WEBAUTHN_TO = (_m, fn) => `navigator.credentials.${fn}({ signal: globalThis.__meteoritoWebAuthnSignal?.(),`;
const HELPER = '\nfunction __mg(p, s) { const g = globalThis.__meteoritoGuard; return g ? g(p, s) : p; }\n';

/** v2 sobre react/index(.mjs|.js): topes, PWA iOS, passkey, modal. Idempotente; lanza si falta algún punto. */
export function patchKitGuards(src) {
  if (src.includes(GUARD_MARK)) return { out: src, applied: [] };
  let out = src; const applied = [];
  for (const r of GUARD_RULES) {
    if (!r.re.test(out)) throw new Error(`patch-cavos-kit: no encontré "${r.name}" (¿cambió @cavos/kit?)`);
    r.re.lastIndex = 0; out = out.replace(r.re, r.to); applied.push(r.name);
  }
  if (WEBAUTHN_RE.test(out)) { WEBAUTHN_RE.lastIndex = 0; out = out.replace(WEBAUTHN_RE, WEBAUTHN_TO); applied.push('webauthn-signal'); }
  WEBAUTHN_RE.lastIndex = 0;
  return { out: `${GUARD_MARK}\n${out}${HELPER}`, applied };
}
/** Chunks del kit con WebAuthn (ESM): solo la señal. Idempotente; lanza si el archivo no tiene WebAuthn. */
export function patchWebAuthn(src) {
  if (src.includes(GUARD_MARK)) return { out: src, applied: [] };
  if (!WEBAUTHN_RE.test(src)) { WEBAUTHN_RE.lastIndex = 0; throw new Error('patch-cavos-kit: chunk sin navigator.credentials (¿cambió @cavos/kit?)'); }
  WEBAUTHN_RE.lastIndex = 0;
  const out = src.replace(WEBAUTHN_RE, WEBAUTHN_TO); WEBAUTHN_RE.lastIndex = 0;
  return { out: `${GUARD_MARK}\n${out}`, applied: ['webauthn-signal'] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const base = new URL('../node_modules/@cavos/kit/dist/react/', import.meta.url);
  for (const f of ['index.js', 'index.mjs']) {
    const p = fileURLToPath(new URL(f, base));
    if (!existsSync(p)) { console.log(`[patch-cavos-kit] sin ${f} (¿kit no instalado?), se omite`); continue; }
    const v1 = patchKitSource(readFileSync(p, 'utf8'));
    const v2 = patchKitGuards(v1.out);
    const applied = [...v1.applied, ...v2.applied];
    if (applied.length) { writeFileSync(p, v2.out); console.log(`[patch-cavos-kit] ${f}: ${applied.join(', ')}`); } else console.log(`[patch-cavos-kit] ${f}: ya parchado`);
  }
  // Chunks ESM que llaman a WebAuthn (react/index.mjs los importa): se buscan por contenido, no por nombre (hash).
  const dist = fileURLToPath(new URL('../node_modules/@cavos/kit/dist/', import.meta.url));
  if (existsSync(dist)) {
    let n = 0;
    for (const f of readdirSync(dist)) {
      if (!/^chunk-.*\.mjs$/.test(f)) continue;
      const p = join(dist, f); const src = readFileSync(p, 'utf8');
      if (!src.includes('navigator.credentials.') || src.includes(GUARD_MARK)) { if (src.includes(GUARD_MARK)) n++; continue; }
      writeFileSync(p, patchWebAuthn(src).out); n++; console.log(`[patch-cavos-kit] ${f}: webauthn-signal`);
    }
    if (!n) throw new Error('patch-cavos-kit: ningún chunk con WebAuthn (¿cambió @cavos/kit?)');
  }
}
