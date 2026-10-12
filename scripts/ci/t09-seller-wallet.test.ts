// (9) Vendedor nuevo sin cuenta/trustline USDC: nunca un 400 crudo de TW.
// create -> 409 accionable (no publica); pay start -> 409 en español sin llamar a TW; activación: forma exacta validada.
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import type { T } from './setup';
import { installTestJwks, req, res, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { proofMessage } from '../../api/_lib/auth';
import { publicPrefix } from '../../api/_lib/photos';
import { __setHorizonForTests, buildActivationTx, validateActivationTx, SELLER_NOT_READY } from '../../api/_lib/wallet';
import { friendlyPayError } from '../../lib/wallet';
import { fakeDb } from './fakedb';
import create from '../../api/orders/create';
import pay from '../../api/escrow/pay';

const signProof = (kp: Keypair, action: string, ref: string) => {
  const ts = Math.floor(Date.now() / 1000); const message = proofMessage(action, ref, kp.publicKey(), ts);
  const pre = Buffer.concat([Buffer.from('Cavos Signed Message:\n'), Buffer.from(String(Buffer.byteLength(message))), Buffer.from('\n'), Buffer.from(message)]);
  return { address: kp.publicKey(), publicKey: kp.publicKey(), message, signature: kp.sign(pre).toString('base64') };
};

export async function run(t: T) {
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  const platform = Keypair.random(); const savedPub = process.env.PLATFORM_PUBLIC; process.env.PLATFORM_PUBLIC = platform.publicKey();
  const seller = Keypair.random(); const buyer = Keypair.random();
  const accounts: Record<string, any> = { [platform.publicKey()]: { balances: [] } };
  __setHorizonForTests(() => ({ loadAccount: async (a: string) => {
    if (!accounts[a]) throw Object.assign(new Error('not found'), { name: 'NotFoundError', response: { status: 404 } });
    return Object.assign(new Account(a, '100'), accounts[a]);
  } }));
  let twCalled = false; const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: any, i: any) => { if (String(u).includes('trustless')) twCalled = true; return realFetch(u, i); }) as any;
  try {
    // create: vendedor sin cuenta -> 409, no inserta.
    const db = fakeDb(); __setDbForTests(db as any);
    const photo = publicPrefix('seller') + '44444444-4444-4444-8444-444444444444/0.jpg';
    let r = res(); await create(req(await token({ sub: 'seller' }), { proof: signProof(seller, 'create', 'new'), category: 'celular', brand: 'a', model: 'b', condition: 'c', price_crc: 5000, photos: [photo] }), r);
    t.check('create sin trustline -> 409 accionable, no publica', r.code === 409 && db.tables.orders.length === 0 && /activ/i.test(r.body.error), `${r.code} ${r.body?.error}`);

    // pay start contra vendedor sin trustline -> 409 en español, sin escribir, sin llamar a TW.
    const db2 = fakeDb(); __setDbForTests(db2 as any);
    db2.tables.orders.push({ id: '55555555-5555-4555-8555-555555555555', slug: 'nw0001', status: 'creado', seller_user_id: 'seller', seller_address: seller.publicKey(), price_crc: 5000 });
    r = res(); await pay(req(await token({ sub: 'buyer' }), { slug: 'nw0001', step: 'start', proof: signProof(buyer, 'pay', 'nw0001') }), r);
    t.check('pay start sin trustline -> 409 claro, sin TW', r.code === 409 && r.body.error === SELLER_NOT_READY && !twCalled && !db2.tables.orders[0].contract_id, `${r.code} ${r.body?.error}`);

    // Activación: XDR armado por el server + firma del vendedor pasa; adulterado o sin firma, no.
    const tx = await buildActivationTx(seller.publicKey(), 'no_account');
    t.check('activación: 4 ops sponsor/createAccount/changeTrust/end', tx.operations.map((o) => o.type).join(',') === 'beginSponsoringFutureReserves,createAccount,changeTrust,endSponsoringFutureReserves');
    const signed = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET) as any; signed.sign(seller);
    let ok = true; try { validateActivationTx(signed.toXDR(), seller.publicKey()); } catch { ok = false; }
    t.check('activación firmada por el vendedor -> válida', ok);
    const bad = (x: string) => { try { validateActivationTx(x, seller.publicKey()); return false; } catch (e: any) { return e.status === 400; } };
    t.check('activación sin firma del vendedor -> 400', bad(tx.toXDR()));
    const evil = new TransactionBuilder(new Account(platform.publicKey(), '100'), { fee: '1000', networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: seller.publicKey() }))
      .addOperation(Operation.payment({ destination: seller.publicKey(), asset: Asset.native(), amount: '1000' }))
      .addOperation(Operation.endSponsoringFutureReserves({ source: seller.publicKey() })).setTimeout(60).build();
    evil.sign(seller);
    t.check('activación con ops ajenas (pago desde platform) -> 400', bad(evil.toXDR()));

    // Ya activada -> pay start pasa el chequeo (no lo ejecutamos contra TW aquí).
    accounts[seller.publicKey()] = { balances: [{ asset_code: 'USDC', asset_issuer: process.env.USDC_ISSUER ?? 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', balance: '0' }] };
    const { walletState } = await import('../../api/_lib/wallet');
    t.check('con trustline -> ready', (await walletState(seller.publicKey())) === 'ready');

    const raw = 'TW /deployer/single-release 400: The trustline for address GAOK… (role: receiver) could not be validated.';
    t.check('UI: 400 crudo de TW -> mensaje en español', !/TW|trustline/.test(friendlyPayError(raw)), friendlyPayError(raw));
  } finally {
    globalThis.fetch = realFetch; __setHorizonForTests(() => { throw new Error('reset'); });
    if (savedPub === undefined) delete process.env.PLATFORM_PUBLIC; else process.env.PLATFORM_PUBLIC = savedPub;
  }
}
