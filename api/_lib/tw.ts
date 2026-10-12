import { Account, Contract, Keypair, Networks, rpc, scValToNative, TransactionBuilder } from '@stellar/stellar-sdk';
import { env } from './env';

async function tw<T = any>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  env.network();
  const r = await fetch(env.twBase() + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.twKey() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`TW ${path} ${r.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : ({} as T);
}

/** XDR ya firmado por el cliente (Cavos signXdr). */
export async function submitSignedXdr(signedXdr: string) {
  const tx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
  const hash = Buffer.from(tx.hash()).toString('hex');
  const r = await tw<{ status: string; message?: string }>('/helper/send-transaction', { signedXdr });
  if (r.status !== 'SUCCESS') throw new Error(`TW send-transaction: ${r.status} ${r.message ?? ''}`);
  return { ...r, hash };
}

/** TW devuelve XDR sin firmar -> firmamos server-side -> /helper/send-transaction */
export async function signAndSend(unsignedXdr: string, secret: string) {
  const kp = Keypair.fromSecret(secret);
  const tx = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET);
  tx.sign(kp);
  // send-transaction NO devuelve el hash (solo status/message, + contractId/escrow en deploy): lo calculamos local.
  const hash = Buffer.from(tx.hash()).toString('hex');
  const r = await tw<{ status: string; message?: string; contractId?: string; escrow?: any }>('/helper/send-transaction', { signedXdr: tx.toXDR() });
  if (r.status !== 'SUCCESS') throw new Error(`TW send-transaction: ${r.status} ${r.message ?? ''}`);
  return { ...r, hash };
}

export interface Roles {
  approver: string; serviceProvider: string; releaseSigner: string;
  platformAddress: string; disputeResolver: string; receiver: string;
}

export async function deploySingleRelease(p: { signerSecret: string; engagementId: string; title: string; description: string; roles: Roles; amount: number }) {
  const signer = Keypair.fromSecret(p.signerSecret).publicKey();
  const res = await tw<{ status: string; unsignedTransaction: string }>('/deployer/single-release', {
    signer, engagementId: p.engagementId, title: p.title, description: p.description,
    roles: p.roles, amount: p.amount, platformFee: 0,
    milestones: [{ description: 'Entrega del producto verificada' }],
    trustline: { address: env.usdcIssuer(), symbol: 'USDC' }, // verificado en smoke test 2026-10-11
  });
  const sent = await signAndSend(res.unsignedTransaction, p.signerSecret);
  if (!sent.contractId) throw new Error('TW deploy: sin contractId');
  return { contractId: sent.contractId, hash: sent.hash };
}

export async function fundEscrow(contractId: string, amount: number, signerSecret: string) {
  const signer = Keypair.fromSecret(signerSecret).publicKey();
  const res = await tw<{ unsignedTransaction: string }>('/escrow/single-release/fund-escrow', { contractId, signer, amount });
  return signAndSend(res.unsignedTransaction, signerSecret);
}

/** Service provider (vendedor) marca el hito como entregado. */
export async function changeMilestoneStatusXdr(contractId: string, serviceProvider: string, newStatus: string, newEvidence: string) {
  return tw<{ unsignedTransaction: string }>('/escrow/single-release/change-milestone-status', { contractId, milestoneIndex: '0', newStatus, newEvidence, serviceProvider });
}
export async function changeMilestoneStatus(contractId: string, serviceProviderSecret: string, newStatus: string, newEvidence: string) {
  const res = await changeMilestoneStatusXdr(contractId, Keypair.fromSecret(serviceProviderSecret).publicKey(), newStatus, newEvidence);
  return signAndSend(res.unsignedTransaction, serviceProviderSecret);
}

/** Approver (comprador) aprueba el hito. En prod lo firma su Cavos en el cliente; aquí helper server/test. */
export async function approveMilestoneXdr(contractId: string, approver: string) {
  return tw<{ unsignedTransaction: string }>('/escrow/single-release/approve-milestone', { contractId, milestoneIndex: '0', approver });
}
export async function approveMilestone(contractId: string, approverSecret: string) {
  const res = await approveMilestoneXdr(contractId, Keypair.fromSecret(approverSecret).publicKey());
  return signAndSend(res.unsignedTransaction, approverSecret);
}

export async function releaseFunds(contractId: string, releaseSignerSecret: string) {
  const releaseSigner = Keypair.fromSecret(releaseSignerSecret).publicKey();
  const res = await tw<{ unsignedTransaction: string }>('/escrow/single-release/release-funds', { contractId, releaseSigner });
  return signAndSend(res.unsignedTransaction, releaseSignerSecret);
}

/** Lectura con validateOnChain=true (Snowden: verificar on-chain antes de liberar). */
export async function getEscrow(contractId: string) {
  const q = new URLSearchParams({ validateOnChain: 'true' });
  q.append('contractIds[]', contractId); // la API exige sintaxis de array
  const list = await tw<any[]>(`/helper/get-escrow-by-contract-ids?${q}`, undefined, 'GET');
  return Array.isArray(list) ? list[0] : list;
}
export async function getBalance(contractId: string): Promise<number> {
  const q = new URLSearchParams(); q.append('addresses[]', contractId);
  const r = await tw<any[]>(`/helper/get-multiple-escrow-balance?${q}`, undefined, 'GET');
  return Number(r?.[0]?.balance ?? 0);
}

/** Abre disputa (single-release). Firma el approver (rol del comprador en el escrow). Devuelve XDR sin firmar. */
export async function disputeEscrowXdr(contractId: string, signer: string) {
  return tw<{ unsignedTransaction: string }>('/escrow/single-release/dispute-escrow', { contractId, signer });
}

/** Resuelve disputa con reparto. distributions debe sumar el saldo restante (post-fees). Firma el dispute resolver. */
export async function resolveDispute(contractId: string, resolverSecret: string, distributions: { address: string; amount: number }[]) {
  const disputeResolver = Keypair.fromSecret(resolverSecret).publicKey();
  const res = await tw<{ unsignedTransaction: string }>('/escrow/single-release/resolve-dispute', { contractId, disputeResolver, distributions });
  return signAndSend(res.unsignedTransaction, resolverSecret);
}

/**
 * Lee el escrow DIRECTO del contrato (simulación Soroban de get_escrow), sin pasar por el indexador de TW.
 * Necesario: TW no indexa las tx que enviamos con fee-bump (probado: tras dispute fee-bump, TW flags.disputed=false).
 */
export async function onChainEscrow(contractId: string): Promise<any> {
  env.network();
  const server = new rpc.Server(env.sorobanRpc());
  const tx = new TransactionBuilder(new Account(Keypair.random().publicKey(), '0'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(contractId).call('get_escrow')).setTimeout(30).build();
  const r: any = await server.simulateTransaction(tx);
  if (r.error || !r.result?.retval) throw new Error(`get_escrow on-chain falló: ${String(r.error ?? 'sin retval').slice(0, 200)}`);
  return scValToNative(r.result.retval);
}

/** Estado on-chain para liberar. Nunca liberar si hay disputa abierta o ya cerrado. Falla cerrado si no se puede leer. */
export async function releaseGuard(contractId: string) {
  const esc = await onChainEscrow(contractId);
  const f = esc?.flags ?? {};
  return { esc, disputed: !!f.disputed, released: !!f.released, resolved: !!f.resolved, approved: !!esc?.milestones?.[0]?.approved };
}
