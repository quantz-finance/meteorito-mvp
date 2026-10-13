// Server-only. Nunca importar desde app/ ni lib/ (cliente).
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}
const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
export type SpMode = 'seller' | 'backend';
export const env = {
  network: () => { const n = process.env.STELLAR_NETWORK ?? 'testnet'; if (n !== 'testnet') throw new Error('solo testnet'); return n; },
  horizon: () => 'https://horizon-testnet.stellar.org',
  sorobanRpc: () => process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  twBase: () => process.env.TW_API_BASE ?? 'https://dev.api.trustlesswork.com',
  twKey: () => req('TW_API_KEY'),
  twFee: () => Number(process.env.TW_PROTOCOL_FEE ?? '0.003'),   // TW cobra 0.3% aun con platformFee 0 (smoke test)
  supabaseUrl: () => req('SUPABASE_URL'),
  supabaseService: () => req('SUPABASE_SERVICE_ROLE_KEY'),
  // Wallets backend: una por rol, solo secretos que firman algo.
  deployerSecret: () => req('DEPLOYER_SECRET'),            // firma SOLO el deploy
  treasurySecret: () => req('TREASURY_SECRET'),            // ramp-provider.mock: fondea
  approverSecret: () => req('APPROVER_SECRET'),            // aprueba hito (Recibí / PIN / 24h)
  releaseSignerSecret: () => req('RELEASE_SIGNER_SECRET'), // libera
  serviceSecret: () => req('SERVICE_SECRET'),              // solo si SERVICE_PROVIDER_MODE=backend
  platformPublic: () => req('PLATFORM_PUBLIC'),            // rol platform del escrow
  platformSecret: () => req('PLATFORM_SECRET'),            // SOLO para pagar fee-bumps (api/_lib/feebump.ts)
  disputeResolverPublic: () => req('DISPUTE_RESOLVER_PUBLIC'), // resolución manual, secreto fuera de Vercel
  usdcIssuer: () => process.env.USDC_ISSUER ?? 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  crcUsdcRate: () => Number(process.env.CRC_USDC_RATE ?? '510'),
  spMode: (): SpMode => (process.env.SERVICE_PROVIDER_MODE === 'backend' ? 'backend' : 'seller'),
  /** Ventana de liberación automática tras el envío, en minutos. AUTO_RELEASE_MINUTES (default 1440 = 24 h).
   *  Compat: AUTO_RELEASE_HOURS si no hay MINUTES. Valor inválido -> default. Rango 1..43200 (30 días). */
  autoReleaseMinutes: (): number => {
    const m = process.env.AUTO_RELEASE_MINUTES, h = process.env.AUTO_RELEASE_HOURS;
    const v = m != null && m !== '' ? Number(m) : h != null && h !== '' ? Number(h) * 60 : 1440;
    return Number.isFinite(v) && v >= 1 && v <= 43200 ? Math.round(v) : 1440;
  },
  cronSecret: () => req('CRON_SECRET'),
  pinPepper: () => req('PIN_PEPPER'),
  cavosJwks: () => process.env.CAVOS_JWKS_URL ?? 'https://cavos.xyz/.well-known/jwks.json',
  cavosIssuers: () => list(process.env.CAVOS_JWT_ISSUERS ?? 'https://cavos.app/firebase,https://accounts.google.com,https://appleid.apple.com'),
  /** aud aceptados (coma-separados; el token debe traer al menos uno). Vacío = sin configurar. */
  cavosAudiences: () => list(process.env.CAVOS_JWT_AUDIENCE ?? ''),
  /** Solo para descubrir el aud real: verifica firma/iss/exp, registra el aud y NO rechaza por aud. */
  cavosAudienceLogOnly: () => process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY === '1',
  isProduction: () => process.env.VERCEL_ENV === 'production' || (!process.env.VERCEL_ENV && process.env.NODE_ENV === 'production'),
};

/** Fecha de liberación automática a partir de ahora (ISO). Única fuente del cálculo. */
export const autoReleaseAt = (from = Date.now()) => new Date(from + env.autoReleaseMinutes() * 60_000).toISOString();
