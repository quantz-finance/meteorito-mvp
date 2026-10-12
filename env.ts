// Server-only. Nunca importar desde app/ ni lib/ (cliente).
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}
export type SpMode = 'seller' | 'backend';
export const env = {
  network: () => { const n = process.env.STELLAR_NETWORK ?? 'testnet'; if (n !== 'testnet') throw new Error('solo testnet'); return n; },
  horizon: () => 'https://horizon-testnet.stellar.org',
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
  platformPublic: () => req('PLATFORM_PUBLIC'),            // platform no firma nada operativo
  disputeResolverPublic: () => req('DISPUTE_RESOLVER_PUBLIC'), // resolución manual, secreto fuera de Vercel
  usdcIssuer: () => process.env.USDC_ISSUER ?? 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  crcUsdcRate: () => Number(process.env.CRC_USDC_RATE ?? '510'),
  spMode: (): SpMode => (process.env.SERVICE_PROVIDER_MODE === 'backend' ? 'backend' : 'seller'),
  autoReleaseHours: () => Number(process.env.AUTO_RELEASE_HOURS ?? '24'),
  cronSecret: () => req('CRON_SECRET'),
  pinPepper: () => req('PIN_PEPPER'),
  cavosJwks: () => process.env.CAVOS_JWKS_URL ?? 'https://cavos.xyz/.well-known/jwks.json',
  cavosIssuers: () => (process.env.CAVOS_JWT_ISSUERS ?? 'https://cavos.app/firebase,https://accounts.google.com,https://appleid.apple.com').split(','),
  cavosAudience: () => process.env.CAVOS_JWT_AUDIENCE || undefined, // TODO fijar cuando sepamos el aud real
};
