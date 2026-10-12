// Activación de la wallet del vendedor (receiver del escrow). NO custodial:
// la cuenta y la trustline USDC son del vendedor (firma con Cavos signXdr); la wallet platform solo
// PATROCINA las reservas (CAP-33) y paga el fee. Nunca movemos fondos del vendedor ni guardamos su llave.
import { Asset, Horizon, Keypair, Networks, Operation, Transaction, TransactionBuilder, FeeBumpTransaction } from '@stellar/stellar-sdk';
import { env } from './env';
import { HttpError } from './auth';
import { feeBumpAndSend } from './feebump';

export type WalletState = 'ready' | 'no_account' | 'no_trustline';
export const usdc = () => new Asset('USDC', env.usdcIssuer());

/** Mensaje para el comprador cuando el vendedor aún no activó su wallet (nunca el 400 crudo de TW). */
export const SELLER_NOT_READY = 'El vendedor todavía no activó su cuenta para recibir pagos. Avisale que abra Meteorito para activarla y volvé a intentar en unos minutos.';

let horizonFor: () => { loadAccount(a: string): Promise<any> } = () => new Horizon.Server(env.horizon());
export const __setHorizonForTests = (h: typeof horizonFor) => { horizonFor = h; };

export async function walletState(address: string): Promise<WalletState> {
  let acct: any;
  try { acct = await horizonFor().loadAccount(address); }
  catch (e: any) { if (e?.response?.status === 404 || e?.name === 'NotFoundError') return 'no_account'; throw e; }
  const ok = (acct.balances ?? []).some((b: any) => b.asset_code === 'USDC' && b.asset_issuer === env.usdcIssuer());
  return ok ? 'ready' : 'no_trustline';
}

/** Error accionable si el receiver no puede recibir USDC. */
export async function assertReceiverReady(address: string) {
  const s = await walletState(address);
  if (s !== 'ready') throw Object.assign(new HttpError(409, SELLER_NOT_READY), { code: 'seller_wallet_not_ready' });
}

/** Tx sin firmar: source = platform (paga fee y reserva de la cuenta), changeTrust firmada por el vendedor. */
export async function buildActivationTx(seller: string, state: Exclude<WalletState, 'ready'>): Promise<Transaction> {
  const platform = env.platformPublic();
  const src = await horizonFor().loadAccount(platform);
  const b = new TransactionBuilder(src, { fee: '1000', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: seller }));
  if (state === 'no_account') b.addOperation(Operation.createAccount({ destination: seller, startingBalance: '0' }));
  b.addOperation(Operation.changeTrust({ asset: usdc(), source: seller }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: seller }));
  return b.setTimeout(300).build();
}

/** Valida EXACTAMENTE la forma de buildActivationTx (lo que la platform va a firmar). */
export function validateActivationTx(xdr: string, seller: string): Transaction {
  let tx: Transaction | FeeBumpTransaction;
  try { tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET); } catch { throw new HttpError(400, 'XDR inválido'); }
  if (tx instanceof FeeBumpTransaction) throw new HttpError(400, 'XDR inválido');
  if (tx.source !== env.platformPublic()) throw new HttpError(400, 'source inesperado');
  if (Number(tx.fee) > 10_000) throw new HttpError(400, 'fee demasiado alto');
  const ops: any[] = tx.operations; const n = ops.length;
  const okShape = (n === 3 || n === 4)
    && ops[0].type === 'beginSponsoringFutureReserves' && ops[0].sponsoredId === seller && (ops[0].source ?? tx.source) === tx.source
    && (n === 3 || (ops[1].type === 'createAccount' && ops[1].destination === seller && Number(ops[1].startingBalance) === 0 && (ops[1].source ?? tx.source) === tx.source))
    && ops[n - 2].type === 'changeTrust' && ops[n - 2].source === seller && ops[n - 2].line?.code === 'USDC' && ops[n - 2].line?.issuer === env.usdcIssuer()
    && ops[n - 1].type === 'endSponsoringFutureReserves' && ops[n - 1].source === seller;
  if (!okShape) throw new HttpError(400, 'operación no permitida');
  const sellerHint = Keypair.fromPublicKey(seller).signatureHint();
  if (!tx.signatures.some((s) => Buffer.from(s.hint()).equals(Buffer.from(sellerHint)))) throw new HttpError(400, 'falta la firma del vendedor');
  return tx;
}

export async function signAndSubmitActivation(tx: Transaction) {
  // Platform firma el inner (sponsor + source) y lo envuelve en fee-bump pagado por la platform: el vendedor nunca necesita XLM.
  tx.sign(Keypair.fromSecret(env.platformSecret()));
  const { hash } = await feeBumpAndSend(tx);
  return hash;
}
