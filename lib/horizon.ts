import { HORIZON_TESTNET, USDC_TESTNET_ISSUER } from './config';

export interface Balances { funded: boolean; xlm: string; usdc: string | null }

export async function fetchBalances(address: string): Promise<Balances> {
  const res = await fetch(`${HORIZON_TESTNET}/accounts/${address}`);
  if (res.status === 404) return { funded: false, xlm: '0', usdc: null };
  if (!res.ok) throw new Error(`Horizon ${res.status}`);
  const acc = await res.json();
  let xlm = '0';
  let usdc: string | null = null;
  for (const b of acc.balances ?? []) {
    if (b.asset_type === 'native') xlm = b.balance;
    else if (b.asset_code === 'USDC' && b.asset_issuer === USDC_TESTNET_ISSUER) usdc = b.balance;
  }
  return { funded: true, xlm, usdc };
}
