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
  { id: '10', name: 'Liberación automática configurable (AUTO_RELEASE_MINUTES)', file: './t10-autorelease.test.ts', onchain: false },
  { id: '11', name: 'Activación wallet: errores con código + activación real testnet', file: './t11-activate.test.ts', onchain: false },
  { id: '12', name: 'Cavos: dispositivo sin llave (tras logout) y logout protegido', file: './t12-cavos-signer.test.ts', onchain: false },
  { id: '13', name: 'Sesión vencida: renovación con prueba de wallet + comprador nuevo', file: './t13-session.test.ts', onchain: false },
  { id: '14', name: 'Bind sub->wallet al iniciar sesión (solo token fresco)', file: './t14-bind-on-login.test.ts', onchain: false },
  { id: '15', name: 'Reintentos de red en CI (backoff, sin reenviar tx ya incluida)', file: './t15-ci-retry.test.ts', onchain: false },
  { id: '16', name: 'Timebounds cortos y reconstrucción solo tras expirar (sin dos tx vivas)', file: './t16-timebounds.test.ts', onchain: false },
  { id: '17', name: 'Montos: parcial no cuenta como pagado; vendedor solo recibe el monto', file: './t17-amounts.test.ts', onchain: false },
  { id: '19', name: 'Repro: token vencido de otra cuenta/billetera -> sin bucle, re-login, re-bind seguro', file: './t19-prod-relogin.test.ts', onchain: false },
  { id: '20', name: 'Re-link: solo 404 explícito, sin items activos, token fresco + nonce, auditoría', file: './t20-relink.test.ts', onchain: false },
  { id: '21', name: 'session_relogin_required: sin bucle ni logout, re-login + bind antes de actuar, bind en primer login', file: './t21-relogin-required.test.ts', onchain: false },
  { id: '22', name: 'Modo demo: apagado por defecto, sin puerta en prod, sin red al backend real', file: './t22-demo.test.ts', onchain: false },
  { id: '1+5', name: 'Doble fondeo rechazado + webhook duplicado idempotente', file: './t01-funding.test.ts', onchain: true },
  { id: '2', name: 'Doble release rechazado', file: './t02-release.test.ts', onchain: true },
  { id: '3+6b', name: 'Release con disputa abierta rechazado + resolución', file: './t03-dispute-onchain.test.ts', onchain: true },
  { id: '18', name: 'Excedente on-chain: vendedor recibe solo el monto del pedido', file: './t18-excess-onchain.test.ts', onchain: true },
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
