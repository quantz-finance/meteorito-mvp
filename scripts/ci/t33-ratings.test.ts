// (33) Tienda + calificaciones: 1-5, solo el comprador del pedido (llave de invitado o sesión), solo Entregado/Liberado, una vez. Sin red.
import type { T } from './setup';
import { installTestJwks, res, token } from './jwt';
import { __setDbForTests } from '../../api/_lib/db';
import { guestSubFromReq } from '../../api/_lib/guest';
import { baseSlugFromEmail, normalizeStoreSlug, storeDbErr, validStoreSlug } from '../../api/_lib/store';
import { fakeDb } from './fakedb';
import store from '../../api/store/index';
import { ratingLabel } from '../../lib/rating';

const KEY_A = 'a'.repeat(64), KEY_B = 'b'.repeat(64);
const call = async (o: { method?: string; body?: any; query?: any; guest?: string; tok?: string }) => {
  const r = res(); await store({ method: o.method ?? 'POST', headers: { ...(o.guest ? { 'x-guest-key': o.guest } : {}), ...(o.tok ? { authorization: `Bearer ${o.tok}` } : {}) }, body: o.body ?? {}, query: o.query ?? {} }, r); return r;
};

export async function run(t: T) {
  await installTestJwks(); process.env.CAVOS_JWT_AUDIENCE = 'cav_ci_test_app'; process.env.CAVOS_JWT_AUDIENCE_LOG_ONLY = '';
  const db = fakeDb(); __setDbForTests(db as any);
  const buyerA = guestSubFromReq({ headers: { 'x-guest-key': KEY_A } })!;
  const order = (slug: string, status: string, buyer: string | null = buyerA) => ({ id: `id-${slug}`, slug, status, seller_user_id: 'seller1', buyer_user_id: buyer, seller_address: 'G'.padEnd(56, 'A') });
  db.tables.orders.push(order('aaaaaa', 'liberado'), order('bbbbbb', 'enviado'), order('cccccc', 'entregado', 'cavos-buyer'));

  let r = await call({ guest: KEY_A, body: { action: 'rate', slug: 'aaaaaa', stars: 6 } });
  t.check('estrellas fuera de 1-5 -> 400', r.code === 400, `${r.code}`);
  r = await call({ body: { action: 'rate', slug: 'aaaaaa', stars: 5 } });
  t.check('sin llave ni sesión -> 401', r.code === 401, `${r.code}`);
  r = await call({ guest: KEY_B, body: { action: 'rate', slug: 'aaaaaa', stars: 5 } });
  t.check('llave de otro comprador -> 403', r.code === 403, `${r.code}`);
  r = await call({ tok: await token({ sub: 'seller1' }), body: { action: 'rate', slug: 'aaaaaa', stars: 5 } });
  t.check('el vendedor no puede calificarse -> 403', r.code === 403, `${r.code}`);
  r = await call({ guest: KEY_A, body: { action: 'rate', slug: 'bbbbbb', stars: 5 } });
  t.check('pedido todavía Enviado -> 409', r.code === 409 && r.body?.code === 'not_ratable', `${r.code}`);
  r = await call({ guest: KEY_A, body: { action: 'rate', slug: 'aaaaaa', stars: 4 } });
  t.check('comprador invitado califica pedido Liberado -> 200', r.code === 200 && db.tables.seller_ratings?.[0]?.stars === 4 && db.tables.seller_ratings[0].seller_user_id === 'seller1', `${r.code} ${r.body?.error}`);
  r = await call({ guest: KEY_A, body: { action: 'rate', slug: 'aaaaaa', stars: 1 } });
  t.check('segunda calificación del mismo pedido -> 409 already_rated', r.code === 409 && r.body?.code === 'already_rated' && db.tables.seller_ratings.length === 1, `${r.code}`);
  r = await call({ tok: await token({ sub: 'cavos-buyer' }), body: { action: 'rate', slug: 'cccccc', stars: 5 } });
  t.check('comprador con sesión Cavos califica pedido Entregado -> 200', r.code === 200, `${r.code} ${r.body?.error}`);

  // Mi tienda: se crea con usuario único derivado del correo; datos públicos sin correo ni dirección.
  r = await call({ tok: await token({ sub: 'seller1' }), body: { action: 'me' } });
  t.check('mi tienda se crea al primer acceso', r.code === 200 && r.body?.store_slug === 'seller1' && db.tables.seller_profiles?.length === 1, JSON.stringify(r.body));
  r = await call({ tok: await token({ sub: 'seller1' }), body: { action: 'me' } });
  t.check('segundo acceso no duplica el perfil', db.tables.seller_profiles.length === 1);
  r = await call({ tok: await token({ sub: 'seller1' }), body: { action: 'update', store_slug: 'API' } });
  t.check('usuario reservado -> 400', r.code === 400, `${r.code}`);
  db.tables.public_stores = [{ store_slug: 'seller1', display_name: 'Seller1', verified: false, rating_avg: '4.50', rating_count: 2 }];
  db.tables.public_store_items = [{ store_slug: 'seller1', slug: 'dddddd', title: 'Silla', price_crc: 25000, photo: 'https://x/0.jpg' }];
  r = await call({ method: 'GET', query: { store: 'seller1' } });
  const txt = JSON.stringify(r.body);
  t.check('tienda pública: nombre, promedio, cantidad y productos', r.code === 200 && r.body.rating_avg === 4.5 && r.body.rating_count === 2 && r.body.items[0]?.slug === 'dddddd', txt);
  t.check('tienda pública sin datos sensibles (correo, dirección, verified)', !/@|seller_address|G[A-Z2-7]{55}|verified|sub/.test(txt), txt);
  r = await call({ method: 'GET', query: { store: 'nadie' } });
  t.check('tienda inexistente -> 404', r.code === 404, `${r.code}`);

  let code = '';
  try { storeDbErr({ code: 'PGRST205', message: "Could not find the table 'public.seller_profiles' in the schema cache" }); } catch (e: any) { code = `${e.status}:${e.code}`; }
  t.check('sin migración 010 -> 503 store_unavailable (mensaje amable)', code === '503:store_unavailable', code);
  t.check('slugs: normaliza acentos/espacios y valida', normalizeStoreSlug('José Pérez!') === 'jose-perez' && validStoreSlug('jose-perez') && !validStoreSlug('ab') && !validStoreSlug('admin') && baseSlugFromEmail('rolando.arguello@x.com') === 'rolando-arguello');
  t.check('etiqueta de puntuación', ratingLabel({ rating_avg: null, rating_count: 0 }) === 'Nuevo vendedor' && ratingLabel({ rating_avg: 4.75, rating_count: 3 }) === '4.8 · 3 calificaciones');
}
