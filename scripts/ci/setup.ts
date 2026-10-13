// Setup común de tests CI. SOLO TESTNET: el backend ya rechaza STELLAR_NETWORK != testnet (env.network()).
// Secretos: de variables de entorno (GitHub Actions) o, en local, de .ci-secrets.env.
import { existsSync, readFileSync } from 'node:fs';
import { Keypair } from '@stellar/stellar-sdk';

export interface T { check(name: string, ok: boolean, detail?: string): void; }
export const SECRET_NAMES = ['TW_API_KEY', 'TESTNET_DEPLOYER_SECRET', 'TESTNET_TREASURY_SECRET', 'TESTNET_APPROVER_SECRET', 'TESTNET_RELEASE_SIGNER_SECRET',
  'TESTNET_PLATFORM_SECRET', 'TESTNET_DISPUTE_RESOLVER_SECRET', 'TESTNET_SELLER_SECRET', 'TESTNET_BUYER_SECRET'] as const;

// Local: wallets dedicadas a CI en .ci-secrets.env (gitignored, chmod 600). Nunca las wallets de la app.
function fromFiles(): Record<string, string> | null {
  const f = process.env.CI_SECRETS_FILE ?? new URL('../../.ci-secrets.env', import.meta.url).pathname;
  if (!existsSync(f)) return null;
  const kv = Object.fromEntries(readFileSync(f, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
  return SECRET_NAMES.every((n) => kv[n]) ? Object.fromEntries(SECRET_NAMES.map((n) => [n, kv[n]])) : null;
}

/** Variables base para el backend en tests (sin DB real: los tests inyectan fakeDb). */
export function baseEnv() {
  Object.assign(process.env, {
    STELLAR_NETWORK: 'testnet', SUPABASE_URL: 'https://test.supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test',
    CI_NETWORK_RETRY: '1', CI_OWN_CONTRACTS_ONLY: '1', // reintentos con backoff SOLO en CI para red testnet (api/_lib/retry.ts)
    PIN_PEPPER: 'ci-pepper', CRON_SECRET: 'ci-cron', SERVICE_PROVIDER_MODE: 'seller', VERCEL_ENV: 'production',
  });
}

export interface Testnet { S: Record<string, string>; pub: (k: string) => string }
/** Carga secretos testnet y los mapea a las env del backend. null si no hay (los tests on-chain se saltan). */
export function testnet(): Testnet | null {
  const env = Object.fromEntries(SECRET_NAMES.map((n) => [n, process.env[n] ?? ''])) as Record<string, string>;
  const S = SECRET_NAMES.every((n) => env[n]) ? env : fromFiles();
  if (!S) return null;
  const pub = (k: string) => Keypair.fromSecret(S[k]).publicKey();
  Object.assign(process.env, {
    TW_API_KEY: S.TW_API_KEY, DEPLOYER_SECRET: S.TESTNET_DEPLOYER_SECRET, TREASURY_SECRET: S.TESTNET_TREASURY_SECRET,
    APPROVER_SECRET: S.TESTNET_APPROVER_SECRET, RELEASE_SIGNER_SECRET: S.TESTNET_RELEASE_SIGNER_SECRET,
    PLATFORM_SECRET: S.TESTNET_PLATFORM_SECRET, PLATFORM_PUBLIC: pub('TESTNET_PLATFORM_SECRET'),
    DISPUTE_RESOLVER_PUBLIC: pub('TESTNET_DISPUTE_RESOLVER_SECRET'),
  });
  return { S, pub };
}

export const refused = async (f: () => Promise<unknown>): Promise<{ msg: string; status?: number }> => {
  try { await f(); return { msg: '' }; } catch (e: any) { return { msg: String(e.message), status: e.status }; }
};

/** Despliega + fondea (+ envía) un escrow de 1 USDC en testnet. */
export async function makeEscrow(N: Testnet, tag: string, opts: { fund?: boolean; ship?: boolean } = { fund: true, ship: true }) {
  const tw = await import('../../api/_lib/tw');
  const { Networks, TransactionBuilder } = await import('@stellar/stellar-sdk');
  const seller = Keypair.fromSecret(N.S.TESTNET_SELLER_SECRET);
  const { contractId, hash } = await tw.deploySingleRelease({ signerSecret: N.S.TESTNET_DEPLOYER_SECRET, engagementId: `ci-${tag}-${Date.now()}`, title: 'Meteorito CI', description: tag, amount: 1,
    roles: { approver: N.pub('TESTNET_APPROVER_SECRET'), serviceProvider: seller.publicKey(), releaseSigner: N.pub('TESTNET_RELEASE_SIGNER_SECRET'), receiver: seller.publicKey(),
      disputeResolver: N.pub('TESTNET_DISPUTE_RESOLVER_SECRET'), platformAddress: N.pub('TESTNET_PLATFORM_SECRET') } });
  const out: Record<string, string> = { contractId, deploy: hash };
  if (opts.fund) out.fund = (await tw.fundEscrow(contractId, 1, N.S.TESTNET_TREASURY_SECRET)).hash;
  if (opts.ship) {
    const x = await tw.changeMilestoneStatusXdr(contractId, seller.publicKey(), 'Enviado', 'sha256:ci');
    const t = TransactionBuilder.fromXDR(x.unsignedTransaction, Networks.TESTNET); t.sign(seller);
    out.ship = (await tw.submitSignedXdr(t.toXDR())).hash;
  }
  console.log(`    [${tag}] ${Object.entries(out).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  return out;
}
