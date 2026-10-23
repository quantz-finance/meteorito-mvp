// Parche mínimo del modal de @cavos/kit 0.3.0 (se aplica en postinstall; falla fuerte si el kit cambió):
//  1) Todo error del modal pasa por globalThis.__meteoritoAuthError (lib/authUx.ts): nunca "kit/auth: ... 401 {...}" crudo.
//  2) Código por correo: el autofill de iOS / pegado entrega el código entero en una casilla; el kit guardaba solo el
//     ÚLTIMO dígito (slice(-1)) -> código equivocado -> invalid_code. Ahora se reparte (globalThis.__meteoritoOtpFill).
//     La 1.ª casilla acepta 6 caracteres para que el autofill no se recorte.
//  3) Copy de la pantalla del código en español: "solo sirve el último código" + "Reenviar código".
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const base = new URL('../node_modules/@cavos/kit/dist/react/', import.meta.url);
  for (const f of ['index.js', 'index.mjs']) {
    const p = fileURLToPath(new URL(f, base));
    if (!existsSync(p)) { console.log(`[patch-cavos-kit] sin ${f} (¿kit no instalado?), se omite`); continue; }
    const { out, applied } = patchKitSource(readFileSync(p, 'utf8'));
    if (applied.length) { writeFileSync(p, out); console.log(`[patch-cavos-kit] ${f}: ${applied.join(', ')}`); } else console.log(`[patch-cavos-kit] ${f}: ya parchado`);
  }
}
