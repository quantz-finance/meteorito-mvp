// (23) Redondeo USDC del monto bruto, stepper según estado real y links de Stellar Expert (red + demo).
import type { T } from './setup';
import { grossUsdc } from '../../api/_lib/escrow';
import { moneyProgress } from '../../lib/progress';
import { chainLinks } from '../../lib/chain';
import { stellarExpertUrl } from '../../lib/config';

export async function run(t: T) {
  const rate = 510, fee = 0.003;
  const g = grossUsdc(15000);
  const sellerCrc = g * (1 - fee) * rate;
  t.check('₡15 000 -> vendedor recibe ₡15 000 (±₡0.01), no ₡15 005', Math.abs(sellerCrc - 15000) < 0.01, `gross=${g} seller=${sellerCrc}`);
  let worst = 0; for (let p = 500; p <= 2_000_000; p += 997) worst = Math.max(worst, Math.abs(grossUsdc(p) * (1 - fee) * rate - p));
  t.check('sobrepago máximo < ₡0.001 en todo el rango', worst < 0.001, `worst=${worst}`);
  t.check('el monto nunca queda por debajo del precio (vendedor no pierde)', grossUsdc(15000) * (1 - fee) * rate >= 15000 - 1e-6);

  t.check('creado/escrow_creado: 0 pasos', moneyProgress('creado') === 0 && moneyProgress('escrow_creado') === 0);
  t.check('fondeado: 1 paso (Pagado)', moneyProgress('fondeado') === 1);
  t.check('disputa sin envío: solo Pagado (Enviado NO marcado)', moneyProgress('en_disputa') === 1 && moneyProgress('en_disputa', false) === 1);
  t.check('disputa con envío: Pagado + Enviado', moneyProgress('en_disputa', true) === 2);
  t.check('enviado=2, entregado=3, liberado=4', moneyProgress('enviado') === 2 && moneyProgress('entregado') === 3 && moneyProgress('liberado') === 4);

  const o = { contract_id: 'CABC', funded_tx: 'f1', released_tx: 'r1' };
  t.check('links: contrato + tx de fondeo y liberación (testnet)', JSON.stringify(chainLinks(o, false).map((l) => l.url)) === JSON.stringify(['https://stellar.expert/explorer/testnet/contract/CABC', 'https://stellar.expert/explorer/testnet/tx/f1', 'https://stellar.expert/explorer/testnet/tx/r1']));
  t.check('links: sin contractId -> nada', chainLinks({ funded_tx: 'f1' }, false).length === 0 && chainLinks(null, false).length === 0);
  t.check('links: modo demo -> nada', chainLinks(o, true).length === 0);
  t.check('links: mainnet usa /public', stellarExpertUrl('contract', 'C1', 'public') === 'https://stellar.expert/explorer/public/contract/C1');
}
