// (17) Montos: fondeo parcial nunca cuenta como pagado; vendedor recibe solo el monto del pedido.
import type { T } from './setup';
import { disputeSplit, fundingCheck, releaseCheck } from '../../api/_lib/escrow';

export async function run(t: T) {
  const ok = (x: any) => x.ok === true; const why = (x: any) => x.reason;
  t.check('fondeo exacto (escrow=pedido, depósito=monto) -> pagado', ok(fundingCheck({ orderAmount: 1.97, escrowAmountStroops: '19700000', before: 0, after: 1.97 })));
  t.check('depósito parcial (0.01 de 1.97) -> NO pagado', why(fundingCheck({ orderAmount: 1.97, escrowAmountStroops: '19700000', before: 0, after: 0.01 })) === 'deposit_short');
  t.check('saldo previo ajeno + depósito corto -> NO pagado (no basta saldo ≥ monto)', why(fundingCheck({ orderAmount: 1.97, escrowAmountStroops: '19700000', before: 1.97, after: 2.0 })) === 'deposit_short');
  t.check('saldo previo 0.01 + depósito completo -> pagado', ok(fundingCheck({ orderAmount: 1.97, escrowAmountStroops: '19700000', before: 0.01, after: 1.98 })));
  t.check('escrow on-chain con monto distinto al pedido -> NO pagado', why(fundingCheck({ orderAmount: 1.97, escrowAmountStroops: '10000000', before: 0, after: 1.97 })) === 'escrow_amount_mismatch');
  t.check('release: saldo = monto -> ok; menor -> insufficient; mayor -> ok con excedente reportado',
    ok(releaseCheck(1, 1)) && why(releaseCheck(0.5, 1)) === 'insufficient' && (releaseCheck(1.01, 1) as any).excess === 0.01);
  const a = disputeSplit(1.01, 1, 0), b = disputeSplit(1.01, 1, 50), c = disputeSplit(1, 1, 30);
  t.check('disputa con excedente: vendedor ≤ monto del pedido, excedente al comprador, suma = saldo',
    a.toSeller === 1 && a.toBuyer === 0.01 && b.toSeller === 0.5 && b.toBuyer === 0.51 && c.toSeller === 0.7 && c.toBuyer === 0.3);
}
