import { Keypair, TransactionBuilder, Networks } from '@stellar/stellar-sdk';
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
