// (32) Link en un paso: crear pedido solo con título, precio y fotos (sin categoría, marca, modelo ni estado). Sin red.
import { Keypair } from '@stellar/stellar-sdk';
import type { T } from './setup';
import { installTestJwks, res, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { proofMessage } from '../../api/_lib/auth';
import { publicPrefix } from '../../api/_lib/photos';
import { __setHorizonForTests } from '../../api/_lib/wallet';
import { env } from '../../api/_lib/env';
import { fakeDb } from './fakedb';
import create from '../../api/orders/create';
import { parsePrice, formatPriceInput, validateListing } from '../../lib/listing';

const signProof = (kp: Keypair) => {
  const ts = Math.floor(Date.now() / 1000); const message = proofMessage('create', 'new', kp.publicKey(), ts);
  const pre = Buffer.concat([Buffer.from('Cavos Signed Message:\n'), Buffer.from(String(Buffer.byteLength(message))), Buffer.from('\n'), Buffer.from(message)]);
  return { address: kp.publicKey(), publicKey: kp.publicKey(), message, signature: kp.sign(pre).toString('base64') };
};
const call = async (body: any, sub = 'seller1') => { const r = res(); await create({ method: 'POST', headers: { authorization: `Bearer ${await token({ sub })}` }, body, query: {} }, r); return r; };

export async function run(t: T) {
  __setHorizonForTests(() => ({ loadAccount: async (a: string) => ({ id: a, balances: [{ asset_code: 'USDC', asset_issuer: env.usdcIssuer() }] }) }));
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  const db = fakeDb(); __setDbForTests(db as any);
  const kp = Keypair.random(); const photo = publicPrefix('seller1') + 'listing-44444444-4444-4444-8444-444444444444/0.jpg';

  let r = await call({ proof: signProof(kp), title: 'Bicicleta de montaña', price_crc: 85000, photos: [photo] });
  const row = db.tables.orders[0];
  t.check('crea pedido sin categoría/marca/modelo/estado -> 200', r.code === 200 && /^[a-z0-9]{6}$/.test(r.body?.slug), `${r.code} ${r.body?.error}`);
  t.check('título se guarda en model, brand vacío, category "otro", condition vacío (columnas NOT NULL)', row?.model === 'Bicicleta de montaña' && row?.brand === '' && row?.category === 'otro' && row?.condition === '', JSON.stringify(row));
  r = await call({ proof: signProof(kp), price_crc: 85000, photos: [photo] });
  t.check('sin título -> 400', r.code === 400, `${r.code}`);
  r = await call({ proof: signProof(kp), title: 'ab', price_crc: 85000, photos: [photo] });
  t.check('título muy corto -> 400', r.code === 400, `${r.code}`);
  r = await call({ proof: signProof(kp), title: 'Silla', price_crc: 85000, photos: [] });
  t.check('sin fotos -> 400', r.code === 400, `${r.code}`);
  r = await call({ proof: signProof(kp), title: 'Silla', price_crc: 500, photos: [photo] });
  t.check('precio fuera de rango -> 400', r.code === 400, `${r.code}`);
  r = await call({ proof: signProof(kp), category: 'celular', brand: 'Apple', model: 'iPhone 13', condition: 'Bueno', price_crc: 250000, photos: [photo] });
  t.check('cliente viejo (marca + modelo) sigue funcionando', r.code === 200 && db.tables.orders.at(-1)?.brand === 'Apple', `${r.code} ${r.body?.error}`);
  r = await call({ proof: signProof(kp), title: 'Silla', category: 'auto', price_crc: 5000, photos: [photo] });
  t.check('categoría enviada pero inválida -> 400', r.code === 400, `${r.code}`);

  t.check('parsePrice / formatPriceInput', parsePrice('₡185 000') === 185000 && formatPriceInput('185000') === '185 000' && parsePrice('') === 0);
  const ok = validateListing({ title: 'Silla gamer', price: 25000, photos: 1 });
  const bad = validateListing({ title: '', price: 10, photos: 0 });
  t.check('validación de la pantalla: válido sin errores; vacío con error en los 3 campos', Object.keys(ok).length === 0 && !!bad.title && !!bad.price && !!bad.photos, JSON.stringify(bad));
}
