// (11) /api/wallet/activate: errores con código (config) + activación real en testnet (cuenta nueva, 404 en Horizon).
import { Horizon, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import type { T, Testnet } from './setup';
import { installTestJwks, req, res, token } from './jwt';
import { proofMessage } from '../../api/_lib/auth';
import { __setHorizonForTests } from '../../api/_lib/wallet';
import { walletErrorNotice } from '../../lib/wallet';
import activate from '../../api/wallet/activate';

const pf = (kp: Keypair) => { const ts = Math.floor(Date.now() / 1000); const m = proofMessage('wallet', 'activate', kp.publicKey(), ts);
  const pre = Buffer.concat([Buffer.from('Cavos Signed Message:\n'), Buffer.from(String(Buffer.byteLength(m))), Buffer.from('\n'), Buffer.from(m)]);
  return { address: kp.publicKey(), publicKey: kp.publicKey(), message: m, signature: kp.sign(pre).toString('base64') }; };

export async function run(t: T, N: Testnet | null) {
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  const saved = { p: process.env.PLATFORM_PUBLIC, s: process.env.PLATFORM_SECRET };
  const call = async (body: any) => { const r = res(); await activate(req(await token({ sub: 'seller' }), body), r); return r; };
  const kp = Keypair.random();
  try {
    // Config faltante -> 503 con code y NOMBRES (nunca valores).
    delete process.env.PLATFORM_SECRET; process.env.PLATFORM_PUBLIC = Keypair.random().publicKey();
    let r = await call({ step: 'prepare', proof: pf(kp) });
    t.check('sin PLATFORM_SECRET -> 503 config_missing con nombre', r.code === 503 && r.body.code === 'config_missing' && r.body.missing?.includes('PLATFORM_SECRET'), JSON.stringify(r.body));
    process.env.PLATFORM_SECRET = Keypair.random().secret();
    r = await call({ step: 'prepare', proof: pf(kp) });
    t.check('PLATFORM_SECRET de otra cuenta -> 503 platform_mismatch', r.code === 503 && r.body.code === 'platform_mismatch' && !JSON.stringify(r.body).includes(process.env.PLATFORM_SECRET!), JSON.stringify(r.body));
    const n = walletErrorNotice({ code: 'platform_mismatch', message: 'PLATFORM_SECRET no corresponde' });
    t.check('UI: aviso genérico, sin código ni detalle técnico', !/código|platform|PLATFORM|secret/i.test(n) && /activar tu cuenta/.test(n), n);
    process.env.STELLAR_NETWORK = 'public';
    r = await call({ step: 'prepare', proof: pf(kp) });
    t.check('STELLAR_NETWORK != testnet -> rechazado', r.code === 500 && /solo testnet/.test(r.body.error), JSON.stringify(r.body));
    process.env.STELLAR_NETWORK = 'testnet';
    if (!N) { t.check('activación real testnet: SKIP (sin secretos)', true); return; }
    // Activación real: Horizon real, platform CI.
    process.env.PLATFORM_SECRET = N.S.TESTNET_PLATFORM_SECRET; process.env.PLATFORM_PUBLIC = N.pub('TESTNET_PLATFORM_SECRET');
    __setHorizonForTests(() => new Horizon.Server('https://horizon-testnet.stellar.org'));
    r = await call({ step: 'prepare', proof: pf(kp) });
    t.check('prepare cuenta 404 -> XDR', r.code === 200 && r.body.state === 'no_account' && !!r.body.unsignedXdr, `${r.code} ${r.body.error ?? ''}`);
    const tx = TransactionBuilder.fromXDR(r.body.unsignedXdr, Networks.TESTNET); tx.sign(kp); // = Cavos signXdr (control key = G si no está desplegada)
    r = await call({ step: 'submit', signedXdr: tx.toXDR(), proof: pf(kp) });
    t.check('submit -> cuenta creada + trustline USDC (ready)', r.code === 200 && r.body.ready === true, JSON.stringify(r.body));
    r = await call({ step: 'prepare', proof: pf(kp) });
    t.check('idempotente: ya lista -> ready sin XDR', r.code === 200 && r.body.ready === true && !r.body.unsignedXdr);
  } finally {
    if (saved.p === undefined) delete process.env.PLATFORM_PUBLIC; else process.env.PLATFORM_PUBLIC = saved.p;
    if (saved.s === undefined) delete process.env.PLATFORM_SECRET; else process.env.PLATFORM_SECRET = saved.s;
  }
}
