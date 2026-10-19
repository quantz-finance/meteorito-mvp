import { stellarExpertUrl } from './config';
import { DEMO_ENABLED } from './demo';

export interface ChainInfo { contract_id?: string | null; funded_tx?: string | null; released_tx?: string | null }

export function chainLinks(o: ChainInfo | null | undefined, demo = DEMO_ENABLED): { label: string; url: string }[] {
  if (demo || !o?.contract_id) return [];
  const out = [{ label: 'Ver en Stellar Expert', url: stellarExpertUrl('contract', o.contract_id) }];
  if (o.funded_tx) out.push({ label: 'Ver tx de pago (fondeo)', url: stellarExpertUrl('tx', o.funded_tx) });
  if (o.released_tx) out.push({ label: 'Ver tx de liberación', url: stellarExpertUrl('tx', o.released_tx) });
  return out;
}

