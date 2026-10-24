import { EXTENSION_PENDING_MS, MIN_PROTECTION_MIN, extendedOf, isFaceToFace, pendingExtension, protectionOf } from './agreement';
// Server-only. Nunca importar desde app/ ni lib/ (cliente).
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}
const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
export const DEFAULT_AUTO_RELEASE_MINUTES = 10080; // 7 días
export const MIN_PROD_AUTO_RELEASE_MINUTES = 1440; // 24 h
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
  /** Ventana de liberación automática tras "Ya lo envié", en minutos. AUTO_RELEASE_MINUTES (default 10080 = 7 días).
   *  Compat: AUTO_RELEASE_HOURS si no hay MINUTES. Valor inválido -> default. Rango 1..43200 (30 días).
   *  Producción: un valor < 1440 (p. ej. un env viejo de 10 min) se ignora y se usa el default; demo/CI/preview pueden usar plazos cortos. */
  autoReleaseMinutes: (): number => {
    const m = process.env.AUTO_RELEASE_MINUTES, h = process.env.AUTO_RELEASE_HOURS;
    const v = m != null && m !== '' ? Number(m) : h != null && h !== '' ? Number(h) * 60 : DEFAULT_AUTO_RELEASE_MINUTES;
    const ok = Number.isFinite(v) && v >= 1 && v <= 43200 ? Math.round(v) : DEFAULT_AUTO_RELEASE_MINUTES;
    return env.isProduction() && ok < MIN_PROD_AUTO_RELEASE_MINUTES ? DEFAULT_AUTO_RELEASE_MINUTES : ok;
  },
  cronSecret: () => req('CRON_SECRET'),
  pinPepper: () => req('PIN_PEPPER'),
  cavosJwks: () => process.env.CAVOS_JWKS_URL ?? 'https://cavos.xyz/.well-known/jwks.json',
  cavosIssuers: () => list(process.env.CAVOS_JWT_ISSUERS ?? 'https://cavos.app/firebase,https://accounts.google.com,https://appleid.apple.com'),
  /** Login con Google/Apple del modal de Cavos: el id_token trae el aud del cliente OAuth de CAVOS (compartido, público:
   *  sale en la URL de /api/oauth/v2/google|apple), no el app id. Solo se aceptan con su propio issuer. */
  googleAudiences: () => list(process.env.CAVOS_GOOGLE_AUDIENCE ?? '1074035053584-s7i7gv8mbki1gnlgnnhibt6lfknqm3nb.apps.googleusercontent.com'),
  appleAudiences: () => list(process.env.CAVOS_APPLE_AUDIENCE ?? 'com.cavosx.auth'),
  /** aud aceptados (coma-separados; el token debe traer al menos uno). Vacío = sin configurar. */
  cavosAudiences: () => list(process.env.CAVOS_JWT_AUDIENCE ?? ''),
  /** Solo para descubrir el aud real: verifica firma/iss/exp, registra el aud y NO rechaza por aud. */
  cavosAudienceLogOnly: () => process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY === '1',
  isProduction: () => process.env.VERCEL_ENV === 'production' || (!process.env.VERCEL_ENV && process.env.NODE_ENV === 'production'),
};

/** Fecha de liberación automática a partir de ahora (ISO). Única fuente del cálculo. */
export const autoReleaseAt = (from = Date.now()) => new Date(from + env.autoReleaseMinutes() * 60_000).toISOString();

/** Cuándo vence de verdad la liberación automática de un pedido 'enviado': nunca antes de auto_release_at NI antes de
 *  shipped_at + la ventana vigente. Así los pedidos enviados con un plazo viejo (10 min) esperan los 7 días. */
type ReleaseOrder = { shipped_at?: string | null; funded_at?: string | null; created_at?: string | null; auto_release_at?: string | null;
  delivery_mode?: string | null; protection_minutes?: number | null; release_ext_minutes?: number | null; release_ext?: any };
/** Plazo acordado del pedido + extensiones aceptadas (min). Sin la migración 017: envío con la ventana global (7 días). */
export function windowMinutes(o: ReleaseOrder): number {
  const agreed = Number.isInteger(Number(o.protection_minutes)) && o.protection_minutes != null && Number(o.protection_minutes) >= MIN_PROTECTION_MIN;
  const base = agreed || isFaceToFace(o) ? protectionOf(o) : env.autoReleaseMinutes();
  return base + extendedOf(o); // protectionOf ya es ≥ 24 h; la ventana global tiene su piso en producción
}
/** Cara a cara cuenta desde el pago; envío desde "Ya lo envié". Nunca antes que auto_release_at ya guardado. */
export function releaseDueAt(o: ReleaseOrder): string {
  const start = isFaceToFace(o) ? (o.funded_at ?? o.created_at) : (o.shipped_at ?? o.funded_at ?? o.created_at);
  const base = Date.parse(start ?? '') || Date.now();
  const due = Math.max(base + windowMinutes(o) * 60_000, Date.parse(o.auto_release_at ?? '') || 0);
  return new Date(due).toISOString();
}
/** Hasta cuándo NO se puede liberar por plazo: el vencimiento, o la respuesta pendiente a una extensión (máx. 24 h). */
export function releaseBlockedUntil(o: ReleaseOrder, now = Date.now()): string {
  const p = pendingExtension(o, now);
  return new Date(Math.max(Date.parse(releaseDueAt(o)), p ? Date.parse(p.at) + EXTENSION_PENDING_MS : 0)).toISOString();
}
