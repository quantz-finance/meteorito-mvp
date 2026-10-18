import { Account, Contract, Keypair, Networks, rpc, scValToNative, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { env } from './env';
import { withRetry } from './retry';
import { awaitSafeRebuild, latestLedgerCloseS } from './timebounds';

async function tw<T = any>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  env.network();
  const once = async () => {
    const r = await fetch(env.twBase() + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.twKey() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) throw Object.assign(new Error(`TW ${path} ${r.status}: ${text.slice(0, 500)}`), { status: r.status });
    return text ? JSON.parse(text) : ({} as T);
  };
  // send-transaction tiene efectos: sus reintentos los maneja sendSigned (verifica si ya entró).
  return path === '/helper/send-transaction' ? once() : withRetry(`TW ${method} ${path.split('?')[0]}`, once);
}

/** XDR ya firmado por el cliente (Cavos signXdr). */
export async function submitSignedXdr(signedXdr: string) {
  const tx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
  const hash = Buffer.from(tx.hash()).toString('hex');
  const r = await sendSigned(signedXdr, hash);
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
  const r = await sendSigned(tx.toXDR(), hash);
  if (r.status !== 'SUCCESS') throw new Error(`TW send-transaction: ${r.status} ${r.message ?? ''}`);
  return { ...r, hash };
}

/** CI: solo se permiten escrituras sobre escrows desplegados por ESTE proceso (nunca escrows manuales/de usuarios).
 *  Activo con CI_OWN_CONTRACTS_ONLY=1 (lo pone scripts/ci/setup.ts). En runtime (Vercel) no aplica. */
const ciDeployed = new Set<string>();
export function ciGuard(contractId: string) {
  if (process.env.CI_OWN_CONTRACTS_ONLY === '1' && !ciDeployed.has(contractId))
    throw new Error(`CI: escritura bloqueada en ${contractId} (no fue desplegado por este run de CI)`);
}

export interface Roles {
  approver: string; serviceProvider: string; releaseSigner: string;
  platformAddress: string; disputeResolver: string; receiver: string;
}

export async function deploySingleRelease(p: { signerSecret: string; engagementId: string; title: string; description: string; roles: Roles; amount: number }) {
  const signer = Keypair.fromSecret(p.signerSecret).publicKey();
  const sent = await buildSignSend(() => tw<{ status: string; unsignedTransaction: string }>('/deployer/single-release', {
    signer, engagementId: p.engagementId, title: p.title, description: p.description,
    roles: p.roles, amount: p.amount, platformFee: 0,
    milestones: [{ description: 'Entrega del producto verificada' }],
    trustline: { address: env.usdcIssuer(), symbol: 'USDC' }, // verificado en smoke test 2026-10-11
  }), p.signerSecret);
  if (!sent.contractId) throw new Error('TW deploy: sin contractId');
  ciDeployed.add(sent.contractId);
  return { contractId: sent.contractId, hash: sent.hash };
}

/** XDR sin firmar de fund-escrow con el comprador como signer (pago directo en USDC desde su wallet Stellar). */
export async function fundEscrowXdr(contractId: string, amount: number, signer: string) {
  ciGuard(contractId);
  return tw<{ unsignedTransaction: string }>('/escrow/single-release/fund-escrow', { contractId, signer, amount });
}

export async function fundEscrow(contractId: string, amount: number, signerSecret: string) {
  ciGuard(contractId);
  const signer = Keypair.fromSecret(signerSecret).publicKey();
  return buildSignSend(() => tw<{ unsignedTransaction: string }>('/escrow/single-release/fund-escrow', { contractId, signer, amount }), signerSecret);
}

/** Service provider (vendedor) marca el hito como entregado. */
export async function changeMilestoneStatusXdr(contractId: string, serviceProvider: string, newStatus: string, newEvidence: string) {
  ciGuard(contractId);
  return tw<{ unsignedTransaction: string }>('/escrow/single-release/change-milestone-status', { contractId, milestoneIndex: '0', newStatus, newEvidence, serviceProvider });
}
export async function changeMilestoneStatus(contractId: string, serviceProviderSecret: string, newStatus: string, newEvidence: string) {
  ciGuard(contractId);
  return buildSignSend(() => changeMilestoneStatusXdr(contractId, Keypair.fromSecret(serviceProviderSecret).publicKey(), newStatus, newEvidence), serviceProviderSecret);
}

/** Approver (comprador) aprueba el hito. En prod lo firma su Cavos en el cliente; aquí helper server/test. */
export async function approveMilestoneXdr(contractId: string, approver: string) {
  ciGuard(contractId);
  return tw<{ unsignedTransaction: string }>('/escrow/single-release/approve-milestone', { contractId, milestoneIndex: '0', approver });
}
export async function approveMilestone(contractId: string, approverSecret: string) {
  ciGuard(contractId);
  return buildSignSend(() => approveMilestoneXdr(contractId, Keypair.fromSecret(approverSecret).publicKey()), approverSecret);
}

export async function releaseFunds(contractId: string, releaseSignerSecret: string) {
  ciGuard(contractId);
  const releaseSigner = Keypair.fromSecret(releaseSignerSecret).publicKey();
  return buildSignSend(() => tw<{ unsignedTransaction: string }>('/escrow/single-release/release-funds', { contractId, releaseSigner }), releaseSignerSecret);
}

/** Lectura con validateOnChain=true (verificar on-chain antes de liberar). */
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
  ciGuard(contractId);
  return tw<{ unsignedTransaction: string }>('/escrow/single-release/dispute-escrow', { contractId, signer });
}

/** Resuelve disputa con reparto. distributions debe sumar el saldo restante (post-fees). Firma el dispute resolver. */
export async function resolveDispute(contractId: string, resolverSecret: string, distributions: { address: string; amount: number }[]) {
  ciGuard(contractId);
  const disputeResolver = Keypair.fromSecret(resolverSecret).publicKey();
  return buildSignSend(() => tw<{ unsignedTransaction: string }>('/escrow/single-release/resolve-dispute', { contractId, disputeResolver, distributions }), resolverSecret);
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
  const r: any = await withRetry('Soroban simulate get_escrow', () => server.simulateTransaction(tx));
  if (r.error || !r.result?.retval) throw new Error(`get_escrow on-chain falló: ${String(r.error ?? 'sin retval').slice(0, 200)}`);
  return scValToNative(r.result.retval);
}

/** Estado on-chain para liberar. Nunca liberar si hay disputa abierta o ya cerrado. Falla cerrado si no se puede leer. */
export async function releaseGuard(contractId: string) {
  const esc = await onChainEscrow(contractId);
  const f = esc?.flags ?? {};
  return { esc, disputed: !!f.disputed, released: !!f.released, resolved: !!f.resolved, approved: !!esc?.milestones?.[0]?.approved };
}

/** Envía vía TW. En CI, ante timeout/5xx: antes de reenviar, consulta Soroban RPC por el hash; si ya entró, no reenvía. */
async function sendSigned(signedXdr: string, hash: string): Promise<{ status: string; message?: string; contractId?: string; escrow?: any }> {
  const send = async () => {
    const r = await tw<{ status: string; message?: string; contractId?: string; escrow?: any }>('/helper/send-transaction', { signedXdr });
    // TW a veces responde 200 con status de timeout: tratarlo como transitorio.
    if (r.status !== 'SUCCESS' && /timed? ?out/i.test(String(r.message ?? ''))) throw new Error(`TW send-transaction timed out: ${r.message}`);
    return r;
  };
  return withRetry('TW send-transaction', send, { landed: () => landedTx(hash) });
}

/** Si la tx está confirmada en Soroban RPC, la devuelve como SUCCESS (con contractId si el retorno es una dirección C…). */
export async function landedTx(hash: string): Promise<{ status: string; contractId?: string } | null> {
  const r: any = await new rpc.Server(env.sorobanRpc()).getTransaction(hash);
  if (r?.status !== 'SUCCESS') return null;
  let contractId: string | undefined;
  try { const v = r.returnValue ? scValToNative(r.returnValue) : undefined; if (typeof v === 'string' && /^C[A-Z2-7]{55}$/.test(v)) contractId = v; } catch {}
  return { status: 'SUCCESS', contractId };
}

/** Construye (TW) + firma + envía. Los timebounds de TW (~100 s) NO se pueden acortar: /helper/send-transaction rechaza
 *  (400) cualquier XDR distinto al que armó (probado 2026-10-12). Si su ventana excede TX_REBUILD_MAX_WINDOW_S, no se reconstruye. Ante tx_bad_seq (CI): NO reconstruye hasta que el maxTime de la
 *  tx original pasó según el close time del último ledger Y su hash confirma que no entró. Así nunca hay dos tx vivas. */
async function buildSignSend(build: () => Promise<{ unsignedTransaction: string }>, secret: string) {
  return withRetry('TW build+send (tx_bad_seq)', async () => {
    const res = await build();
    const tx = TransactionBuilder.fromXDR(res.unsignedTransaction, Networks.TESTNET) as Transaction; tx.sign(Keypair.fromSecret(secret));
    const hash = Buffer.from(tx.hash()).toString('hex');
    try {
      const r = await sendSigned(tx.toXDR(), hash);
      if (r.status !== 'SUCCESS') throw new Error(`TW send-transaction: ${r.status} ${r.message ?? ''}`);
      return { ...r, hash };
    } catch (e: any) {
      if (!/tx_bad_seq/.test(String(e?.message))) throw e;
      const v = await awaitSafeRebuild(tx, { ledgerCloseS: latestLedgerCloseS, landed: async () => !!(await landedTx(hash).catch(() => null)) });
      if (v === 'landed') { console.warn('[ci-retry] tx_bad_seq pero la tx ya había entrado; no se reconstruye'); return { ...(await landedTx(hash))!, hash }; }
      throw Object.assign(new Error(`tx_bad_seq (expiró sin entrar; se reconstruye): ${e.message}`), { status: 503 });
    }
  });
}
