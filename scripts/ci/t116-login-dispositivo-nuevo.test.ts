// (116) Dispositivo nuevo con una cuenta que nunca se respaldó (kit 0.5: "no sealed recovery"): mensaje claro y
// accionable, NUNCA la tarjeta "Tu sesión terminó / Entrar de nuevo" (bucle: volver a entrar aquí no lo arregla).
import type { T } from './setup';

export async function run(t: T) {
  process.env.EXPO_PUBLIC_CAVOS_APP_ID = process.env.EXPO_PUBLIC_CAVOS_APP_ID || 'cav_test';
  const S = await import('../../lib/cavosSession');
  const { authErrorText } = await import('../../lib/authUx');
  const { loginErrorCode } = await import('../../lib/loginGuard');
  const sealed = 'kit/secret: this wallet has no sealed recovery. Open it once on the device that created it.';
  const noWrap = 'kit/secret: this device has no local key and no recovery wrap';
  const off = 'kit/secret: recovery by sign-in is turned off for this wallet. Restore it with a passkey or from a device that already has it.';

  t.check('no sealed recovery -> mensaje de dispositivo nuevo', S.friendlyCavosError(sealed) === S.NEW_DEVICE_MESSAGE);
  t.check('sin llave local ni respaldo -> mismo mensaje', S.friendlyCavosError(noWrap) === S.NEW_DEVICE_MESSAGE);
  t.check('enclave not_enrolled crudo -> mismo mensaje', S.friendlyCavosError('enclave recover -> 404 {"error":"not_enrolled"}') === S.NEW_DEVICE_MESSAGE);
  t.check('recuperación apagada -> passkey o dispositivo con la cuenta', S.friendlyCavosError(off) === S.RECOVERY_OFF_MESSAGE);
  t.check('no es la tarjeta "Entrar de nuevo" (sin bucle)', !S.needsRelogin(S.friendlyCavosError(sealed)) && !S.needsRelogin(S.friendlyCavosError(off)));
  t.check('modal del kit (authErrorText) usa el mismo texto', authErrorText(sealed) === S.NEW_DEVICE_MESSAGE && authErrorText(off) === S.RECOVERY_OFF_MESSAGE);
  t.check('userMessage al firmar también', S.userMessage(sealed) === S.NEW_DEVICE_MESSAGE);
  t.check('analítica: código propio (no "other")', loginErrorCode(new Error(sealed)) === 'no_recovery' && loginErrorCode(noWrap) === 'no_recovery' && loginErrorCode(off) === 'recovery_off');
  t.check('lo demás sigue igual', S.friendlyCavosError('registry lookup skipped: no login token') === S.RELOGIN_MESSAGE && S.friendlyCavosError('Failed to fetch') !== S.NEW_DEVICE_MESSAGE);
  t.check('copy sin palabras prohibidas y en tuteo', ![S.NEW_DEVICE_MESSAGE, S.RECOVERY_OFF_MESSAGE].some((m) => /segur|garant|verificad|proteg|empresa|fintech|banco|billetera|100 ?%|\bvos\b|podés|entrá/i.test(m)));
}
