// Unit (sin red ni DB real): quién puede abrir disputa. Uso: npx tsx scripts/test-dispute-auth.ts
import { __setDbForTests, fail } from '../api/_lib/db';
import { openDispute } from '../api/_lib/escrow';

const calls: string[] = [];
// DB falsa: registra cada operación; ninguna debería llegar a escribir en los casos rechazados.
const q = (table: string): any => {
  const chain: any = new Proxy({}, { get: (_t, k: string) => {
    if (k === 'then') return (r: any) => r({ data: null, error: null });
    if (['insert', 'update', 'upsert', 'delete'].includes(k)) calls.push(`${table}.${k}`);
    return () => chain;
  } });
  return chain;
};
__setDbForTests({ from: (t: string) => q(t) });

const base = { id: '00000000-0000-0000-0000-000000000001', slug: 'abc123', contract_id: 'CXXX', buyer_user_id: 'buyer-sub', seller_user_id: 'seller-sub', amount_usdc: 1 };
const input = { reason: 'no_funciona' as const, description: 'test', evidence: [] };
const status = (e: unknown) => { let code = 0; const res: any = { status: (c: number) => { code = c; return res; }, setHeader: () => res, send: () => res }; fail(res, e); return code; };
let failed = 0;
async function expectRefused(name: string, f: () => Promise<unknown>, http: number, re: RegExp) {
  calls.length = 0;
  try { await f(); console.log(`FAIL  ${name}: no rechazó`); failed++; return; }
  catch (e: any) {
    const ok = status(e) === http && re.test(e.message) && calls.length === 0;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} -> ${status(e)} "${e.message}" writes=${JSON.stringify(calls)}`);
    if (!ok) failed++;
  }
}
(async () => {
  for (const st of ['fondeado', 'enviado', 'entregado'])
    await expectRefused(`vendedor no puede abrir disputa (${st})`, () => openDispute({ ...base, status: st }, 'seller-sub', input), 403, /solo el comprador/);
  await expectRefused('tercero no puede abrir disputa', () => openDispute({ ...base, status: 'enviado' }, 'otro-sub', input), 403, /solo el comprador/);
  await expectRefused('comprador no puede tras liberar (liberado)', () => openDispute({ ...base, status: 'liberado', released_tx: 'abc' }, 'buyer-sub', input), 409, /no se puede disputar/);
  await expectRefused('comprador no puede tras liberar (released_tx con status entregado)', () => openDispute({ ...base, status: 'entregado', released_tx: 'abc' }, 'buyer-sub', input), 409, /no se puede disputar/);
  await expectRefused('comprador no puede tras resolución', () => openDispute({ ...base, status: 'resuelto' }, 'buyer-sub', input), 409, /no se puede disputar/);
  await expectRefused('comprador no puede antes de pagar', () => openDispute({ ...base, status: 'escrow_creado' }, 'buyer-sub', input), 409, /no se puede disputar/);
  console.log(failed ? `\n${failed} FALLARON` : '\nTODO OK'); process.exit(failed ? 1 : 0);
})();
