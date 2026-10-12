import { Keypair } from '@stellar/stellar-sdk';
import { createHash, randomInt } from 'node:crypto';
import { env } from './env';
import { db, advance, logEvent } from './db';
import { HttpError } from './auth';
import * as tw from './tw';

const pub = (secret: string) => Keypair.fromSecret(secret).publicKey();

/** Monto bruto a depositar para que el vendedor reciba price_crc neto del 0.3% de TW. Siempre desde el pedido en DB. */
export function grossUsdc(priceCrc: number) {
  const net = priceCrc / env.crcUsdcRate();
  return Math.ceil((net / (1 - env.twFee())) * 100) / 100;
}

export function serviceProviderFor(order: any) {
  return env.spMode() === 'backend' ? pub(env.serviceSecret()) : order.seller_address;
}

export async function deployFor(order: any, buyerAddress: string, buyerUserId: string) {
  if (order.contract_id) return order.contract_id as string;
  if (order.status !== 'creado') throw new HttpError(409, `status ${order.status}`);
  if (buyerAddress === order.seller_address || buyerUserId === order.seller_user_id) throw new HttpError(400, 'no podés comprar tu propio link');
  const amount = grossUsdc(Number(order.price_crc));
  const { contractId, hash } = await tw.deploySingleRelease({
    signerSecret: env.deployerSecret(),
    engagementId: order.id,
    title: `Meteorito ${order.slug}`,
    description: `${order.brand} ${order.model}`.slice(0, 200),
    amount,
    roles: {
      approver: pub(env.approverSecret()),
      serviceProvider: serviceProviderFor(order),
      releaseSigner: pub(env.releaseSignerSecret()),
      receiver: order.seller_address,
      disputeResolver: env.disputeResolverPublic(),
      platformAddress: env.platformPublic(),
    },
  });
  await advance(order.id, 'creado', {
    contract_id: contractId, deploy_tx: hash, buyer_address: buyerAddress, buyer_user_id: buyerUserId,
    amount_usdc: amount, fx_crc_per_usdc: env.crcUsdcRate(), sp_mode: env.spMode(), status: 'escrow_creado',
  });
  await logEvent(order.id, 'escrow_deployed', { contractId, hash, amount });
  return contractId;
}

/** ramp-provider.mock: SINPE simulado. Fondea desde treasury. Monto SIEMPRE del pedido en DB. Idempotente por order_id. */
export async function mockRampFund(orderId: string) {
  const { data: order } = await db().from('orders').select('*').eq('id', orderId).single();
  if (order.funded_tx) return { fundedTx: order.funded_tx as string, pin: null };
  if (order.status !== 'escrow_creado') throw new HttpError(409, `status ${order.status}`);
  const amount = Number(order.amount_usdc);
  const { error: lockErr } = await db().from('ramp_mock_payments').insert({ order_id: order.id, amount_usdc: amount });
  if (lockErr) throw new HttpError(409, 'fondeo ya en curso o hecho');
  let sent;
  try { sent = await tw.fundEscrow(order.contract_id, amount, env.treasurySecret()); }
  catch (e) { await db().from('ramp_mock_payments').update({ state: 'failed' }).eq('order_id', order.id); throw e; }
  const bal = await tw.getBalance(order.contract_id);
  if (bal + 1e-7 < amount) throw new Error(`balance on-chain ${bal} < ${amount}`);
  const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db().from('ramp_mock_payments').update({ state: 'sent', tx_hash: sent.hash }).eq('order_id', order.id);
  await advance(order.id, 'escrow_creado', {
    funded_tx: sent.hash, funded_at: new Date().toISOString(), status: 'fondeado', delivery_pin_hash: pinHash(order.id, pin),
  });
  await logEvent(order.id, 'funded', { hash: sent.hash, amount, ramp: 'mock' });
  return { fundedTx: sent.hash, pin };
}

export const pinHash = (orderId: string, pin: string) => createHash('sha256').update(`${env.pinPepper()}:${orderId}:${pin}`).digest('hex');
export const evidenceHash = (evidence: unknown) => 'sha256:' + createHash('sha256').update(JSON.stringify(evidence)).digest('hex');

export type ApproveReason = 'buyer_confirm' | 'pin' | 'timeout';

/** Backend approver aprueba + release signer libera, verificando on-chain antes (Snowden). */
export async function approveAndRelease(order: any, reason: ApproveReason) {
  if (order.status !== 'enviado' && order.status !== 'entregado') throw new HttpError(409, `status ${order.status}`);
  if (order.status === 'enviado') {
    const pre = await tw.getEscrow(order.contract_id);
    if (pre?.flags?.disputed || pre?.flags?.released || pre?.flags?.resolved) throw new HttpError(409, 'escrow en disputa o cerrado');
    const ap = await tw.approveMilestone(order.contract_id, env.approverSecret());
    await advance(order.id, 'enviado', { approved_tx: ap.hash, approval_reason: reason, delivered_at: new Date().toISOString(), status: 'entregado' });
    await logEvent(order.id, 'approved', { hash: ap.hash, reason });
  }
  const esc = await tw.getEscrow(order.contract_id);
  const f = esc?.flags ?? {};
  if (f.disputed || f.released || f.resolved) throw new HttpError(409, 'escrow en disputa o cerrado');
  if (!esc?.milestones?.[0]?.approved) throw new HttpError(409, 'hito no aprobado on-chain');
  const bal = await tw.getBalance(order.contract_id);
  if (bal + 1e-7 < Number(order.amount_usdc)) throw new HttpError(409, `sin fondos on-chain (${bal})`);
  const rel = await tw.releaseFunds(order.contract_id, env.releaseSignerSecret());
  await advance(order.id, 'entregado', { released_tx: rel.hash, released_at: new Date().toISOString(), status: 'liberado' });
  await logEvent(order.id, 'released', { hash: rel.hash, reason });
  return { releasedTx: rel.hash };
}
