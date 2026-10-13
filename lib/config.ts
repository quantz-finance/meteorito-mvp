export const CAVOS_APP_ID = process.env.EXPO_PUBLIC_CAVOS_APP_ID ?? '';
export const CAVOS_RP_ID = process.env.EXPO_PUBLIC_CAVOS_RP_ID ?? 'meteorito-mvp.vercel.app';
export const APP_SALT = 'meteorito-mvp';
export const NATIVE_REDIRECT_URI = 'meteorito://cavos-auth';
export const HORIZON_TESTNET = 'https://horizon-testnet.stellar.org';
export const USDC_TESTNET_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
/** Recuperación social de Cavos (enclave). Off hasta habilitarla en el dashboard de Cavos para este appId/entorno. */
export function cavosRecoveryConfig(v: string | undefined) {
  const social = /^(1|true)$/i.test(v ?? '');
  /** Passkey: extra opcional si hay recuperación social; si no, es el único respaldo -> se pide al crear la cuenta. */
  return { social, secureStep: (social ? 'optional' : 'required') as 'optional' | 'required' };
}
// Expo inlinea EXPO_PUBLIC_* solo con acceso estático process.env.X.
const RECOVERY = cavosRecoveryConfig(process.env.EXPO_PUBLIC_CAVOS_SOCIAL_RECOVERY);
export const CAVOS_SOCIAL_RECOVERY = RECOVERY.social;
export const CAVOS_SECURE_STEP = RECOVERY.secureStep;
