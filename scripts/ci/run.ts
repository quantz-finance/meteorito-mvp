// Runner único: `npm run test:ci`. SOLO TESTNET.
// Unit (sin red): JWT, PIN, auth de disputas. On-chain (testnet): fondeo/webhook, release, disputa.
// Sin secretos testnet: en CI falla; en local se saltan los on-chain (o TESTNET=skip para forzar).
import { baseEnv, SECRET_NAMES, testnet, type T } from './setup';

baseEnv();
const TESTS: { id: string; name: string; file: string; onchain: boolean }[] = [
  { id: '7', name: 'JWT aud/iss/exp/firma (+LOG_ONLY)', file: './t07-jwt.test.ts', onchain: false },
  { id: '4', name: 'PIN bloqueado tras 3 intentos', file: './t04-pin.test.ts', onchain: false },
  { id: '6a', name: 'Disputa: solo comprador, antes de liberar', file: './t06-dispute-auth.test.ts', onchain: false },
  { id: '8', name: 'Ownership por sub en todas las escrituras', file: './t08-ownership.test.ts', onchain: false },
  { id: '9', name: 'Vendedor nuevo sin trustline: error claro, activación validada', file: './t09-seller-wallet.test.ts', onchain: false },
  { id: '1+5', name: 'Doble fondeo rechazado + webhook duplicado idempotente', file: './t01-funding.test.ts', onchain: true },
  { id: '2', name: 'Doble release rechazado', file: './t02-release.test.ts', onchain: true },
  { id: '3+6b', name: 'Release con disputa abierta rechazado + resolución', file: './t03-dispute-onchain.test.ts', onchain: true },
];

(async () => {
  const N = process.env.TESTNET === 'skip' ? null : testnet();
  if (!N && process.env.CI && process.env.TESTNET !== 'skip') { console.error(`Faltan secretos testnet: ${SECRET_NAMES.join(', ')}`); process.exit(1); }
  const summary: string[] = []; let failed = 0;
  for (const tc of TESTS) {
    if (tc.onchain && !N) { summary.push(`SKIP  (${tc.id}) ${tc.name} — sin secretos testnet`); continue; }
    console.log(`\n== (${tc.id}) ${tc.name}`);
    let pass = 0, fail = 0;
    const t: T = { check(name, ok, detail = '') { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); ok ? pass++ : fail++; } };
    try { const m = await import(tc.file); await m.run(t, N); }
    catch (e: any) { console.log(`  FAIL  excepción: ${String(e?.message ?? e).slice(0, 400)}`); fail++; }
    failed += fail;
    summary.push(`${fail ? 'FAIL' : 'PASS'}  (${tc.id}) ${tc.name} — ${pass}/${pass + fail}`);
  }
  console.log('\n==== Resumen\n' + summary.join('\n'));
  process.exit(failed ? 1 : 0);
})();
