// Fee-bump: el usuario (Cavos) firma el XDR de TW; la wallet platform paga el fee. El usuario nunca necesita XLM.
// PLATFORM_SECRET se usa SOLO aquí.
import { Address, FeeBumpTransaction, Horizon, Keypair, Networks, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { env } from './env';
import { HttpError } from './auth';

export interface Expect { contractId: string; fns: string[]; source: string }

/** Valida que el XDR firmado sea UNA invocación a nuestro contrato escrow, con función permitida y source esperado. */
export function validateEscrowTx(signedXdr: string, ex: Expect): Transaction {
  let tx: Transaction | FeeBumpTransaction;
  try { tx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET); } catch { throw new HttpError(400, 'XDR inválido'); }
  if (tx instanceof FeeBumpTransaction) throw new HttpError(400, 'no se aceptan fee-bumps del cliente');
  if (tx.networkPassphrase !== Networks.TESTNET) throw new HttpError(400, 'red incorrecta');
  if (tx.source !== ex.source) throw new HttpError(400, 'source inesperado');
  if (tx.operations.length !== 1 || tx.operations[0].type !== 'invokeHostFunction') throw new HttpError(400, 'operación no permitida');
  const { cid, name } = invokedContract((tx.operations[0] as any).func);
  if (cid !== ex.contractId) throw new HttpError(400, 'contrato distinto al del pedido');
  if (!ex.fns.includes(name)) throw new HttpError(400, `función no permitida: ${name}`);
  if (!tx.signatures.length) throw new HttpError(400, 'XDR sin firmar');
  const maxInnerFee = Number(process.env.FEEBUMP_MAX_INNER_FEE ?? '20000000'); // 2 XLM tope
  if (Number(tx.fee) > maxInnerFee) throw new HttpError(400, 'fee demasiado alto');
  return tx;
}

/** Soporta la forma nueva (stellar-sdk 17: objetos planos) y la clásica (uniones xdr). */
function invokedContract(f: any): { cid: string; name: string } {
  const toStr = (v: any): string => {
    if (typeof v === 'string') return v;
    if (v instanceof Uint8Array) return Buffer.from(v).toString();
    try { return Address.fromScAddress(v).toString(); } catch {}
    return String(v?.toString?.() ?? '');
  };
  let ic: any;
  if (typeof f?.switch === 'function') {
    if (f.switch().name !== 'hostFunctionTypeInvokeContract') throw new HttpError(400, 'host function no permitida');
    ic = f.invokeContract(); return { cid: toStr(ic.contractAddress()), name: toStr(ic.functionName()) };
  }
  if (!f?.invokeContract || !/InvokeContract/i.test(String(f.type))) throw new HttpError(400, 'host function no permitida');
  ic = f.invokeContract;
  return { cid: toStr(ic.contractAddress), name: toStr(ic.functionName) };
}

export async function feeBumpAndSend(inner: Transaction) {
  const platform = Keypair.fromSecret(env.platformSecret());
  // fee-bump total = baseFee * (ops+1) y debe cubrir el fee del inner (incluye recursos Soroban).
  const baseFee = String(Number(inner.fee) + 1000);
  const fb = TransactionBuilder.buildFeeBumpTransaction(platform, baseFee, inner, Networks.TESTNET);
  fb.sign(platform);
  try {
    const r = await new Horizon.Server(env.horizon()).submitTransaction(fb);
    return { hash: r.hash, innerHash: Buffer.from(inner.hash()).toString('hex') };
  } catch (e: any) {
    throw new HttpError(502, `envío falló: ${JSON.stringify(e?.response?.data?.extras?.result_codes ?? e.message)}`);
  }
}
